<script setup lang="ts">
/**
 * 模块面板（G11 五段骨架，ADR-0050、V15）：① 头部（名称、进入 / 在此设计、徽标槽位表、设计说明）
 * ② 作用（说明 = 职责 + 原则一句，ADR-0042；层的包含 / 不包含、可依赖的层跟在说明后——它们是「为什么这样分」；
 *   长文超 4 行收起带「展开 N 字」，波 3 r3 要求 1）
 * ③ 需要注意（每类异常一行、带计数、单击跳转，无异常不出现，V15b）
 * ④ 边界（视角敏感段：对外接口 → 子模块 → 出边 / 入边（先按类型汇总，展开才逐条）→ 端口；对外接口与子模块清单超 4 个
 *   收「+N」（悬停看全量、单击展开，与头部标签同款）；结构视角另加结构指标与影响面、表面；运行视角整体折叠在下（V6，由 Panel 包装））
 * ⑤ 证据与细节（默认折叠带计数，count 不为 0 才显示节；出处 footer 常显在最底）。
 * ② 的展开与 ④ 的「+N」展开都不跨选中保持：换选中即回缺省（与 V15「折叠状态换选中即回默认」同口径）。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useDesk } from '@/state/inject'
import { HOT_SURFACE_MODULES, mayDependOnOf, stratumKey } from '@/model'
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
// ADR-0052：单成员层的成员就是层（根的四层）；它的问题、判定问与可依赖的层取自层
const stratum = computed(() => idx.value.stratumOf.get(props.id) ?? null)
const isLayer = computed(() => stratum.value?.members.length === 1)
const layerDeps = computed(() => {
  const s = stratum.value
  if (!s) return []
  const list = idx.value.strata.get(s.parent) ?? []
  return (mayDependOnOf(s) ?? []).map(d => list.find(x => x.id === d)).filter((x): x is NonNullable<typeof x> => !!x)
})
/** ADR-0052：本模块对子模块声明的分层 */
const ownStrata = computed(() => idx.value.strata.get(props.id) ?? [])
const pickStratum = (x: { parent: string; id: string; members: string[] }) =>
  x.members.length === 1 ? desk.select({ kind: 'module', id: x.members[0] }) : desk.select({ kind: 'stratum', id: stratumKey(idx.value, x) })
const isCurrentLevel = computed(() => desk.levelId.value === props.id)
const STATUS: Record<string, string> = { current: '现状', target: '目标态', deprecated: '已废弃' }

function openChild(childId: string) {
  if (isCurrentLevel.value) desk.select({ kind: 'module', id: childId })
  else desk.goTo(props.id, { kind: 'module', id: childId })
}

// ── ① 头部徽标槽位表（V15a，来源议、出图后负责人定稿）：次序 ID → 类别 → 状态 → 核心 → 标签 → 变更 → 确认； ──
// ── 每槽至多一项；标签槽静息态至多 2 个，其余收「+N」（悬停看全量、单击展开） ──
const TAG_CAP = 2
const tagsOpen = ref(false)
const tags = computed(() => m.value.tags ?? [])
const tagsShown = computed(() => (tagsOpen.value ? tags.value : tags.value.slice(0, TAG_CAP)))
const tagsHidden = computed(() => tags.value.length - tagsShown.value.length)

// ── ② 说明长文折叠（第十五轮波 3，r3 要求 1）：超过 PURPOSE_LINES 行收起、带「展开 N 字」（行数实测定：说明一节
// ── 常态 4 行读完职责大意，h5player app.solution 等长文 7+ 行）——展开态不跨选中保持，换选中即回缺省（收起） ──
const PURPOSE_LINES = 4
const purposeEl = ref<HTMLElement | null>(null)
const purposeOpen = ref(false)
const purposeOverflow = ref(false)
const purposeChars = ref(0)
const purposeClamp = ref(84)
const measurePurpose = () => {
  const el = purposeEl.value
  if (!el) return
  const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.45 || 18
  purposeClamp.value = Math.round(lh * PURPOSE_LINES)
  purposeChars.value = (el.textContent ?? '').replace(/\s+/g, '').length
  // 夹住量全高：scrollHeight 是完整内容高，与夹住的可见高比
  const prev = el.style.maxHeight
  el.style.maxHeight = `${purposeClamp.value}px`
  purposeOverflow.value = el.scrollHeight > purposeClamp.value + 2
  el.style.maxHeight = prev
}
onMounted(() => {
  nextTick(measurePurpose)
  // 字体就绪后行高会变，再量一次
  document.fonts?.ready.then(() => nextTick(measurePurpose))
})

// ── ④ 清单的「+N」（第十五轮波 3，与头部标签同款交互：悬停看全量、单击展开）：对外接口、子模块各留前几个，其余收起带计数； ──
// ── ModuleStructure 的交互图互查清单同款（在 ModuleStructure.vue）。展开态同样不跨选中保持 ──
const IFACE_CAP = 4
const ifaceOpen = ref(false)
const provides = computed(() => m.value.provides ?? [])
const ifaceShown = computed(() => (ifaceOpen.value ? provides.value : provides.value.slice(0, IFACE_CAP)))
const ifaceHidden = computed(() => provides.value.length - ifaceShown.value.length)

const CHILDREN_CAP = 4
const childrenOpen = ref(false)
const childrenShown = computed(() => (childrenOpen.value ? children.value : children.value.slice(0, CHILDREN_CAP)))
const childrenHidden = computed(() => children.value.length - childrenShown.value.length)
const childrenRest = computed(() =>
  childrenShown.value === children.value
    ? ''
    : children.value
        .slice(CHILDREN_CAP)
        .map(c => c.name)
        .join('、'),
)

// 换选中（props.id 变）即回缺省：说明收起、清单收起
watch(
  () => props.id,
  () => {
    purposeOpen.value = false
    ifaceOpen.value = false
    childrenOpen.value = false
    nextTick(measurePurpose)
  },
)
watch(
  () => [m.value?.responsibility, m.value?.abstraction],
  () => nextTick(measurePurpose),
)

// ── ③ 需要注意（V15b）：清单与计数全部来自现有派生，不新算 ──
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
    if (violations)
      out.push({
        key: 'violations',
        label: '违规',
        count: violations,
        target: 'evidence.governance',
        to: '架构治理',
        // 审核轮 2 B1：与系统面板同口径说明——治理信号（含基线内已知），不是门禁红（U8），不含返工清单的 info 级（K24）
        note: '涉此模块的架构规则违规（U2–U6），含基线内的已知违规；门禁卡的是基线外的新增（U8，无基线时只提示），返工清单的 info 级提示（K24 层符合性）不在此计数',
      })
    // 模块环（Y 系列，模块级强连通）与本层环（层带内，Y5）是两个独立信号：各自一行、各自计数（V15b）
    const moduleCycles = d.cycles.length
    if (moduleCycles) out.push({ key: 'cycles', label: '模块环', count: moduleCycles, target: 'evidence.governance', to: '架构治理' })
    const levelCycles = desk.facts.selectedCycle.value ? 1 : 0
    if (levelCycles) out.push({ key: 'levelCycles', label: '本层环', count: levelCycles, target: 'evidence.governance', to: '架构治理' })
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

// ── ④ 出边 / 入边先按类型汇总一行（V15c），展开才逐条 RelationRow ──
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
        <span v-if="isLayer" class="badge">层</span>
        <span v-else-if="m.kind" class="badge">{{ m.kind }}</span>
        <button v-if="stratum && !isLayer" class="badge link" data-testid="module-stratum" @click="pickStratum(stratum)">层 · {{ stratum.name }}</button>
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

    <!-- ② 作用：说明 = 职责 + 原则一句（ADR-0042）；层的包含 / 不包含、可依赖的层跟在说明后（「为什么这样分」）。
         长文超过 4 行收起带「展开 N 字」（波 3 r3 要求 1，行数实测定），展开态不跨选中保持 -->
    <Section title="说明" data-sec="purpose">
      <div class="purpose">
        <div ref="purposeEl" class="purpose-text" :class="{ clamped: !purposeOpen }" :style="{ maxHeight: purposeOpen ? '' : `${purposeClamp}px` }">
          <Markdown v-if="m.responsibility" :text="m.responsibility" />
          <p v-else class="muted">职责未填写</p>
          <div v-if="isLayer && stratum?.asks" class="principle" :title="stratum.admits ? `归属判定：${stratum.admits}` : undefined">
            <span class="label">层</span>{{ stratum.asks }}
          </div>
          <div v-if="m.abstraction" class="principle"><span class="label">原则</span><Markdown :text="m.abstraction" /></div>
          <div v-else-if="isLayer && stratum?.abstraction" class="principle"><span class="label">原则</span><Markdown :text="stratum.abstraction" /></div>
          <p v-else-if="isLayer" class="muted principle">原则未填写</p>
        </div>
        <button v-if="purposeOverflow" class="link purpose-toggle" :aria-expanded="purposeOpen" @click="purposeOpen = !purposeOpen">
          {{ purposeOpen ? '收起说明' : `展开 · 说明 ${purposeChars} 字` }}
        </button>
      </div>
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
        <span v-if="!layerDeps.length" class="muted">无</span>
        <span v-for="(d, i) in layerDeps" :key="d.id">
          <span v-if="i > 0"> · </span><button class="link" @click="pickStratum(d)">{{ d.name }}</button>
        </span>
      </Section>
    </template>
    <!-- ADR-0052：本模块对子模块的分层（层是分类、不占级） -->
    <Section v-if="ownStrata.length" title="分层" :count="ownStrata.length" data-sec="purpose" data-testid="module-strata">
      <ol class="strata">
        <li v-for="x in ownStrata" :key="x.id">
          <button class="link" :title="x.admits ? `归属判定：${x.admits}` : undefined" @click="pickStratum(x)">{{ x.name }}</button>
          <span v-if="x.asks" class="muted"> · {{ x.asks }}</span>
          <span class="muted"> · {{ x.members.length }} 个模块</span>
        </li>
      </ol>
    </Section>

    <!-- ③ 需要注意：全部无异常时整段不出现（V15b） -->
    <NoticeSection :notices="notices" />

    <!-- ④ 边界（视角敏感段）：对外接口 → 子模块 → 出边 / 入边 → 端口；结构视角另加结构、表面（指标贴 ④ 段内的结构块首）。
         两类清单超 4 个收「+N」（波 3 r3 要求 1，与头部标签同款：悬停看全量、单击展开） -->
    <Section v-if="provides.length" title="对外接口" :count="provides.length" data-sec="boundary.interfaces">
      <ul class="plain">
        <li v-for="id in ifaceShown" :key="id" class="iface">
          <InterfaceItem :id="id" :open="provides.length <= 2" />
        </li>
        <li v-if="ifaceHidden > 0 || ifaceOpen">
          <button
            class="badge-more link"
            :title="ifaceOpen ? undefined : `其余接口：${provides.slice(IFACE_CAP).join('、')}`"
            :aria-expanded="ifaceOpen"
            @click="ifaceOpen = !ifaceOpen"
          >
            {{ ifaceOpen ? '收起' : `+${ifaceHidden}` }}
          </button>
        </li>
      </ul>
    </Section>

    <Section v-if="children.length" :title="isLayer ? '本层模块' : '子模块'" :count="children.length" data-sec="boundary.children">
      <ul class="plain">
        <li v-for="c in childrenShown" :key="c.id" class="child">
          <button class="link" @click="openChild(c.id)">{{ c.name }}</button>
          <ChangeBadge entity="module" :id="c.id" />
          <span v-if="c.role === 'core'" class="badge accent">核心</span>
          <span v-if="(idx.childrenOf.get(c.id) ?? []).length" class="muted">⌄ {{ idx.childrenOf.get(c.id)!.length }}</span>
          <span class="resp">{{ c.responsibility }}</span>
        </li>
        <li v-if="childrenHidden > 0 || childrenOpen">
          <button
            class="badge-more link"
            :title="childrenOpen ? undefined : `其余子模块：${childrenRest}`"
            :aria-expanded="childrenOpen"
            @click="childrenOpen = !childrenOpen"
          >
            {{ childrenOpen ? '收起' : `+${childrenHidden}` }}
          </button>
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

    <!-- ⑤ 证据与细节：默认折叠带计数，count 不为 0 才显示节（V15c） -->
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
/* ② 说明长文折叠：max-height 由脚本按实际行高写入（purposeClamp），展开时清空 */
.purpose-text.clamped {
  overflow: hidden;
}

.purpose-toggle {
  font-size: 12px;
  margin-top: 2px;
}

.strata {
  margin: 0;
  padding-left: 18px;
}
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

.plain .iface {
  padding: 2px 0;
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
