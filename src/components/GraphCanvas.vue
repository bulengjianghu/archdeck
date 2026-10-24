<script setup lang="ts">
/**
 * GraphCanvas：把 PositionedView 画成节点和边；处理平移（拖空白处或按住空格拖动）、缩放（Ctrl + 滚轮）、单击、双击、悬停。
 * 运行视角下作为舞台（V5）：本层参与的节点与走过的边突出、其余变淡，当前消息沿步骤方向流动（P10），
 * 本层没有视图边的消息画临时线（经由上层关系 P15 / 未建模 P11），步骤序号可单击指向（R13），停在分支点时预览各选项（F6）。
 * 舞台按静态关系显示方式（在「显示」面板切换）隐藏或淡化不参与的节点与静态边（V5、V8），「在画布上显示」的对象照常（V9）；
 * 选中步骤时其余走过的边与步骤序号淡为灰色；选中其他对象时不变灰，舞台始终按进度（R15、R16）。
 * 选中文件时，其归属模块在本层的投影节点加文件高亮（G14）。
 * 交互视角开启「代码事实」时叠加证实标记、违规与代码依赖叠加线、本层的环（K9、Y4）；单击叠加线即选中它（K10）。
 * 结构视角（ADR-0031）：节点不动，交互边换成结构边（L15、L16），单击结构边即选中这对节点的代码依赖（`sel=d:`）；节点标指标与不稳定度（L17）、
 * 选中模块时标影响面（K15）、本层的环常显（Y4）；画布角计收起的只引类型依赖边（L15），没有代码事实时说明只画允许依赖（U16）。
 * 开启「演化」时叠加热度角标与时间耦合的波浪线（J5）；单击耦合线即选中它（J7）。
 * 节点右键：「在此设计」（F-10：以该模块为挂载点新建设计，只在当前版本、不能是层）。
 * 画什么由 Layout 的 canvasScene 算出（ADR-0013）；这里只把结果写入 Vue Flow、把交互转成操作、适应画布。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { VueFlow, useVueFlow, type Edge, type Node } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import { useDesk } from '@/state/inject'
import { contentBounds } from '@/layout/layout'
import { canvasScene, type NodeData, type RouteEdgeData, type StructureInput } from '@/layout/canvas'
import { useStage } from './stage/useStageDisplay'
import ModuleNode from './nodes/ModuleNode.vue'
import BoundaryNode from './nodes/BoundaryNode.vue'
import BandNode from './nodes/BandNode.vue'
import CoreNode from './nodes/CoreNode.vue'
import MoreNode from './nodes/MoreNode.vue'
import SharedNode from './nodes/SharedNode.vue'
import ActorNode from './nodes/ActorNode.vue'
import FrameNode from './nodes/FrameNode.vue'
import StepBadge from './nodes/StepBadge.vue'
import BranchPreview from './nodes/BranchPreview.vue'
import RouteEdge from './edges/RouteEdge.vue'
import DepEdge from './edges/DepEdge.vue'
import { useStructurePrefs } from './display/useDisplayPrefs'
import DisplayPanel from './DisplayPanel.vue'
import SketchMenu from './sketch/SketchMenu.vue'
import { canDesignAt, openNewDesign } from './edit/designHere'

const desk = useDesk()
const stageUi = useStage()
const { setViewport, zoomIn, zoomOut, dimensions, setNodes, setEdges } = useVueFlow('arch-desk')

/** 运行视角的舞台叠加；结构 / 交互视角为 null */
const stage = computed(() => (desk.perspective.value === 'run' ? desk.run.overlay.value : null))
const interaction = computed(() => desk.perspective.value === 'interaction')
/** ADR-0031：结构视角的显示偏好（只引类型、影响面方向、只看值依赖），与「显示」面板共享 */
const structurePrefs = useStructurePrefs(desk.project)

/** 结构视角的画布输入；其余视角为 null */
const structure = computed<StructureInput | null>(() => {
  if (desk.perspective.value !== 'structure') return null
  const f = desk.facts
  const p = structurePrefs.prefs.value
  const sel = desk.selection.value
  const loading = f.status.value === 'loading'
  const hit = sel?.kind === 'module' && !loading ? f.impactOf(sel.id, p.valuesOnly) : null
  return {
    view: loading ? null : f.structure.value,
    typeOnly: p.typeOnly,
    metrics: (p.valuesOnly ? f.valueMetrics.value : f.metrics.value) ?? null,
    impact: hit?.impact ?? null,
    impactMode: p.impactMode,
    cycles: f.level.value?.cycles ?? null,
    report: f.report.value,
    note: loading ? '正在读取代码事实…' : null,
  }
})

/** 画布场景（Layout 的纯函数 canvasScene，ADR-0013）：节点与边的数据、显隐、变淡、回放态与选中突出 */
const scene = computed(() =>
  canvasScene({
    positioned: desk.positioned.value,
    index: desk.index.value,
    selection: desk.selection.value,
    hover: desk.hoverId.value,
    stage: stage.value,
    scenarioView: desk.run.scenarioView.value,
    emphasis: desk.run.emphasis.value,
    participants: desk.run.stageParticipants.value,
    mode: stageUi.mode.value,
    reveal: stageUi.reveal.value,
    diff: desk.toggles.showDiff ? desk.versions.diff.value : null,
    fileHits: desk.files.hits.value?.nodes ?? null,
    branchPointId: desk.run.branchPoint.value?.id ?? null,
    // 代码事实与组装叠加只在交互视角（K9、O12）；结构视角另给 structure
    facts: interaction.value ? desk.facts.level.value : null,
    evolution: desk.evolution.level.value,
    ports: desk.facts.portMarks.value,
    assembly: interaction.value ? (desk.facts.assembly.value?.overlays ?? null) : null,
    assemblyRoots: interaction.value ? (desk.facts.assembly.value?.roots ?? null) : null,
    structure: structure.value,
  }),
)
const nodes = computed<Node<NodeData>[]>(() => scene.value.nodes)
const edges = computed<Edge<RouteEdgeData>[]>(() => scene.value.edges)

// 节点与边直接写入 Vue Flow 的 store，不走 :nodes / :edges 属性：
// 属性同步在「上一层次有选中、切到分层总览」时会被跳过（store 停留在旧节点），这里绕开它
watch(nodes, n => setNodes(n), { immediate: true })
watch(edges, e => setEdges(e), { immediate: true })

// Vue Flow 内部错误默认静默，统一打到控制台便于排查
function onFlowError(err: unknown) {
  console.warn('[vue-flow]', err)
}

// ── 交互 ──
function onNodeClick({ node }: { node: Node<NodeData> }) {
  if (node.type === 'step' || node.type === 'preview') return
  if (node.type === 'frame') desk.select(null)
  else if (node.type === 'actor') desk.select({ kind: 'actor', id: node.data!.moduleId })
  // O6、O8：单击 +N 临时展开（再单击「收起」），不改层次、不改选中；普通层次的占位 ID 是 more:<父模块>
  else if (node.type === 'more') desk.toggleBand(node.id.slice('more:'.length))
  else desk.select({ kind: 'module', id: node.data!.moduleId })
}

function onNodeDoubleClick({ node }: { node: Node<NodeData> }) {
  if (node.type === 'actor' || node.type === 'frame' || node.type === 'step' || node.type === 'preview') return
  if (node.type === 'boundary') desk.revealModule(node.data!.moduleId)
  // O5：带内的 +N 双击下钻到这一层；O8：普通层次的 +N 双击无动作
  else if (node.type === 'more') {
    if (!node.data!.graphFold) desk.drillInto(node.id.slice('more:'.length))
  } else desk.drillInto(node.data!.moduleId)
}

/** F-10：节点右键「在此设计」 */
const menu = ref<{ x: number; y: number; id: string } | null>(null)
function onNodeMenu({ event, node }: { event: MouseEvent | TouchEvent; node: Node<NodeData> }) {
  const id = node.type === 'module' || node.type === 'boundary' || node.type === 'core' || node.type === 'shared' ? node.data?.moduleId : undefined
  if (!id || desk.version) return
  event.preventDefault()
  const ev = event as MouseEvent
  menu.value = { x: ev.clientX, y: ev.clientY, id }
}
function onMenu(key: string) {
  const id = menu.value?.id
  menu.value = null
  if (key === 'design' && id) openNewDesign(id)
}

function onEdgeClick({ edge }: { edge: Edge<RouteEdgeData> }) {
  if (edge.data!.temp === 'unmodeled') return
  // L15：结构边落到这对节点的代码依赖（K10 的 sel=d:），同一对节点的各种类同一个键
  const d = edge.data!.dep
  if (d) return desk.select({ kind: 'dep', id: `${d.fromModule}->${d.toModule}` })
  const o = edge.data!.overlay
  if (o) return desk.select({ kind: 'dep', id: `${o.fromModule}->${o.toModule}` })
  // O12：组装叠加线同样落到这对节点的代码依赖（K10）
  const a = edge.data!.assembly
  if (a) return desk.select({ kind: 'dep', id: `${a.fromModule}->${a.toModule}` })
  const c = edge.data!.couple
  if (c) return desk.select({ kind: 'couple', id: c.primary })
  const e = edge.data!.edge
  if (e.kind === 'direct') desk.select({ kind: 'relation', id: e.relationIds[0] })
  else desk.select({ kind: 'edge', id: e.id })
}

function onNodeEnter({ node }: { node: Node<NodeData> }) {
  if (node.type === 'core' || node.type === 'module' || node.type === 'shared' || node.type === 'boundary' || node.type === 'actor') desk.setHover(node.id)
}

function onNodeLeave() {
  desk.setHover(null)
}

// ── 视角：切换层次后自动适应画布 ──
// 视野：内容边界直接取自布局结果（不依赖 Vue Flow 对节点尺寸的测量，首帧即可用）；
// 只需等画布容器有尺寸，切换层次后自动适应
const pendingFit = ref(true)

// O7：分层总览的带按画布宽度铺开——容器宽度交给协调者，换算成带内列数（只在列数变化时重新布局）
const host = ref<HTMLElement | null>(null)
let resize: ResizeObserver | null = null
onMounted(() => {
  if (!host.value) return
  desk.setCanvasWidth(host.value.clientWidth)
  if (typeof ResizeObserver !== 'undefined') {
    resize = new ResizeObserver(entries => desk.setCanvasWidth(entries[0].contentRect.width))
    resize.observe(host.value)
  }
})
onBeforeUnmount(() => resize?.disconnect())
watch(desk.levelVersion, () => (pendingFit.value = true))
/** V5：运行视角隐藏了静态内容时只按可见节点适应画布；否则为 null（取全部内容） */
const visibleIds = computed(() => scene.value.visibleIds)
// 进出运行视角、切换显示方式后重新适应
watch(
  () => [desk.perspective.value, stageUi.mode.value] as const,
  async () => {
    pendingFit.value = true
    await nextTick()
    tryPendingFit()
  },
)
function fitNow(): boolean {
  const pv = desk.positioned.value
  const { width, height } = dimensions.value
  if (!pv || width === 0 || height === 0) return false
  const b = contentBounds(pv, visibleIds.value ?? undefined)
  if (!b) return false
  const pad = 0.08
  const zoom = Math.min(1.2, (width * (1 - 2 * pad)) / b.w, (height * (1 - 2 * pad)) / b.h)
  void setViewport({ x: (width - b.w * zoom) / 2 - b.x * zoom, y: (height - b.h * zoom) / 2 - b.y * zoom, zoom })
  return true
}
function tryPendingFit(attempt = 0) {
  if (!pendingFit.value) return
  if (fitNow()) pendingFit.value = false
  else if (attempt < 40) setTimeout(() => tryPendingFit(attempt + 1), 50)
}
watch(
  () => desk.positioned.value,
  async () => {
    await nextTick()
    tryPendingFit()
  },
  { immediate: true },
)

// 画布容器尺寸变化（进入 / 退出运行视角、切换分屏方向、拖动分隔条或折叠两侧栏）后重新适应
let resizeTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [dimensions.value.width, dimensions.value.height] as const,
  ([w, h], [pw, ph]) => {
    if (!pw || !ph || (Math.abs(w - pw) < 24 && Math.abs(h - ph) < 24)) return
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(fitNow, 120)
  },
)

/** O8：本层没有核心模块、普通模块超过七个时不折叠，只在画布角提示（结构 / 交互视角同一套节点，V12） */
const foldHint = computed(() => (desk.perspective.value !== 'run' ? (desk.positioned.value?.view.foldHint ?? 0) : 0))
/** L15、U16：结构视角的画布角——收起的只引类型依赖边条数、没有代码事实时的说明 */
const structureCorner = computed(() => scene.value.structure ?? null)
const isEmpty = computed(() => desk.positioned.value !== null && desk.positioned.value.view.nodes.length === 0)
</script>

<template>
  <div ref="host" class="canvas">
    <VueFlow
      id="arch-desk"
      :min-zoom="0.1"
      :max-zoom="2.5"
      :zoom-on-double-click="false"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="false"
      :only-render-visible-elements="false"
      @node-click="onNodeClick"
      @node-double-click="onNodeDoubleClick"
      @node-context-menu="onNodeMenu"
      @edge-click="onEdgeClick"
      @pane-click="desk.select(null)"
      @node-mouse-enter="onNodeEnter"
      @node-mouse-leave="onNodeLeave"
      @error="onFlowError"
    >
      <template #node-module="p"><ModuleNode :data="p.data" /></template>
      <template #node-boundary="p"><BoundaryNode :data="p.data" /></template>
      <template #node-band="p"><BandNode :data="p.data" /></template>
      <template #node-core="p"><CoreNode :data="p.data" /></template>
      <template #node-more="p"><MoreNode :data="p.data" /></template>
      <template #node-shared="p"><SharedNode :data="p.data" /></template>
      <template #node-actor="p"><ActorNode :data="p.data" /></template>
      <template #node-frame="p"><FrameNode :data="p.data" /></template>
      <template #node-step="p"><StepBadge :data="p.data" /></template>
      <template #node-preview="p"><BranchPreview :data="p.data" /></template>
      <template #edge-route="p"><RouteEdge :id="p.id" :data="p.data" /></template>
      <template #edge-dep="p"><DepEdge :id="p.id" :data="p.data" /></template>
    </VueFlow>

    <div v-if="isEmpty" class="empty">这个模块没有子模块</div>
    <div v-if="foldHint || structureCorner" class="corner">
      <div v-if="foldHint" class="fold-hint" data-testid="fold-hint">{{ foldHint }} 个模块，考虑标出核心</div>
      <div v-if="structureCorner?.note" class="structure-note" data-testid="structure-note">{{ structureCorner.note }}</div>
      <button
        v-if="structureCorner?.typeOnlyHidden"
        class="type-only"
        data-testid="type-only-count"
        title="只引类型的依赖边缺省收起（L15）；单击画出，「显示」面板里可再收起"
        @click="structurePrefs.setTypeOnly(true)"
      >
        只引类型 {{ structureCorner.typeOnlyHidden }} 条已收起
      </button>
    </div>
    <SketchMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="[{ key: 'design', label: '在此设计', disabled: !canDesignAt(desk, menu.id) }]"
      @choose="onMenu"
      @close="menu = null"
    />
    <div v-if="stage?.hiddenCurrent" class="play-hint">
      当前步骤在本层不可见（两端都在本层之外）：
      <button class="link" @click="desk.goTo(desk.run.frameLevel.value!)">到能看到它的层次</button>
    </div>

    <div class="zoom">
      <button title="放大" @click="zoomIn()">＋</button>
      <button title="缩小" @click="zoomOut()">－</button>
      <button title="适应画布" @click="fitNow()">适应</button>
      <span class="gesture">空格 + 拖动 = 平移，Ctrl + 滚轮 = 缩放</span>
    </div>
    <DisplayPanel />
  </div>
</template>

<style scoped>
.canvas {
  position: absolute;
  inset: 0;
}

.empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  color: var(--text-3);
  pointer-events: none;
}

.play-hint {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 6;
  padding: 4px 12px;
  font-size: 12.5px;
  color: var(--warning);
  background: var(--warning-soft);
  border-radius: 14px;
}

.corner {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  pointer-events: none;
}

.structure-note,
.type-only {
  padding: 3px 10px;
  font-size: 12px;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 12px;
}

.type-only {
  pointer-events: auto;
  cursor: pointer;
}

.fold-hint {
  padding: 3px 10px;
  font-size: 12px;
  color: var(--text-2);
  background: var(--surface);
  border: 1px dashed var(--border-strong);
  border-radius: 12px;
  pointer-events: none;
}

.zoom {
  position: absolute;
  left: 12px;
  bottom: 12px;
  display: flex;
  gap: 4px;
  z-index: 5;
}

.zoom button {
  min-width: 30px;
  font-size: 12px;
  padding: 3px 8px;
}

/* 空白处直接拖动即平移（Vue Flow 缺省 panOnDrag），按住空格拖动同样平移（缺省 panActivationKeyCode） */
.zoom .gesture {
  align-self: center;
  margin-left: 6px;
  font-size: 11.5px;
  color: var(--text-3);
  pointer-events: none;
}
</style>
