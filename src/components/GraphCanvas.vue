<script setup lang="ts">
/**
 * GraphCanvas：把 PositionedView 画成节点和边；处理平移、缩放、单击、双击、悬停。
 * 运行视角下作为舞台（V5）：本层参与的节点与走过的边突出、其余变淡，当前消息沿步骤方向流动（P10），
 * 未建模的消息画临时虚线（P11），步骤序号可单击指向（R13），停在分支点时预览各选项（F6）。
 * 舞台按静态关系显示方式隐藏或淡化不参与的节点与静态边（V5、V8），「在画布上显示」的对象照常（V9）；
 * 选中步骤时其余走过的边与步骤序号淡为灰色；选中其他对象时不变灰，舞台始终按进度（R15、R16）。
 * 选中文件时，其归属模块在本层的投影节点加文件高亮（G14）。
 * 画什么由 Layout 的 canvasScene 算出（ADR-0013）；这里只把结果写入 Vue Flow、把交互转成操作、适应画布。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { MarkerType, VueFlow, useVueFlow, type Edge, type Node } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import { useDesk } from '@/state/inject'
import { contentBounds } from '@/layout/layout'
import { canvasScene, type NodeData, type RouteEdgeData } from '@/layout/canvas'
import type { StaticMode } from '@/layout/stage'
import { useStage } from './stage/useStageDisplay'
import ModuleNode from './nodes/ModuleNode.vue'
import BoundaryNode from './nodes/BoundaryNode.vue'
import BandNode from './nodes/BandNode.vue'
import CoreNode from './nodes/CoreNode.vue'
import MoreNode from './nodes/MoreNode.vue'
import ActorNode from './nodes/ActorNode.vue'
import FrameNode from './nodes/FrameNode.vue'
import StepBadge from './nodes/StepBadge.vue'
import BranchPreview from './nodes/BranchPreview.vue'
import RouteEdge from './edges/RouteEdge.vue'
import Legend from './Legend.vue'

const desk = useDesk()
const stageUi = useStage()
const { setViewport, zoomIn, zoomOut, dimensions, setNodes, setEdges } = useVueFlow('arch-desk')

/** 运行视角的舞台叠加；结构视角为 null */
const stage = computed(() => (desk.perspective.value === 'run' ? desk.run.overlay.value : null))

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
  }),
)
const nodes = computed<Node<NodeData>[]>(() => scene.value.nodes)
const edges = computed<Edge<RouteEdgeData>[]>(() =>
  scene.value.edges.map(e => ({ ...e, markerEnd: { ...e.markerEnd, type: e.markerEnd.type === 'arrow' ? MarkerType.Arrow : MarkerType.ArrowClosed } })),
)

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
  else desk.select({ kind: 'module', id: node.type === 'more' ? node.id.slice('more:'.length) : node.data!.moduleId })
}

function onNodeDoubleClick({ node }: { node: Node<NodeData> }) {
  if (node.type === 'actor' || node.type === 'frame' || node.type === 'step' || node.type === 'preview') return
  if (node.type === 'boundary') desk.revealModule(node.data!.moduleId)
  else if (node.type === 'more') desk.drillInto(node.id.slice('more:'.length))
  else desk.drillInto(node.data!.moduleId)
}

function onEdgeClick({ edge }: { edge: Edge<RouteEdgeData> }) {
  if (edge.data!.unmodeled) return
  const e = edge.data!.edge
  if (e.kind === 'direct') desk.select({ kind: 'relation', id: e.relationIds[0] })
  else desk.select({ kind: 'edge', id: e.id })
}

function onNodeEnter({ node }: { node: Node<NodeData> }) {
  if (node.type === 'core' || node.type === 'module' || node.type === 'boundary' || node.type === 'actor') desk.setHover(node.id)
}

function onNodeLeave() {
  desk.setHover(null)
}

// ── 视角：切换层次后自动适应画布 ──
// 视野：内容边界直接取自布局结果（不依赖 Vue Flow 对节点尺寸的测量，首帧即可用）；
// 只需等画布容器有尺寸，切换层次后自动适应
const pendingFit = ref(true)
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
const MODE_LABEL: Record<StaticMode, string> = { hide: '隐藏', dim: '淡显', show: '全显' }
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

const isEmpty = computed(() => desk.positioned.value !== null && desk.positioned.value.view.nodes.length === 0)
</script>

<template>
  <div class="canvas">
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
      <template #node-actor="p"><ActorNode :data="p.data" /></template>
      <template #node-frame="p"><FrameNode :data="p.data" /></template>
      <template #node-step="p"><StepBadge :data="p.data" /></template>
      <template #node-preview="p"><BranchPreview :data="p.data" /></template>
      <template #edge-route="p"><RouteEdge :id="p.id" :data="p.data" :marker-end="p.markerEnd" /></template>
    </VueFlow>

    <div v-if="isEmpty" class="empty">这个模块没有子模块</div>
    <div v-if="stage?.hiddenCurrent" class="play-hint">
      当前步骤在本层不可见（两端都在本层之外）：
      <button class="link" @click="desk.goTo(desk.run.frameLevel.value!)">到能看到它的层次</button>
    </div>

    <div class="zoom">
      <button title="放大" @click="zoomIn()">＋</button>
      <button title="缩小" @click="zoomOut()">－</button>
      <button title="适应画布" @click="fitNow()">适应</button>
      <div v-if="stage" class="static-mode" role="group" aria-label="静态关系">
        <span class="muted">静态关系</span>
        <button
          v-for="m in ['hide', 'dim', 'show'] as const"
          :key="m"
          :class="{ on: stageUi.mode.value === m }"
          :title="m === 'hide' ? '只显示参与本场景的节点与走过的边' : m === 'dim' ? '不参与的节点与静态边淡化显示' : '全部照常显示'"
          @click="stageUi.setMode(m)"
        >
          {{ MODE_LABEL[m] }}
        </button>
      </div>
    </div>
    <Legend />
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

.static-mode {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: 8px;
  padding-left: 8px;
  border-left: 1px solid var(--border);
  font-size: 12px;
}

.static-mode .muted {
  margin-right: 4px;
}

.static-mode button.on {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
}
</style>
