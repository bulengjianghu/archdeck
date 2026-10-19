<script setup lang="ts">
/**
 * GraphCanvas：把 PositionedView 画成节点和边；处理平移、缩放、单击、双击、悬停。
 * 只读 DeskState、只发操作意图，不做任何投影或布局计算。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { MarkerType, VueFlow, useVueFlow, type Edge, type Node } from '@vue-flow/core'
import { useDesk } from '@/state/inject'
import { contentBounds, edgeLabel, moreChipId, type Box } from '@/layout/layout'
import type { ViewEdge } from '@/model'
import ModuleNode from './nodes/ModuleNode.vue'
import BoundaryNode from './nodes/BoundaryNode.vue'
import BandNode from './nodes/BandNode.vue'
import CoreNode from './nodes/CoreNode.vue'
import MoreNode from './nodes/MoreNode.vue'
import RouteEdge, { type RouteEdgeData } from './edges/RouteEdge.vue'
import Legend from './Legend.vue'
import type { NodeData } from './nodes/types'

const desk = useDesk()
const { setViewport, zoomIn, zoomOut, dimensions } = useVueFlow('arch-desk')

/** 焦点：悬停优先，其次是选中的模块 */
const focusId = computed(() => {
  if (desk.hoverId.value) return desk.hoverId.value
  const s = desk.selection.value
  return s?.kind === 'module' ? s.id : null
})

const selectedEdgeIds = computed(() => {
  const s = desk.selection.value
  const pv = desk.positioned.value
  if (!s || !pv) return new Set<string>()
  if (s.kind === 'edge') return new Set([s.id])
  if (s.kind === 'relation') {
    const all = [...pv.view.edges, ...(pv.view.coreEdges ?? [])]
    return new Set(all.filter(e => e.relationIds.includes(s.id)).map(e => e.id))
  }
  return new Set<string>()
})

/** 分层总览中显示的核心跨层边：与焦点相连的，或被选中的 */
const visibleCoreEdges = computed<ViewEdge[]>(() => {
  const pv = desk.positioned.value
  if (!pv?.view.coreEdges) return []
  const f = focusId.value
  return pv.view.coreEdges.filter(e => (f && (e.from === f || e.to === f)) || selectedEdgeIds.value.has(e.id))
})

/** 与焦点相邻的节点 ID；无焦点时为 null（不变淡） */
const neighborhood = computed<Set<string> | null>(() => {
  const pv = desk.positioned.value
  const f = focusId.value
  if (!pv || !f || !pv.nodes.has(f)) return null
  // 分层总览中只有核心模块参与聚焦，选中层（带）不让其他内容变淡
  if (pv.view.mode === 'layered' && !pv.view.nodes.some(n => n.id === f && n.role === 'core')) return null
  const set = new Set([f])
  const edges = pv.view.mode === 'layered' ? visibleCoreEdges.value : pv.view.edges
  for (const e of edges) {
    if (e.from === f) set.add(e.to)
    if (e.to === f) set.add(e.from)
  }
  return set
})

const nodes = computed<Node<NodeData>[]>(() => {
  const pv = desk.positioned.value
  const idx = desk.index.value
  if (!pv || !idx) return []
  const sel = desk.selection.value
  const near = neighborhood.value
  const layered = pv.view.mode === 'layered'
  const out: Node<NodeData>[] = []
  const place = (id: string, box: Box, type: string, data: NodeData, zIndex: number) =>
    out.push({ id, type, position: { x: box.x, y: box.y }, data, zIndex, width: box.w, height: box.h, style: { width: `${box.w}px`, height: `${box.h}px` }, selectable: false, draggable: false, connectable: false })

  for (const n of pv.view.nodes) {
    const box = pv.nodes.get(n.id)
    if (!box) continue
    const m = idx.modules.get(n.moduleId)
    const base: NodeData = {
      moduleId: n.moduleId,
      name: m?.name ?? n.moduleId,
      module: m,
      childCount: idx.childrenOf.get(n.moduleId)?.length ?? 0,
      selected: sel?.kind === 'module' && sel.id === n.moduleId,
      // 分层总览中带不参与变淡，只有核心模块会
      dim: !!near && !near.has(n.id) && !(layered && n.role === 'layer'),
    }
    if (n.role === 'boundary') {
      const path = (idx.pathOf.get(n.moduleId) ?? []).slice(1, -1).map(id => idx.modules.get(id)?.name ?? id)
      place(n.id, box, 'boundary', { ...base, path: path.length ? path.join(' / ') : idx.model.system.name }, 1)
    } else if (n.role === 'layer') {
      const band = pv.view.bands?.find(b => b.layerId === n.id)
      place(n.id, box, 'band', { ...base, band: { abstraction: m?.abstraction, mayDependOn: (m?.mayDependOn ?? []).map(id => idx.modules.get(id)?.name ?? id), hiddenCount: band?.hiddenCount ?? 0 } }, 0)
      const more = pv.nodes.get(moreChipId(n.id))
      if (more && band) place(moreChipId(n.id), more, 'more', { ...base, selected: false, dim: !!near, hiddenCount: band.hiddenCount }, 2)
    } else {
      place(n.id, box, n.role === 'core' ? 'core' : 'module', base, 2)
    }
  }
  return out
})

const edges = computed<Edge<RouteEdgeData>[]>(() => {
  const pv = desk.positioned.value
  if (!pv) return []
  const near = neighborhood.value
  const f = focusId.value
  const layered = pv.view.mode === 'layered'
  const make = (e: ViewEdge, route: RouteEdgeData['route'] | undefined, core: boolean): Edge<RouteEdgeData> | null => {
    if (!route) return null
    const selected = selectedEdgeIds.value.has(e.id)
    const touchesFocus = !!f && (e.from === f || e.to === f)
    return {
      id: core ? `core:${e.id}` : e.id,
      source: e.from,
      target: e.to,
      type: 'route',
      zIndex: core ? 3 : 1,
      markerEnd: { type: e.type === 'implements' ? MarkerType.Arrow : MarkerType.ArrowClosed, color: `var(--rel-${e.type})`, width: 14, height: 14 },
      data: {
        route,
        edge: e,
        label: edgeLabel(e),
        selected,
        core,
        // 分层总览：层间边在聚焦核心模块时变淡；普通层次：与焦点无关的边变淡
        dim: layered ? !!near && !core && !selected : !!near && !touchesFocus && !selected,
      },
    }
  }
  const list = pv.view.edges.map(e => make(e, pv.edges.get(e.id), false))
  if (layered) list.push(...visibleCoreEdges.value.map(e => make(e, pv.coreEdges.get(e.id), true)))
  return list.filter((e): e is Edge<RouteEdgeData> => e !== null)
})

// ── 交互 ──
function onNodeClick({ node }: { node: Node<NodeData> }) {
  desk.select({ kind: 'module', id: node.type === 'more' ? node.id.slice('more:'.length) : node.data!.moduleId })
}

function onNodeDoubleClick({ node }: { node: Node<NodeData> }) {
  if (node.type === 'boundary') desk.revealModule(node.data!.moduleId)
  else if (node.type === 'more') desk.drillInto(node.id.slice('more:'.length))
  else desk.drillInto(node.data!.moduleId)
}

function onEdgeClick({ edge }: { edge: Edge<RouteEdgeData> }) {
  const e = edge.data!.edge
  if (e.kind === 'direct') desk.select({ kind: 'relation', id: e.relationIds[0] })
  else desk.select({ kind: 'edge', id: e.id })
}

function onNodeEnter({ node }: { node: Node<NodeData> }) {
  if (node.type === 'core' || node.type === 'module' || node.type === 'boundary') desk.setHover(node.id)
}

function onNodeLeave() {
  desk.setHover(null)
}

// ── 视角：切换层次后自动适应画布 ──
// 视野：内容边界直接取自布局结果（不依赖 Vue Flow 对节点尺寸的测量，首帧即可用）；
// 只需等画布容器有尺寸，切换层次后自动适应
const pendingFit = ref(true)
watch(desk.levelVersion, () => (pendingFit.value = true))
function fitNow(): boolean {
  const pv = desk.positioned.value
  const { width, height } = dimensions.value
  if (!pv || width === 0 || height === 0) return false
  const b = contentBounds(pv)
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

const isEmpty = computed(() => desk.positioned.value !== null && desk.positioned.value.view.nodes.length === 0)
</script>

<template>
  <div class="canvas">
    <VueFlow
      id="arch-desk"
      :nodes="nodes"
      :edges="edges"
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
    >
      <template #node-module="p"><ModuleNode :data="p.data" /></template>
      <template #node-boundary="p"><BoundaryNode :data="p.data" /></template>
      <template #node-band="p"><BandNode :data="p.data" /></template>
      <template #node-core="p"><CoreNode :data="p.data" /></template>
      <template #node-more="p"><MoreNode :data="p.data" /></template>
      <template #edge-route="p"><RouteEdge :id="p.id" :data="p.data" :marker-end="p.markerEnd" /></template>
    </VueFlow>

    <div v-if="isEmpty" class="empty">这个模块没有子模块</div>

    <div class="zoom">
      <button title="放大" @click="zoomIn()">＋</button>
      <button title="缩小" @click="zoomOut()">－</button>
      <button title="适应画布" @click="fitNow()">适应</button>
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
</style>
