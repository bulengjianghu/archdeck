<script setup lang="ts">
/**
 * 模块的理解卡（PC-3 改写，ADR-0060；第十八轮走查）：按意图在先、边在后的次序，全文不截字（PC-13）——
 * ① 是什么：一句话职责（summaryOf，粗体，回退标「待提炼」；「全文 ▸」行内展开）
 * ② 不是什么：否定边界 excludes（M33，round19 V3），去向是链接
 * ③ 怎么分：原则全文（不收行、不截断）；声明了分层时每层「层名 · 层的问题」加归属判定一句与成员名；未声明时写明，
 *    并按画布同一套依赖深度（childTiers，≥7 个子模块且 ≥3 档才分组，与层带同一门槛）分组成员——都是名字，子模块的一句话在画布节点与它自己的卡上（C2）
 * ④ 守住什么：不变式（≤ 3 条，带 ADR 链接）
 * ⑤ 对外表面：接口名全文（用途在悬停，单击展开签名与说明）；⑥ 协作缺省折叠为一行「← N · → M」（画布的线就是协作），展开见目的全文（ModuleCollab）。
 * 运行视角下的运行信息由分派注入卡首（V6，PanelCard）。不写画布已经表达的位置信息（C2）。
 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import { excludesOf, invariantsOf, mayDependOnOf, stratumKey, summaryOf, type ExcludeDef } from '@/model'
import Markdown from './Markdown.vue'
import InterfaceItem from './InterfaceItem.vue'
import ChangeBadge from './ChangeBadge.vue'
import ModuleCollab from './ModuleCollab.vue'
import AdrLink from './AdrLink.vue'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const idx = computed(() => desk.index.value!)
const m = computed(() => idx.value.modules.get(props.id)!)
const summary = computed(() => summaryOf(m.value))
const fullOpen = ref(false)

// ── ② 不是什么（M33） ──
const neg = computed<ExcludeDef[]>(() => excludesOf(m.value))
const hasNegTarget = (e: ExcludeDef) => !!e.to && idx.value.modules.has(e.to)
const goNeg = (e: ExcludeDef) => e.to && desk.revealModule(e.to)

// ── ③ 怎么分 ──
const stratum = computed(() => idx.value.stratumOf.get(props.id) ?? null)
const isLayer = computed(() => stratum.value?.members.length === 1)
const principle = computed(() => m.value.abstraction ?? (isLayer.value ? stratum.value?.abstraction : undefined))
const ownStrata = computed(() => idx.value.strata.get(props.id) ?? [])
const children = computed(() => (idx.value.childrenOf.get(props.id) ?? []).map(id => idx.value.modules.get(id)!))
const pickStratum = (x: { parent: string; id: string; members: string[] }) =>
  x.members.length === 1 ? desk.select({ kind: 'module', id: x.members[0] }) : desk.select({ kind: 'stratum', id: stratumKey(idx.value, x) })
const isCurrentLevel = computed(() => desk.levelId.value === props.id)
const openChild = (childId: string) =>
  isCurrentLevel.value ? desk.select({ kind: 'module', id: childId }) : desk.goTo(props.id, { kind: 'module', id: childId })
const childSummary = (id: string) => summaryOf(idx.value.modules.get(id)!)?.text ?? ''
const inc = computed(() => ({ yes: m.value.includes ?? [] }))
const hasSplit = computed(() => !!principle.value || ownStrata.value.length > 0 || children.value.length > 0 || isLayer.value)
/** 未声明分层：成员按画布同一套依赖深度分组（≥7 个子模块且 ≥3 档才分组，与层带同一门槛 BAND_MIN）；不足时平铺名字 */
const depth = computed(() => desk.facts.childTiers(props.id))
const MEMBER_CAP = 12
const membersOpen = ref(false)
const flatShown = computed(() => (membersOpen.value ? children.value : children.value.slice(0, MEMBER_CAP)))

const layerDeps = computed(() => {
  const s = stratum.value
  if (!s || !isLayer.value) return []
  const list = idx.value.strata.get(s.parent) ?? []
  return (mayDependOnOf(s) ?? []).map(d => list.find(x => x.id === d)).filter((x): x is NonNullable<typeof x> => !!x)
})

// ── ⑤ 对外表面 ──
const provides = computed(() => m.value.provides ?? [])
const IFACE_CAP = 5
const ifaceOpen = ref(false)
const ifaceShown = computed(() => (ifaceOpen.value ? provides.value : provides.value.slice(0, IFACE_CAP)))
const detail = ref<string | null>(null)
const iface = (id: string) => idx.value.interfaces.get(id)
const use = (id: string) => iface(id)?.description?.trim() ?? ''
const isPort = (id: string) => !!desk.facts.portOf(id)?.isPort

// ── ⑥ 协作（缺省折叠） ──
const collabRows = computed(() => desk.facts.collaborations(props.id))
const hasCollab = computed(() => collabRows.value.length > 0)
const collabOpen = ref(false)
const collabIn = computed(() => collabRows.value.filter(c => c.dir === 'in').length)
const collabOut = computed(() => collabRows.value.filter(c => c.dir === 'out').length)

// ── ④ 守住什么 ──
const invariants = computed(() => invariantsOf(m.value))
</script>

<template>
  <div class="understand" data-sec="understand">
    <!-- ① 是什么 -->
    <div class="one" data-sec="purpose">
      <p v-if="summary" class="summary" data-testid="summary">
        {{ summary.text }}<span v-if="summary.pending" class="pending" title="描述没有写 summary：取自职责首句截断（M30）">待提炼</span>
        <button
          v-if="m.responsibility && !(summary && !summary.pending && summary.text === m.responsibility.trim())"
          class="link full"
          :aria-expanded="fullOpen"
          title="职责全文"
          @click="fullOpen = !fullOpen"
        >
          {{ fullOpen ? '收起全文' : '全文 ▸' }}
        </button>
      </p>
      <p v-else class="muted">职责未填写</p>
      <Markdown v-if="fullOpen" class="full-text" :text="m.responsibility" />
    </div>

    <!-- ② 不是什么 -->
    <div v-if="neg.length" class="q-block" data-sec="excludes">
      <h4 class="q">不负责</h4>
      <p class="neg" data-testid="excludes">
        <template v-for="(e, i) in neg" :key="i"
          ><span v-if="i" class="muted"> · </span>{{ e.text
          }}<template v-if="hasNegTarget(e)">
            <button class="link to" @click="goNeg(e)">→ {{ idx.modules.get(e.to!)?.name ?? e.to }}</button></template
          ></template
        >
      </p>
    </div>

    <!-- ③ 怎么分 -->
    <div v-if="hasSplit" class="q-block" data-sec="split">
      <h4 class="q">怎么分</h4>
      <p v-if="principle" class="principle" :title="principle">{{ principle }}</p>
      <!-- 声明了分层：层名 · 层的问题 · 归属判定 · 成员名 -->
      <ul v-if="ownStrata.length" class="strata" data-testid="module-strata">
        <li v-for="x in ownStrata" :key="x.id" class="stratum" :data-stratum="x.id">
          <div class="s-head">
            <button class="link k" :title="x.admits ? `归属判定：${x.admits}` : undefined" @click="pickStratum(x)">{{ x.name }}</button>
            <span v-if="x.asks" class="v">{{ x.asks }}</span>
          </div>
          <p v-if="x.admits" class="admits">归属：{{ x.admits }}</p>
          <p class="members">
            <template v-for="(id, i) in x.members" :key="id"
              ><span v-if="i" class="muted">、</span><button class="link" @click="openChild(id)">{{ idx.modules.get(id)?.name ?? id }}</button
              ><ChangeBadge entity="module" :id="id"
            /></template>
          </p>
        </li>
      </ul>
      <!-- 未声明分层：写明，成员按依赖深度分组（画布同一套）或平铺名字 -->
      <template v-else-if="children.length">
        <p class="nostrata" data-testid="module-nostrata">
          未声明分层<span class="muted"> · {{ children.length }} 个子模块</span
          ><template v-if="depth"
            ><span class="muted"> · 画布按依赖深度算出 {{ depth.count }} 层</span></template
          >
        </p>
        <div v-if="depth" class="tiers" data-testid="module-tiers">
          <div v-for="b in depth.bands" :key="b.label" class="tier">
            <span class="t-label">{{ b.label }}</span>
            <span class="members" :title="b.ids.map(childSummary).filter(Boolean).join('\n')">
              <template v-for="(id, i) in b.ids" :key="id"
                ><span v-if="i" class="muted">、</span><button class="link" @click="openChild(id)">{{ idx.modules.get(id)?.name ?? id }}</button
                ><ChangeBadge entity="module" :id="id"
              /></template>
            </span>
          </div>
        </div>
        <p v-else class="members flat" data-testid="module-children">
          <template v-for="(c, i) in flatShown" :key="c.id"
            ><span v-if="i" class="muted">、</span><button class="link" :title="childSummary(c.id)" @click="openChild(c.id)">{{ c.name }}</button
            ><ChangeBadge entity="module" :id="c.id"
          /></template>
          <button v-if="children.length > MEMBER_CAP" class="link more" :aria-expanded="membersOpen" @click="membersOpen = !membersOpen">
            {{ membersOpen ? '收起' : `+${children.length - MEMBER_CAP}` }}
          </button>
        </p>
      </template>
      <details v-if="isLayer && (inc.yes.length || stratum?.asks || stratum?.admits)" class="inc">
        <summary>层的问题与包含 {{ inc.yes.length }}</summary>
        <p v-if="stratum?.asks" class="muted">层的问题：{{ stratum.asks }}</p>
        <p v-if="stratum?.admits" class="muted">归属判定：{{ stratum.admits }}</p>
        <ul class="yes">
          <li v-for="x in inc.yes" :key="x">{{ x }}</li>
        </ul>
      </details>
      <p v-if="isLayer" class="deps" data-testid="layer-deps">
        <span class="label">可依赖</span>
        <span v-if="!layerDeps.length" class="muted">无</span>
        <template v-for="(d, i) in layerDeps" :key="d.id"
          ><span v-if="i" class="muted"> · </span><button class="link" @click="pickStratum(d)">{{ d.name }}</button></template
        >
      </p>
    </div>

    <!-- ④ 守住什么 -->
    <div v-if="invariants.length" class="q-block" data-sec="invariants">
      <h4 class="q">守住什么</h4>
      <ul class="inv" data-testid="invariants">
        <li v-for="(x, i) in invariants" :key="i">
          {{ x.text }}
          <AdrLink v-if="x.adr !== undefined" :n="x.adr" />
        </li>
      </ul>
    </div>

    <!-- ⑤ 对外表面：名字全文，用途在悬停，单击展开签名与说明 -->
    <div v-if="provides.length" class="q-block" data-sec="surface">
      <h4 class="q">
        对外表面<span class="count">{{ provides.length }}</span>
      </h4>
      <p class="ifaces">
        <template v-for="(id, i) in ifaceShown" :key="id"
          ><span v-if="i" class="muted">、</span
          ><button
            class="link k"
            :aria-expanded="detail === id"
            :title="`${use(id) || '没有说明'}\n${detail === id ? '收起详情' : '单击展开签名与说明'}`"
            @click="detail = detail === id ? null : id"
          >
            {{ iface(id)?.name ?? id }}</button
          ><span v-if="isPort(id)" class="badge">端口</span></template
        >
        <button v-if="provides.length > IFACE_CAP" class="link more" :aria-expanded="ifaceOpen" @click="ifaceOpen = !ifaceOpen">
          {{ ifaceOpen ? '收起' : `+${provides.length - IFACE_CAP}` }}
        </button>
      </p>
      <InterfaceItem v-if="detail" class="iface-detail" :id="detail" open />
    </div>

    <!-- ⑥ 协作：缺省折叠为一行，展开见目的全文（ModuleCollab） -->
    <div v-if="hasCollab" class="q-block" data-sec="collab">
      <button
        class="q fold"
        :aria-expanded="collabOpen"
        data-testid="collab-fold"
        title="协作：跨子树边界的关系，按对端合并；悬停画布上承载它们的线会高亮（L25）"
        @click="collabOpen = !collabOpen"
      >
        <span class="caret">{{ collabOpen ? '▾' : '▸' }}</span> 协作<span class="count">{{ collabRows.length }}</span>
        <span class="sum muted">← {{ collabIn }} · → {{ collabOut }}</span>
      </button>
      <ModuleCollab v-if="collabOpen" :id="id" />
    </div>
  </div>
</template>

<style scoped>
/* 层级：问题标题与正文同色、半粗；职责 14px 粗；正文 12.5px。标题的视觉权重 ≥ 正文（PC-13） */
.summary {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
}

.pending {
  margin-left: 6px;
  padding: 0 5px;
  font-size: 10.5px;
  font-weight: 400;
  color: var(--warning);
  background: var(--warning-soft);
  border-radius: 3px;
  vertical-align: 1px;
}

.full {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 400;
  padding: 0;
  vertical-align: 1px;
}

.full-text {
  font-size: 12.5px;
  color: var(--text-2);
}

.q-block {
  margin-top: 6px;
}

.q {
  margin: 0 0 3px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}

.q.fold {
  display: flex;
  align-items: baseline;
  gap: 5px;
  width: 100%;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.q .count {
  font-weight: 500;
  color: var(--text-3);
}

.q .sum {
  font-weight: 400;
}

.caret {
  flex: none;
  width: 1em;
  font-size: 10px;
  color: var(--text-3);
}

/* 原则与协作目的全文，不收行不省略（L46 的口径：超出的是描述写长了，按 04 改描述） */
.principle {
  margin: 2px 0 4px;
  color: var(--text);
  font-size: 12.5px;
}

.neg,
.members {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12.5px;
  color: var(--text);
}

.neg {
  line-height: 1.5;
}

.neg .to {
  padding: 0;
  text-align: left;
}

.nostrata {
  margin: 2px 0 3px;
  font-size: 12.5px;
  color: var(--text-2);
}

.strata {
  list-style: none;
  margin: 0;
  padding: 0;
}

.stratum {
  padding: 2px 0;
}

.s-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.s-head .k {
  flex: none;
  font-weight: 600;
}

.s-head .v {
  min-width: 0;
  font-size: 12.5px;
  color: var(--text-2);
}

.admits {
  margin: 1px 0 0;
  font-size: 11.5px;
  color: var(--text-3);
}

.members {
  display: block;
  line-height: 1.5;
}

.members .link {
  text-align: left;
}

.tiers {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tier {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0 10px;
  align-items: baseline;
}

.t-label {
  flex: none;
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
}

.tier .members {
  min-width: 0;
  font-size: 12.5px;
}

.members.flat {
  line-height: 1.5;
}

.more {
  font-size: 11.5px;
}

.ifaces {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
}

.ifaces .k {
  padding: 0;
  text-align: left;
}

.ifaces .badge {
  margin: 0 2px 0 3px;
  padding: 0 4px;
  font-size: 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  color: var(--text-2);
  vertical-align: 1px;
}

.iface-detail {
  margin-top: 4px;
}

.deps {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-2);
}

.deps .label {
  margin-right: 6px;
  font-size: 11px;
  color: var(--text-3);
}

.inc {
  margin: 4px 0;
  font-size: 12px;
}

.inc summary {
  cursor: pointer;
  color: var(--text-2);
}

.inc p {
  margin: 2px 0;
}

.inc ul {
  margin: 0;
  padding-left: 1.2em;
}

.inc .yes li::marker {
  content: '✓ ';
  color: var(--rel-streams);
}

.inc .no li::marker {
  content: '✗ ';
  color: var(--danger);
}

.inv {
  margin: 0;
  padding-left: 16px;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--text);
}
</style>
