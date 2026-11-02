<script setup lang="ts">
/**
 * 系统核对卡的治理清单（GV-7 修订，PC-10、PC-12，ADR-0059）：全部是折叠带计数的证据清单（V15c），计数为 0 不出现，按严重度排——
 * 违规（按「规则 → 对端」分组，新增组在前，同一对端的多个来源合成一行、展开才逐条；一条来源的直接写「来源 → 对端」）、模块环、
 * 端口与查询副作用（一行一条：端口 · 问题词，说明进悬停）、共用件（反向依赖、体量、入度最高、疑似共用件与一键认可 U11）、
 * 未证实的关系、未解释的交互。结论与条目在核对卡的三行上（SystemPanel），这里只放证据；库存数（文件依赖、端口数、子类、组装、外部依赖）
 * 不是健康度，在「规模与来源」（PC-13 准入三问）。没有代码事实时整组不出现（原因在核对卡的行上写明，K8）。
 */
import { computed, reactive, ref } from 'vue'
import { useDesk } from '@/state/inject'
import { RULE_LABELS, moduleName, type Issue, type Violation, type ViolationStatus } from '@/model'
import Section from './Section.vue'
import FileDepList from './FileDepList.vue'
import WriteForm from './WriteForm.vue'
import { relationTypeLabel } from './panelCheck'

const desk = useDesk()
const f = desk.facts
const r = computed(() => f.report.value)
const idx = computed(() => desk.index.value)
const name = (id: string) => (idx.value ? moduleName(idx.value, id) : id)

// ── 违规：按状态分组，组内按「规则 → 对端」合并（PC-12） ──
const STATUS_LABEL: Record<ViolationStatus, string> = { new: '新增', known: '已知（基线内）', open: '违规（无基线）', allowed: '已豁免' }
interface ViolationGroup {
  key: string
  kind: Violation['kind']
  to: string
  list: Violation[]
  sources: number
  places: number
}
/** 每个状态一组；组内同一「规则 → 对端」的违规合成一行，按处数降序 */
const groups = computed(() => {
  const out: { status: ViolationStatus; rows: ViolationGroup[]; total: number }[] = []
  for (const st of ['new', 'open', 'known', 'allowed'] as ViolationStatus[]) {
    const list = (r.value?.violations ?? []).filter(v => v.status === st)
    if (!list.length) continue
    const by = new Map<string, ViolationGroup>()
    for (const v of list) {
      const key = `${v.kind}|${v.to}`
      const g = by.get(key) ?? { key: `${st}|${key}`, kind: v.kind, to: v.to, list: [], sources: 0, places: 0 }
      g.list.push(v)
      g.places += v.files.length
      by.set(key, g)
    }
    const rows = [...by.values()].map(g => ({ ...g, sources: new Set(g.list.map(v => v.from)).size })).sort((a, b) => b.places - a.places)
    out.push({ status: st, rows, total: list.length })
  }
  return out
})
/** 每组缺省列前 GROUP_CAP 行，其余「+N」展开（PC-7 的做法，不再指去命令行） */
const GROUP_CAP = 12
const more = reactive<Record<string, boolean>>({})
const shownRows = (g: { status: ViolationStatus; rows: ViolationGroup[] }) => (more[g.status] ? g.rows : g.rows.slice(0, GROUP_CAP))
const openGroup = ref<string | null>(null)
const openViolation = ref<string | null>(null)
/** 单击一行：一条来源的行直接展开它的证据；多来源的行展开逐条清单 */
const toggle = (row: ViolationGroup) => {
  if (row.list.length === 1) openViolation.value = openViolation.value === row.list[0]!.key ? null : row.list[0]!.key
  else openGroup.value = openGroup.value === row.key ? null : row.key
}
const expanded = (row: ViolationGroup): Violation[] =>
  row.list.length === 1 ? (openViolation.value === row.list[0]!.key ? row.list : []) : openGroup.value === row.key ? row.list : []

// ── 端口孤立与查询副作用（U13、U14）：一行一条，说明进悬停 ──
const CODE_LABEL: Record<string, string> = { 'port.no-implementer': '无实现者', 'port.no-user': '无使用者', 'query.side-effect': '查询副作用' }
const portProblems = computed(() => f.portProblems.value)
const sideEffects = computed(() => desk.issues.value.filter(i => i.code === 'query.side-effect'))
/** 端口孤立问题对应的端口：问题的出处即接口的声明位置 */
const portOfIssue = (i: Issue) => [...(idx.value?.interfaces.values() ?? [])].find(x => x.src.file === i.file && x.src.line === i.line)?.id

// ── 共用件（Q13、Q15、U11） ──
const shared = computed(() => desk.evolution.shared.value)
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`)
const suggestions = computed(() => r.value?.sharedSuggestions ?? [])
const sharedCount = computed(() => (shared.value?.modules ?? 0) + suggestions.value.length)
const accepting = ref<string | null>(null)
const acceptError = ref('')
async function acceptShared(id: string) {
  accepting.value = id
  acceptError.value = ''
  const out = await desk.write.role(id, 'shared')
  accepting.value = null
  if (!out.ok) acceptError.value = out.error
}

// ── 未证实的关系（K5、K6）：证实行的证据 ──
const UNCONFIRMED_CAP = 30
const moreUnconfirmed = ref(false)
const unconfirmed = computed(() =>
  [...(r.value?.relations.entries() ?? [])]
    .filter(([, c]) => c.status === 'unconfirmed')
    .map(([id]) => ({ id, rel: idx.value?.relations.get(id) }))
    .filter(x => x.rel),
)
const shownUnconfirmed = computed(() => (moreUnconfirmed.value ? unconfirmed.value : unconfirmed.value.slice(0, UNCONFIRMED_CAP)))

const maxFileCycle = computed(() => Math.max(0, ...(r.value?.fileCycles ?? []).map(c => c.members.length)))
</script>

<template>
  <template v-if="r">
    <Section v-if="r.violations.length" title="违规" :count="r.violations.length" fold data-sec="governance.violations">
      <div v-for="g in groups" :key="g.status" class="group">
        <h4 :class="`st-${g.status}`">{{ STATUS_LABEL[g.status] }} {{ g.total }}</h4>
        <ul class="plain">
          <li v-for="row in shownRows(g)" :key="row.key" class="violation" :data-group="row.key">
            <button class="link" :aria-expanded="expanded(row).length > 0" @click="toggle(row)">
              {{ row.list.length === 1 ? `${name(row.list[0]!.from)} → ${name(row.to)}` : `→ ${name(row.to)}` }}
            </button>
            <span class="chip">{{ RULE_LABELS[row.kind] }}</span>
            <span class="muted">{{ row.list.length === 1 ? `${row.places} 处` : `${row.sources} 个来源 · ${row.places} 处` }}</span>
            <ul v-if="expanded(row).length" class="plain sub">
              <li v-for="v in expanded(row)" :key="v.key" class="violation">
                <template v-if="row.list.length > 1">
                  <button class="link" @click="openViolation = openViolation === v.key ? null : v.key">{{ name(v.from) }} → {{ name(v.to) }}</button>
                  <span class="muted">{{ v.files.length }} 处</span>
                </template>
                <div v-if="row.list.length === 1 || openViolation === v.key" class="detail">
                  <p class="muted">
                    {{ v.reason }}<template v-if="v.allowReason">；例外理由：{{ v.allowReason }}</template>
                  </p>
                  <FileDepList :deps="v.files" />
                  <WriteForm
                    v-if="v.status !== 'allowed' && desk.write.canEditRules"
                    label="加例外（写理由）"
                    multiline
                    placeholder="为什么允许这条依赖（必填，写进 rules.yaml 的 allow，由架构师决定）"
                    :submit="reason => desk.write.allow({ from: v.from, to: v.to, rule: v.kind, reason })"
                  />
                </div>
              </li>
            </ul>
          </li>
          <li v-if="g.rows.length > GROUP_CAP">
            <button class="link muted" @click="more[g.status] = !more[g.status]">{{ more[g.status] ? '收起' : `+${g.rows.length - GROUP_CAP}` }}</button>
          </li>
        </ul>
      </div>
    </Section>

    <Section v-if="r.moduleCycles.length" title="模块环" :count="r.moduleCycles.length" fold data-sec="governance.cycles">
      <ul class="plain">
        <li v-for="(c, i) in r.moduleCycles" :key="i" class="cycle">
          <span class="muted">{{ c.members.length }} 个{{ c.tolerated ? '（容忍）' : '' }}：</span>
          <template v-for="(m, j) in c.members" :key="m">
            <button class="link" @click="desk.revealModule(m)">{{ name(m) }}</button><span v-if="j < c.members.length - 1" class="muted">、</span>
          </template>
        </li>
      </ul>
      <p v-if="r.fileCycles.length" class="muted small">另有文件环 {{ r.fileCycles.length }} 个（最大 {{ maxFileCycle }} 个文件）</p>
    </Section>

    <Section
      v-if="portProblems.length || sideEffects.length"
      title="端口与查询副作用"
      :count="portProblems.length + sideEffects.length"
      fold
      data-sec="governance.ports"
    >
      <ul class="plain" data-testid="port-problems">
        <li v-for="(i, k) in portProblems" :key="`p${k}`" class="issue" :class="i.severity" :title="i.message">
          <button v-if="portOfIssue(i)" class="link" @click="desk.select({ kind: 'port', id: portOfIssue(i)! })">{{ portOfIssue(i) }}</button>
          <span class="chip">{{ CODE_LABEL[i.code] ?? i.code }}</span>
          <span class="one-line muted">{{ i.message }}</span>
        </li>
        <li v-for="(i, k) in sideEffects" :key="`q${k}`" class="issue warning" :title="i.message">
          <span class="chip">{{ CODE_LABEL[i.code] ?? i.code }}</span>
          <span class="one-line muted">{{ i.message }}</span>
        </li>
      </ul>
    </Section>

    <Section v-if="sharedCount" title="共用件" :count="sharedCount" fold data-sec="governance.shared">
      <dl v-if="shared" class="kv">
        <dt>反向依赖</dt>
        <dd :class="{ warn: shared.reverse }">{{ shared.reverse }}</dd>
        <dt>体量</dt>
        <dd
          data-testid="shared-health"
          :title="`共用件 ${shared.modules} 个；行数占比阈值 ${pct(shared.limits.lines)}、修改占比阈值 ${pct(shared.limits.changes)}（Q13）`"
          :class="{ warn: shared.over }"
        >
          行数 {{ pct(shared.lineRatio) }} · 修改 {{ pct(shared.changeRatio) }}<template v-if="shared.over">（超阈值）</template>
        </dd>
        <template v-if="shared.topFanIn">
          <dt>入度最高</dt>
          <dd data-testid="shared-top" title="扇入 Ca 最大的共用件：改它牵动的模块最多；只计数、不卡门禁（Q15）">
            <button class="link" @click="desk.revealModule(shared.topFanIn.module)">{{ name(shared.topFanIn.module) }}</button> Ca {{ shared.topFanIn.ca }}（占
            {{ pct(shared.topFanIn.ratio) }}）
          </dd>
        </template>
      </dl>
      <template v-if="r.sharedReverse.length">
        <h4>反向依赖 {{ r.sharedReverse.length }}</h4>
        <ul class="plain">
          <li v-for="d in r.sharedReverse" :key="d.key" class="violation">
            <button class="link" @click="desk.select({ kind: 'dep', id: d.key })">{{ name(d.from) }} → {{ name(d.to) }}</button>
            <span class="muted">{{ d.files.length }} 处</span>
          </li>
        </ul>
      </template>
      <template v-if="suggestions.length">
        <h4 title="入度广、没有运行时出边、不在场景路径上、名字像工具模块（U11）；认可后写进 intent/roles.yaml，收进本层的共用件架">
          疑似共用件 {{ suggestions.length }}
        </h4>
        <ul class="plain" data-testid="shared-suggestions">
          <li v-for="s in suggestions" :key="s.module" class="suggestion" :data-module="s.module">
            <button class="link" @click="desk.revealModule(s.module)">{{ name(s.module) }}</button>
            <button v-if="desk.write.canEditRules" class="accept" :disabled="accepting === s.module" @click="acceptShared(s.module)">认可为共用件</button>
            <ul class="reasons muted">
              <li v-for="(t, i) in s.reasons" :key="i">{{ t }}</li>
            </ul>
          </li>
        </ul>
        <p v-if="acceptError" class="warn">{{ acceptError }}</p>
      </template>
    </Section>

    <Section v-if="unconfirmed.length" title="未证实的关系" :count="unconfirmed.length" fold data-sec="verify.unconfirmed">
      <ul class="plain">
        <li v-for="x in shownUnconfirmed" :key="x.id" class="violation">
          <button class="link" @click="desk.revealRelation(x.id)">{{ name(x.rel!.from) }} → {{ name(x.rel!.to) }}</button>
          <span class="chip">{{ relationTypeLabel(x.rel!.type) }}</span>
        </li>
        <li v-if="unconfirmed.length > UNCONFIRMED_CAP">
          <button class="link muted" @click="moreUnconfirmed = !moreUnconfirmed">
            {{ moreUnconfirmed ? '收起' : `+${unconfirmed.length - UNCONFIRMED_CAP}` }}
          </button>
        </li>
      </ul>
    </Section>

    <Section v-if="r.undescribed.length" title="未解释的交互" :count="r.undescribed.length" fold data-sec="governance.undescribed">
      <ul class="plain">
        <li v-for="d in r.undescribed" :key="d.key" class="violation">
          <button class="link" @click="desk.select({ kind: 'dep', id: d.key })">{{ name(d.from) }} → {{ name(d.to) }}</button>
          <span class="muted">{{ d.files.length }} 处</span>
        </li>
      </ul>
    </Section>
  </template>
</template>

<style scoped>
.group h4,
h4 {
  margin: 6px 0 2px;
  font-size: 12px;
  font-weight: 600;
}

.st-new {
  color: var(--danger);
}

.violation,
.issue {
  padding: 2px 0;
}

.issue {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.one-line {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.chip {
  margin: 0 6px;
  padding: 0 6px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
  white-space: nowrap;
}

.issue .chip {
  flex: none;
  margin: 0;
}

.sub {
  margin: 2px 0 4px 14px;
}

.detail {
  margin: 4px 0 6px 10px;
}

.detail p {
  margin: 0 0 4px;
  font-size: 12px;
}

.kv {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 14px;
  margin: 0 0 4px;
  font-size: 13px;
}

.kv dt {
  color: var(--text-3);
}

.kv dd {
  margin: 0;
}

.warn {
  color: var(--danger);
}

.suggestion {
  padding: 3px 0;
}

.suggestion .accept {
  margin-left: 8px;
  font-size: 12px;
  padding: 1px 8px;
}

.reasons {
  margin: 2px 0 0 14px;
  padding: 0;
  font-size: 12px;
}

.small {
  font-size: 12px;
}
</style>
