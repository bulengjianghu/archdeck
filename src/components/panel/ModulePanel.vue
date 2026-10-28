<script setup lang="ts">
/**
 * 模块面板（G11 五段骨架，ADR-0050、V14）：① 头部（名称、进入 / 在此设计、徽标槽位表、设计说明）
 * ② 作用（说明 = 职责 + 原则一句，ADR-0042；层的包含 / 不包含、可依赖的层跟在说明后——它们是「为什么这样分」）
 * ③ 需要注意（每类异常一行、带计数、单击跳转，无异常不出现，V14b）
 * ④ 边界（视角敏感段：对外接口 → 子模块 → 出边 / 入边（先按类型汇总，展开才逐条）→ 端口；结构视角另加结构指标与影响面、表面；
 *   运行视角整体折叠在下（V6，由 Panel 包装））
 * ⑤ 证据与细节（默认折叠带计数，count 不为 0 才显示节；出处 footer 常显在最底）。
 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import { HOT_SURFACE_MODULES } from '@/model'
import Markdown from './Markdown.vue'
import Section from './Section.vue'
import InterfaceItem from './InterfaceItem.vue'
import DataStructureItem from './DataStructureItem.vue'
import RelationRow from './RelationRow.vue'
import ChangeBadge from './ChangeBadge.vue'
import DesignNote from './DesignNote.vue'
import ModuleSource from './ModuleSource.vue'
import ModuleSplit from './ModuleSplit.vue'
import ModuleGovernance from './ModuleGovernance.vue'
import ModuleEvolution from './ModuleEvolution.vue'
import ModulePorts from './ModulePorts.vue'
import ModuleKnowledge from './ModuleKnowledge.vue'
import ModuleStructure from './ModuleStructure.vue'
import ModuleSurface from './ModuleSurface.vue'
import ReviewSection from './ReviewSection.vue'
import ModuleDecisions from './ModuleDecisions.vue'
import NoticeSection from './NoticeSection.vue'
import { splitSignalCount, typeSummary, usePanelJump, type PanelNotice } from './panelNotices'
import { canDesignAt, openNewDesign } from '../edit/designHere'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const idx = computed(() => desk.index.value!)
const m = computed(() => idx.value.modules.get(props.id)!)
const children = computed(() => (idx.value.childrenOf.get(props.id) ?? []).map(id => idx.value.modules.get(id)!))
const outs = computed(() => idx.value.outRelations.get(props.id) ?? [])
const ins = computed(() => idx.value.inRelations.get(props.id) ?? [])
const isLayer = computed(() => m.value.kind === 'layer')
const isCurrentLevel = computed(() => desk.levelId.value === props.id)
const name = (id: string) => idx.value.modules.get(id)?.name ?? id
const STATUS: Record<string, string> = { current: '现状', target: '目标态', deprecated: '已废弃' }

function openChild(childId: string) {
  if (isCurrentLevel.value) desk.select({ kind: 'module', id: childId })
  else desk.goTo(props.id, { kind: 'module', id: childId })
}

// ── ① 头部徽标槽位表（V14a，来源议、出图后负责人定稿）：次序 ID → 类别 → 状态 → 核心 → 标签 → 变更 → 确认； ──
// ── 每槽至多一项；标签槽静息态至多 2 个，其余收「+N」（悬停看全量、单击展开） ──
const TAG_CAP = 2
const tagsOpen = ref(false)
const tags = computed(() => m.value.tags ?? [])
const tagsShown = computed(() => (tagsOpen.value ? tags.value : tags.value.slice(0, TAG_CAP)))
const tagsHidden = computed(() => tags.value.length - tagsShown.value.length)

// ── ③ 需要注意（V14b）：清单与计数全部来自现有派生，不新算 ──
const root = ref<HTMLElement | null>(null)
usePanelJump(root)

const ready = computed(() => desk.facts.status.value === 'ready')
const detail = computed(() => (ready.value ? desk.facts.moduleDetail(props.id) : null))
const review = computed(() => desk.review.of(props.id))
const split = computed(() => desk.facts.splitOf(props.id))
const against = computed(() => (ready.value ? desk.facts.againstOf(props.id) : []))
const surfaceMetrics = computed(() => (ready.value ? desk.facts.surfaceMetricsOf(props.id) : null))
/** 热表面未声明：导出未声明且扇入 ≥ HOT_SURFACE_MODULES 的元素（U19，与「表面」一节的建议同一口径） */
const hotUndeclared = computed(() => {
  const sm = surfaceMetrics.value
  if (!sm) return 0
  return sm.uses.filter(u => u.element.state === 'exported-only' && u.modules.length >= HOT_SURFACE_MODULES).length
})
const notices = computed<PanelNotice[]>(() => {
  const out: PanelNotice[] = []
  if (detail.value) {
    const d = detail.value
    const violations = d.violations.out.length + d.violations.in.length
    if (violations) out.push({ key: 'violations', label: '违规', count: violations, target: 'evidence.governance', to: '架构治理' })
    const cycles = d.cycles.length + (desk.facts.selectedCycle.value ? 1 : 0)
    if (cycles) out.push({ key: 'cycles', label: '模块环 / 本层环', count: cycles, target: 'evidence.governance', to: '架构治理' })
    const undescribed = d.undescribed.out.length + d.undescribed.in.length
    if (undescribed) out.push({ key: 'undescribed', label: '未解释的交互', count: undescribed, target: 'evidence.governance', to: '架构治理' })
  }
  const unconfirmed = ready.value ? desk.facts.isolatedOf(props.id).length : 0
  if (unconfirmed) out.push({ key: 'unconfirmed', label: '未证实的交互', count: unconfirmed, target: 'boundary.structure', to: '结构 · 交互图互查' })
  if (review.value.status === 'stale')
    out.push({ key: 'stale', label: '确认过期', count: review.value.diff?.count || 1, target: 'review.diff', to: '自上次确认以来的改动' })
  const splitN = splitSignalCount(split.value, desk.files.linesOf(props.id).long)
  if (splitN) out.push({ key: 'split', label: '拆分信号', count: splitN, target: 'evidence.split', to: '拆分信号', hint: true })
  if (against.value.length) out.push({ key: 'against', label: '逆稳定', count: against.value.length, target: 'boundary.structure', to: '结构', hint: true })
  const surfaceN = (surfaceMetrics.value?.bypasses.length ?? 0) + hotUndeclared.value
  if (surfaceN) out.push({ key: 'surface', label: '表面提示', count: surfaceN, target: 'boundary.surface', to: '表面', hint: true })
  return out
})

// ── ④ 出边 / 入边先按类型汇总一行（V14c），展开才逐条 RelationRow ──
const relOf = (id: string) => idx.value.relations.get(id)
const outSummary = computed(() => typeSummary(relOf, outs.value))
const inSummary = computed(() => typeSummary(relOf, ins.value))

// ⑤ 的计数（count 不为 0 才显示节）
const refsCount = computed(() => (m.value.codeRefs?.length ?? 0) + (m.value.docRefs?.length ?? 0))
</script>

<template>
  <div v-if="m" ref="root" class="module-panel">
    <!-- ① 头部 -->
    <header class="head" data-sec="head">
      <div class="title">
        <h2>{{ m.name }}</h2>
        <button v-if="children.length && !isCurrentLevel" class="drill" @click="desk.drillInto(m.id)">进入 ⌄</button>
        <button v-if="canDesignAt(desk, m.id)" class="drill" title="以这个模块为挂载点新建设计（F-10）" @click="openNewDesign(m.id)">在此设计</button>
      </div>
      <div class="badges">
        <code>{{ m.id }}</code>
        <span v-if="m.kind" class="badge">{{ isLayer ? '层' : m.kind }}</span>
        <span v-if="m.status && m.status !== 'current'" class="badge warn">{{ STATUS[m.status] }}</span>
        <span v-if="m.role === 'core'" class="badge accent">核心</span>
        <span v-for="t in tagsShown" :key="t" class="badge">{{ t }}</span>
        <button
          v-if="tagsHidden > 0 || tagsOpen"
          class="badge badge-more"
          :title="tagsOpen ? undefined : tags.slice(TAG_CAP).join('、')"
          :aria-expanded="tagsOpen"
          @click="tagsOpen = !tagsOpen"
        >
          {{ tagsOpen ? '收起' : `+${tagsHidden}` }}
        </button>
        <ChangeBadge entity="module" :id="m.id" detail />
        <ReviewSection :id="m.id" part="badge" />
      </div>
    </header>
    <DesignNote :text="m.designNote" />

    <!-- ② 作用：说明 = 职责 + 原则一句（ADR-0042）；层的包含 / 不包含、可依赖的层跟在说明后（「为什么这样分」） -->
    <Section title="说明" data-sec="purpose">
      <Markdown v-if="m.responsibility" :text="m.responsibility" />
      <p v-else class="muted">职责未填写</p>
      <div v-if="m.abstraction" class="principle"><span class="label">原则</span><Markdown :text="m.abstraction" /></div>
      <p v-else-if="isLayer" class="muted principle">原则未填写</p>
    </Section>
    <template v-if="isLayer">
      <Section v-if="m.includes?.length || m.excludes?.length" title="应该包含 / 不应该包含" data-sec="purpose">
        <div class="inc">
          <ul class="yes">
            <li v-for="x in m.includes ?? []" :key="x">{{ x }}</li>
          </ul>
          <ul class="no">
            <li v-for="x in m.excludes ?? []" :key="x">{{ x }}</li>
          </ul>
        </div>
      </Section>
      <Section title="可依赖的层" data-sec="purpose">
        <span v-if="!m.mayDependOn?.length" class="muted">无</span>
        <span v-for="(d, i) in m.mayDependOn ?? []" :key="d">
          <span v-if="i > 0"> · </span><button class="link" @click="desk.select({ kind: 'module', id: d })">{{ name(d) }}</button>
        </span>
      </Section>
    </template>

    <!-- ③ 需要注意：全部无异常时整段不出现（V14b） -->
    <NoticeSection :notices="notices" />

    <!-- ④ 边界（视角敏感段）：对外接口 → 子模块 → 出边 / 入边 → 端口；结构视角另加结构、表面（指标贴 ④ 段内的结构块首） -->
    <Section v-if="m.provides?.length" title="对外接口" :count="m.provides.length" data-sec="boundary.interfaces">
      <InterfaceItem v-for="id in m.provides" :key="id" :id="id" :open="m.provides.length <= 2" />
    </Section>

    <Section v-if="children.length" :title="isLayer ? '本层模块' : '子模块'" :count="children.length" data-sec="boundary.children">
      <ul class="plain">
        <li v-for="c in children" :key="c.id" class="child">
          <button class="link" @click="openChild(c.id)">{{ c.name }}</button>
          <ChangeBadge entity="module" :id="c.id" />
          <span v-if="c.role === 'core'" class="badge accent">核心</span>
          <span v-if="(idx.childrenOf.get(c.id) ?? []).length" class="muted">⌄ {{ idx.childrenOf.get(c.id)!.length }}</span>
          <span class="resp">{{ c.responsibility }}</span>
        </li>
      </ul>
    </Section>

    <Section v-if="outs.length" title="出边（它依赖 / 命令 / 通知谁）" :count="outs.length" data-sec="boundary.edges-out">
      <details class="rel-group">
        <summary>
          <span class="sum">
            <template v-for="(s, i) in outSummary" :key="s.type"><span v-if="i" class="muted"> · </span>{{ s.label }} {{ s.n }}</template>
          </span>
          <span class="muted more">展开 {{ outs.length }} 条</span>
        </summary>
        <ul class="plain">
          <RelationRow v-for="r in outs" :key="r" :id="r" :perspective="m.id" />
        </ul>
      </details>
    </Section>
    <Section v-if="ins.length" title="入边（谁依赖 / 命令 / 通知它）" :count="ins.length" data-sec="boundary.edges-in">
      <details class="rel-group">
        <summary>
          <span class="sum">
            <template v-for="(s, i) in inSummary" :key="s.type"><span v-if="i" class="muted"> · </span>{{ s.label }} {{ s.n }}</template>
          </span>
          <span class="muted more">展开 {{ ins.length }} 条</span>
        </summary>
        <ul class="plain">
          <RelationRow v-for="r in ins" :key="r" :id="r" :perspective="m.id" />
        </ul>
      </details>
    </Section>

    <ModulePorts v-if="m" :id="m.id" data-sec="boundary.ports" />
    <template v-if="desk.perspective.value === 'structure'">
      <!-- 结构视角（ADR-0031 / ADR-0032）：指标与影响面、表面归位到 ④，贴在结构块首 -->
      <ModuleStructure :id="m.id" data-sec="boundary.structure" />
      <ModuleSurface :id="m.id" data-sec="boundary.surface" />
    </template>

    <!-- ⑤ 证据与细节：默认折叠带计数，count 不为 0 才显示节（V14c） -->
    <ModuleDecisions :id="m.id" fold data-sec="evidence.decisions" />
    <ModuleKnowledge :id="m.id" fold data-sec="evidence.knowledge" />
    <ModuleGovernance :id="m.id" fold data-sec="evidence.governance" />
    <ModuleSplit :id="m.id" fold data-sec="evidence.split" />
    <ModuleEvolution :id="m.id" data-sec="evidence.evolution" />
    <ModuleSource :id="m.id" />
    <Section v-if="m.principle" title="实现原理" fold data-sec="evidence.principle"><Markdown :text="m.principle" /></Section>
    <Section v-if="m.dataStructures?.length" title="核心数据结构" fold :count="m.dataStructures.length" data-sec="evidence.data">
      <DataStructureItem v-for="id in m.dataStructures" :key="id" :id="id" :open="m.dataStructures.length <= 2" />
    </Section>
    <Section v-if="refsCount" title="代码与文档引用" fold :count="refsCount" data-sec="evidence.refs">
      <ul class="plain refs">
        <li v-for="c in m.codeRefs ?? []" :key="c">
          <code>{{ c }}</code>
        </li>
        <li v-for="d in m.docRefs ?? []" :key="d">
          <a v-if="/^https?:/.test(d)" :href="d" target="_blank" rel="noreferrer">{{ d }}</a>
          <span v-else>📄 {{ d }}</span>
        </li>
        <li v-if="m.owner" class="muted">负责人：{{ m.owner }}</li>
      </ul>
    </Section>
    <div data-sec="review.diff">
      <ReviewSection :id="m.id" part="diff" fold />
    </div>
    <ReviewSection :id="m.id" part="confirm" fold />

    <footer class="src muted">出处：{{ desk.modelDir.value }}/{{ m.src.file }}{{ m.src.line ? `:${m.src.line}` : '' }}</footer>
  </div>
</template>

<style scoped>
.principle {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--border);
}

.principle .label {
  flex: none;
  font-size: 12px;
  color: var(--text-3);
}

.badge-more {
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.inc {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.inc ul {
  margin: 0;
  padding-left: 1.2em;
  font-size: 13px;
}

.inc .yes li::marker {
  content: '✓ ';
  color: var(--rel-streams);
}

.inc .no li::marker {
  content: '✗ ';
  color: var(--danger);
}

.child {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  padding: 3px 0;
}

.child .resp {
  flex-basis: 100%;
  font-size: 12px;
  color: var(--text-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.rel-group summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 10px;
  padding: 2px 0;
  font-size: 12.5px;
  cursor: pointer;
  list-style: none;
}

.rel-group summary::-webkit-details-marker {
  display: none;
}

.rel-group summary::before {
  content: '▸ ';
  color: var(--text-3);
}

.rel-group[open] summary::before {
  content: '▾ ';
}

.rel-group summary .more {
  font-size: 11.5px;
}

.rel-group ul {
  padding-top: 2px;
}

.refs li {
  padding: 2px 0;
  font-size: 12.5px;
  word-break: break-all;
}
</style>
