<script setup lang="ts">
/**
 * 根层面板的「架构治理」一节（GV-7）：代码事实统计、违规按新增 / 已知 / 已豁免、环与环度对比基线、拦截记录摘要。
 * 没有代码事实时说明原因（K8）。
 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import { RULE_LABELS, moduleName, type Violation, type ViolationStatus } from '@/model'
import Section from './Section.vue'
import FileDepList from './FileDepList.vue'
import WriteForm from './WriteForm.vue'

/** 根层先给健康度摘要（summary），分层、简介、生成来源之后再给违规、环等明细（detail）；不给时两部分都画 */
defineProps<{ part?: 'summary' | 'detail' }>()
const desk = useDesk()
const f = desk.facts
const r = computed(() => f.report.value)
const name = (id: string) => (desk.index.value ? moduleName(desk.index.value, id) : id)

const REASON: Record<string, string> = {
  design: '设计版本与历史提交不对应当前代码，没有代码事实（K8）。',
  loading: '正在提取代码依赖…',
}
const confirm = computed(() => {
  const list = [...(r.value?.relations.values() ?? [])]
  return { confirmed: list.filter(c => c.status === 'confirmed').length, unconfirmed: list.filter(c => c.status === 'unconfirmed').length }
})
const STATUS_LABEL: Record<ViolationStatus, string> = { new: '新增', known: '已知（基线内）', open: '违规（无基线）', allowed: '已豁免' }
const groups = computed(() => {
  const out: { status: ViolationStatus; list: Violation[] }[] = []
  for (const st of ['new', 'open', 'known', 'allowed'] as ViolationStatus[]) {
    const list = (r.value?.violations ?? []).filter(v => v.status === st)
    if (list.length) out.push({ status: st, list })
  }
  return out
})
const open = ref<string | null>(null)
const externals = computed(() =>
  Object.entries(r.value?.external ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8),
)
const ledger = computed(() => f.ledger.value)
/** Z5：确认计数，与项目卡片同一口径 */
const rc = computed(() => desk.review.counts.value)

// GV-7、Q10：有基线时违规显示相对基线的变化 ±N 与存量（计入门禁的条数），环度只显示升降；其余绝对值进悬停
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0')
const trend = (now: number, base: number) => (now > base ? `↑ +${now - base}` : now < base ? `↓ −${base - now}` : '持平')
const trendClass = (now: number, base: number) => (now > base ? 'bad' : now < base ? 'ok' : 'muted')
const counted = computed(() => (r.value?.violations ?? []).filter(v => v.status !== 'allowed').length)
const violationTitle = computed(() => {
  const x = r.value
  if (!x) return ''
  const allowed = x.violations.length - counted.value
  return `计入门禁 ${counted.value} 条（新增 ${x.gate.newViolations} · 已知 ${x.gate.knownViolations}）${allowed ? `，已豁免 ${allowed}` : ''}${x.baseline ? `，基线 ${x.baseline.violations.length} 条` : ''}`
})
const liveCycles = computed(() => (r.value?.moduleCycles ?? []).filter(c => !c.tolerated))
const maxCycle = computed(() => Math.max(0, ...liveCycles.value.map(c => c.members.length)))
const liveFileCycles = computed(() => (r.value?.fileCycles ?? []).filter(c => !c.tolerated).length)
</script>

<template>
  <Section v-if="part !== 'detail'" title="健康度（架构治理）">
    <dl class="kv review-line" :title="`确认范围：核心模块与第二级模块（Z4）；已确认 ${rc.reviewed} / ${rc.scope}，需复核 ${rc.stale}`">
      <dt>确认</dt>
      <dd>
        核心模块已确认 {{ rc.reviewed }} / {{ rc.scope }} · <span :class="{ warn: rc.stale }">需复核 {{ rc.stale }}</span>
      </dd>
    </dl>
    <p v-if="!r" class="muted">{{ f.error.value ? `没有代码事实：${f.error.value}` : REASON[f.status.value] }}</p>
    <template v-else>
      <dl class="kv">
        <dt>文件依赖</dt>
        <dd>
          {{ r.fileDeps }}<span v-if="r.skipped" class="muted">（一端未归属或已忽略 {{ r.skipped }}）</span
          ><span v-if="r.conflicted.length" class="muted">（因归属冲突未计入 {{ r.conflicted.length }}）</span>
        </dd>
        <dt>模块依赖</dt>
        <dd>{{ r.moduleDeps.size }}</dd>
        <dt>关系</dt>
        <dd>
          已证实 {{ confirm.confirmed }} · <span :class="{ warn: confirm.unconfirmed }">未证实 {{ confirm.unconfirmed }}</span>
        </dd>
        <dt>未描述依赖</dt>
        <dd>{{ r.undescribed.length }}</dd>
        <dt>违规</dt>
        <dd :title="violationTitle">
          <template v-if="r.baseline">
            <span :class="{ bad: r.gate.newViolations }">{{ signed(r.gate.newViolations - r.gate.resolved) }}</span>
            <span class="stock"> · 存量 {{ counted }}</span>
            <span class="muted">（相对基线：新增 {{ r.gate.newViolations }} · 已消除 {{ r.gate.resolved }}）</span>
          </template>
          <template v-else>{{ counted }} <span class="muted">（无基线）</span></template>
        </dd>
        <dt>模块环</dt>
        <dd :title="`不含容忍的环；文件环 ${liveFileCycles} 个`">
          {{ liveCycles.length }} 个<template v-if="liveCycles.length"> · 最大 {{ maxCycle }}</template>
        </dd>
        <dt>环度</dt>
        <dd
          :title="`模块 ${r.cyclicity.modules} · 文件 ${r.cyclicity.files}${r.baseline ? `（基线 ${r.baseline.cyclicity.modules} · ${r.baseline.cyclicity.files}）` : ''}`"
        >
          <template v-if="r.baseline">
            模块
            <span :class="trendClass(r.cyclicity.modules, r.baseline.cyclicity.modules)">{{ trend(r.cyclicity.modules, r.baseline.cyclicity.modules) }}</span> ·
            文件
            <span :class="trendClass(r.cyclicity.files, r.baseline.cyclicity.files)">{{ trend(r.cyclicity.files, r.baseline.cyclicity.files) }}</span>
          </template>
          <template v-else>模块 {{ r.cyclicity.modules }} · 文件 {{ r.cyclicity.files }} <span class="muted">（无基线）</span></template>
        </dd>
        <dt>基线</dt>
        <dd v-if="r.baseline">
          {{ r.baseline.createdAt.slice(0, 10) }}<code v-if="r.baseline.commit"> {{ r.baseline.commit.slice(0, 8) }}</code>
          <span v-if="r.gate.resolved" class="ok">已消除 {{ r.gate.resolved }} 条，可收紧</span>
        </dd>
        <dd v-else class="muted">无（npm run arch -- baseline 生成）</dd>
      </dl>
      <p class="hint muted">图上缺省叠加代码事实（「显示」面板可关闭）：虚线加 ? 为未证实的关系，点线为未描述的依赖，红色为基线外的违规，↻ 为本层的环。</p>
    </template>
  </Section>

  <Section v-if="part !== 'summary' && r && r.violations.length" title="违规" :count="r.violations.length">
    <div v-for="g in groups" :key="g.status" class="group">
      <h4 :class="`st-${g.status}`">{{ STATUS_LABEL[g.status] }} {{ g.list.length }}</h4>
      <ul class="plain">
        <li v-for="v in g.list.slice(0, 30)" :key="v.key" class="violation">
          <button class="link" @click="open = open === v.key ? null : v.key">{{ name(v.from) }} → {{ name(v.to) }}</button>
          <span class="chip">{{ RULE_LABELS[v.kind] }}</span>
          <span class="muted">{{ v.files.length }} 处</span>
          <div v-if="open === v.key" class="detail">
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
        <li v-if="g.list.length > 30" class="muted">另 {{ g.list.length - 30 }} 条，见 npm run arch -- violations</li>
      </ul>
    </div>
  </Section>

  <Section v-if="part !== 'summary' && r && r.moduleCycles.length" title="模块环" :count="r.moduleCycles.length">
    <ul class="plain">
      <li v-for="(c, i) in r.moduleCycles" :key="i" class="cycle">
        <span class="muted">{{ c.members.length }} 个{{ c.tolerated ? '（容忍）' : '' }}：</span>
        <template v-for="(m, j) in c.members" :key="m">
          <button class="link" @click="desk.revealModule(m)">{{ name(m) }}</button><span v-if="j < c.members.length - 1" class="muted">、</span>
        </template>
      </li>
    </ul>
    <p v-if="r.fileCycles.length" class="muted">
      另有文件环 {{ r.fileCycles.length }} 个（最大 {{ Math.max(...r.fileCycles.map(c => c.members.length)) }} 个文件），见 npm run arch -- cycles
    </p>
  </Section>

  <Section v-if="part !== 'summary' && r && externals.length" title="外部依赖（按导入次数）">
    <p class="muted ext">
      <span v-for="[pkg, n] in externals" :key="pkg">{{ pkg }} {{ n }}</span>
    </p>
  </Section>

  <Section v-if="part !== 'summary' && ledger && (ledger.checks || ledger.rescans)" title="拦截记录（agent 接口）">
    <dl class="kv">
      <dt>写前判定</dt>
      <dd>{{ ledger.checks }} 次：拒绝 {{ ledger.byVerdict.denied }} · 允许 {{ ledger.byVerdict.allowed }} · 无约束 {{ ledger.byVerdict.unconstrained }}</dd>
      <dt>按规则拒绝</dt>
      <dd>
        层 {{ ledger.deniedByRule.layer }} · 白名单 {{ ledger.deniedByRule.deps }} · 访问面 {{ ledger.deniedByRule.exposes }}；会成环 {{ ledger.cycleFlags }}
      </dd>
      <template v-if="ledger.first && ledger.last">
        <dt>重新扫描</dt>
        <dd>
          {{ ledger.rescans }} 次：违规 {{ ledger.first.violations }} → {{ ledger.last.violations }}，模块环度 {{ ledger.first.cyclicity.modules }} →
          {{ ledger.last.cyclicity.modules }}
        </dd>
      </template>
    </dl>
  </Section>
</template>

<style scoped>
.kv {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 14px;
  margin: 0;
  font-size: 13px;
}

.kv dt {
  color: var(--text-3);
}

.kv dd {
  margin: 0;
}

.hint {
  margin: 8px 0 0;
  font-size: 12px;
}

.warn,
.bad {
  color: var(--danger);
}

.ok {
  margin-left: 6px;
  color: var(--success, var(--accent));
}

.group h4 {
  margin: 6px 0 2px;
  font-size: 12px;
  font-weight: 600;
}

.st-new {
  color: var(--danger);
}

.violation {
  padding: 2px 0;
}

.chip {
  margin: 0 6px;
  padding: 0 6px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.detail {
  margin: 4px 0 6px 10px;
}

.detail p {
  margin: 0 0 4px;
  font-size: 12px;
}

.ext {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 0;
  font-size: 12px;
}
</style>
