<script setup lang="ts">
/**
 * GraphCanvas：把 PositionedView 画成节点和边；处理平移、缩放、单击、双击、悬停。
 * 运行视角下作为舞台（V5）：本层参与的节点与走过的边突出、其余变淡，当前消息沿步骤方向流动（P10），
 * 未建模的消息画临时虚线（P11），步骤序号可单击指向（R13），停在分支点时预览各选项（F6）。
 * 舞台按静态关系显示方式隐藏或淡化不参与的节点与静态边（V5、V8），「在画布上显示」的对象照常（V9）；
 * 选中步骤时其余走过的边与步骤序号淡为灰色；选中其他对象时不变灰，舞台始终按进度（R15、R16）。
 * 选中文件时，其归属模块在本层的投影节点加文件高亮（G14）。
 * 只读 DeskState、只发操作意图，不做任何投影或布局计算。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { MarkerType, VueFlow, useVueFlow, type Edge, type Node } from '@vue-flow/core'
import { useDesk } from '@/state/inject'
import { contentBounds, edgeLabel, isBoundaryEdge, moreChipId, type Box } from '@/layout/layout'
import { stageDisplay, unmodeledId, type StaticMode, type Visibility } from '@/layout/stage'
import { useStage } from './stage/useStageDisplay'
import { FIELD_LABELS, moduleName, type ViewEdge } from '@/model'
import ModuleNode from './nodes/ModuleNode.vue'
import BoundaryNode from './nodes/BoundaryNode.vue'
import BandNode from './nodes/BandNode.vue'
import CoreNode from './nodes/CoreNode.vue'
import MoreNode from './nodes/MoreNode.vue'
import ActorNode from './nodes/ActorNode.vue'
import FrameNode from './nodes/FrameNode.vue'
import StepBadge from './nodes/StepBadge.vue'
import BranchPreview from './nodes/BranchPreview.vue'
import RouteEdge, { type RouteEdgeData } from './edges/RouteEdge.vue'
import Legend from './Legend.vue'
import type { NodeData } from './nodes/types'

const desk = useDesk()
const stageUi = useStage()
const { setViewport, zoomIn, zoomOut, dimensions, setNodes, setEdges } = useVueFlow('arch-desk')

/** 运行视角的舞台叠加；结构视角为 null */
const stage = computed(() => (desk.perspective.value === 'run' ? desk.overlay.value : null))

/** 悬停时序图中的一条消息时，它在本层的落点（预览） */
const hoverLanding = computed(() => {
  const h = desk.hoverId.value
  const sv = desk.scenarioView.value
  if (!h?.startsWith('step:') || !sv) return null
  const m = sv.messageOf.get(h.slice('step:'.length))
  return m === undefined ? null : sv.messages[m].at
})

/** 聚焦对象：悬停优先，其次是选中的模块 */
const focusId = computed(() => {
  if (desk.hoverId.value?.startsWith('step:')) return null
  if (desk.hoverId.value) return desk.hoverId.value
  const s = desk.selection.value
  if (s?.kind === 'actor') return s.id
  if (s?.kind !== 'module') return null
  // 选中的外部模块在本视图里以边界节点出现
  const pv = desk.positioned.value
  return pv && !pv.nodes.has(s.id) && pv.nodes.has(`boundary:${s.id}`) ? `boundary:${s.id}` : s.id
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

/** 回放走过的、当前的、预览的边（视图边 ID） */
const playEdges = computed(() => {
  const st = stage.value
  const ids = new Set<string>(st?.walked.keys() ?? [])
  for (const p of st?.previews ?? []) if (p.at?.kind === 'edge') ids.add(p.at.edgeId)
  if (hoverLanding.value?.kind === 'edge') ids.add(hoverLanding.value.edgeId)
  return ids
})

/** 舞台显示（V5、V8、V9）：运行视角下每个节点与边显示、淡化还是隐藏；结构视角为 null */
const display = computed(() => {
  const pv = desk.positioned.value
  if (!stage.value || !pv) return null
  const play = new Set(playEdges.value)
  const cur = stage.value.current?.at
  if (cur?.kind === 'edge') play.add(cur.edgeId)
  // V10：悬停的节点（时序图消息的悬停不算）
  const h = desk.hoverId.value
  const hover = h && !h.startsWith('step:') ? h : null
  return stageDisplay({ view: pv.view, participants: desk.stageParticipants.value, playEdges: play, mode: stageUi.mode.value, reveal: new Set(stageUi.reveal.value), hover })
})
const visOf = (id: string): Visibility => display.value?.nodes.get(id) ?? 'show'
const edgeVis = (id: string): Visibility => display.value?.edges.get(id) ?? 'show'

/** R15、R16：选中步骤的消息与配对消息所在的边；选中的不是步骤时为 null（不变灰） */
const emphMessages = computed<Set<number> | null>(() => {
  const em = desk.emphasis.value
  return em?.selected == null ? null : new Set([em.selected, ...em.paired])
})
const emphEdges = computed<Set<string> | null>(() => {
  const em = emphMessages.value
  const sv = desk.scenarioView.value
  if (!em || !sv) return null
  const ids = new Set<string>()
  for (const i of em) {
    const at = sv.messages[i]?.at
    if (at?.kind === 'edge') ids.add(at.edgeId)
    else if (at?.kind === 'unmodeled') ids.add(unmodeledId(at.from, at.to))
    else if (at?.kind === 'internal') ids.add(`node:${at.node}`)
  }
  return ids
})

/** 分层总览中显示的核心跨层边：与聚焦对象相连的、被选中的，或回放落在其上的（P7） */
const visibleCoreEdges = computed<ViewEdge[]>(() => {
  const pv = desk.positioned.value
  if (!pv?.view.coreEdges) return []
  const f = focusId.value
  return pv.view.coreEdges.filter(e => (f && (e.from === f || e.to === f)) || selectedEdgeIds.value.has(e.id) || playEdges.value.has(e.id))
})

/** 与聚焦对象相邻的节点 ID；无聚焦对象时为 null（不变淡） */
const neighborhood = computed<Set<string> | null>(() => {
  const pv = desk.positioned.value
  const f = focusId.value
  if (!pv || !f || !pv.nodes.has(f)) return null
  // 分层总览中只有核心模块与参与者参与聚焦，选中层（带）不让其他内容变淡
  if (pv.view.mode === 'layered' && !pv.view.nodes.some(n => n.id === f && (n.role === 'core' || n.role === 'actor'))) return null
  const set = new Set([f])
  const edges = pv.view.mode === 'layered' ? visibleCoreEdges.value : pv.view.edges
  for (const e of edges) {
    if (e.from === f) set.add(e.to)
    if (e.to === f) set.add(e.from)
  }
  return set
})

/** 设计版本且开启「标出变更」时的差异；否则为 null */
const marks = computed(() => (desk.toggles.showDiff ? desk.diff.value : null))

function diffOf(moduleId: string): Pick<NodeData, 'change' | 'changedFields' | 'touched'> {
  const d = marks.value
  if (!d) return {}
  const c = d.module.get(moduleId)
  return {
    change: c?.kind === 'added' || c?.kind === 'changed' ? c.kind : undefined,
    changedFields: c?.fields?.map(f => FIELD_LABELS[f] ?? f).join('、'),
    touched: d.touched.get(moduleId),
  }
}

function edgeChange(e: ViewEdge): 'added' | 'changed' | undefined {
  const d = marks.value
  if (!d) return undefined
  const kinds = e.relationIds.map(id => d.relation.get(id)?.kind)
  return kinds.includes('added') ? 'added' : kinds.includes('changed') ? 'changed' : undefined
}

/** 运行视角下节点的回放态：当前消息的端点或内部活动、悬停预览 */
function playClass(id: string): string | undefined {
  const st = stage.value
  if (!st) return undefined
  const cur = st.current?.at
  const hov = hoverLanding.value
  // P7：分层总览中同一层不同泳道之间的消息，带与两端的核心模块小块都标为活动
  const touches = (at: typeof cur | null) =>
    !!at && ((at.kind === 'internal' ? at.node === id : at.from === id || at.to === id) || at.lanes?.from === id || at.lanes?.to === id)
  if (touches(cur)) return cur!.kind === 'internal' ? 'play-current play-internal' : 'play-current'
  if (touches(hov)) return 'play-hover'
  return undefined
}

const nodes = computed<Node<NodeData>[]>(() => {
  const pv = desk.positioned.value
  const idx = desk.index.value
  if (!pv || !idx) return []
  const sel = desk.selection.value
  const near = neighborhood.value
  const st = stage.value
  const layered = pv.view.mode === 'layered'
  const out: Node<NodeData>[] = []
  // 运行视角：按舞台显示（V5、V8、V9）；结构视角：与聚焦对象无关的变淡
  const dimmed = (id: string, base: boolean) => (st ? visOf(id) === 'dim' : base)
  const hidden = (id: string) => !!st && visOf(id) === 'hide'
  const fileHit = desk.fileHits.value?.nodes
  const classOf = (id: string) => [playClass(id), fileHit?.has(id) ? 'file-hit' : ''].filter(Boolean).join(' ') || undefined
  const place = (id: string, box: Box, type: string, data: NodeData, zIndex: number) =>
    out.push({ id, type, position: { x: box.x, y: box.y }, data, zIndex, width: box.w, height: box.h, style: { width: `${box.w}px`, height: `${box.h}px` }, selectable: false, draggable: false, connectable: false, class: classOf(id) })

  if (pv.frame) {
    place('frame', pv.frame, 'frame', { moduleId: pv.view.parentId, name: moduleName(idx, pv.view.parentId), childCount: 0, selected: false, dim: false }, -1)
  }
  for (const n of pv.view.nodes) {
    const box = pv.nodes.get(n.id)
    if (!box || hidden(n.id)) continue
    if (n.role === 'actor') {
      const a = idx.actors.get(n.moduleId)
      const data = { moduleId: n.moduleId, name: a?.name ?? n.moduleId, actor: a, actorKind: n.actorKind, childCount: 0 }
      place(n.id, box, 'actor', { ...data, selected: sel?.kind === 'actor' && sel.id === n.moduleId, dim: dimmed(n.id, !!near && !near.has(n.id)) }, 2)
      continue
    }
    const m = idx.modules.get(n.moduleId)
    const base: NodeData = {
      moduleId: n.moduleId,
      name: m?.name ?? n.moduleId,
      module: m,
      childCount: idx.childrenOf.get(n.moduleId)?.length ?? 0,
      selected: sel?.kind === 'module' && sel.id === n.moduleId,
      // 分层总览中带不参与变淡，只有核心模块会
      dim: dimmed(n.id, !!near && !near.has(n.id) && !(layered && n.role === 'layer')),
      ...diffOf(n.moduleId),
    }
    if (n.role === 'boundary') {
      const path = (idx.pathOf.get(n.moduleId) ?? []).slice(1, -1).map(id => idx.modules.get(id)?.name ?? id)
      place(n.id, box, 'boundary', { ...base, path: path.length ? path.join(' / ') : idx.model.system.name }, 1)
    } else if (n.role === 'layer') {
      const band = pv.view.bands?.find(b => b.layerId === n.id)
      place(n.id, box, 'band', { ...base, band: { abstraction: m?.abstraction, mayDependOn: (m?.mayDependOn ?? []).map(id => idx.modules.get(id)?.name ?? id), hiddenCount: band?.hiddenCount ?? 0 } }, 0)
      const more = pv.nodes.get(moreChipId(n.id))
      if (more && band) place(moreChipId(n.id), more, 'more', { ...base, selected: false, dim: !!st || !!near, hiddenCount: band.hiddenCount }, 2)
    } else {
      place(n.id, box, n.role === 'core' ? 'core' : 'module', base, 2)
    }
  }

  // 步骤序号（可单击指向该步）与分支预览序号（可单击选这一支）
  const sv = desk.scenarioView.value
  if (st && sv) {
    const current = st.current?.index
    const em = emphMessages.value
    for (const mark of st.walked.values()) {
      if (!mark.at) continue
      const steps = mark.steps.map(n => ({ n, frameId: sv.messages[n - 1].frameIds[0], current: n - 1 === current, muted: !!em && !em.has(n - 1) }))
      place(`step:${mark.edgeId}`, { ...mark.at, w: 1, h: 1 }, 'step', { moduleId: '', name: '', childCount: 0, selected: false, dim: false, steps }, 6)
    }
    const point = desk.branchPoint.value
    for (const p of st.previews) {
      if (!p.pos || !point) continue
      place(`preview:${p.option}`, { ...p.pos, w: 1, h: 1 }, 'preview', { moduleId: '', name: '', childCount: 0, selected: false, dim: false, preview: { pointId: point.id, option: p.option, label: p.label } }, 7)
    }
  }
  return out
})

/** 回放态：当前（带方向）、走过、预览、悬停 */
function playOf(id: string): Pick<RouteEdgeData, 'play' | 'flowReverse'> {
  const st = stage.value
  if (!st) return {}
  const cur = st.current?.at
  const curId = cur?.kind === 'edge' ? cur.edgeId : cur?.kind === 'unmodeled' ? unmodeledId(cur.from, cur.to) : null
  if (curId === id) return { play: 'current', flowReverse: cur!.kind === 'edge' ? cur!.reverse : false }
  const hov = hoverLanding.value
  if (hov && (hov.kind === 'edge' ? hov.edgeId : hov.kind === 'unmodeled' ? unmodeledId(hov.from, hov.to) : null) === id) return { play: 'hover' }
  if (st.previews.some(p => p.at?.kind === 'edge' && p.at.edgeId === id)) return { play: 'preview' }
  if (st.walked.has(id)) return { play: 'walked' }
  return {}
}

/** 临时边（未建模、预览）用的视图边外形 */
const tempEdge = (id: string, from: string, to: string): ViewEdge => ({ id, kind: 'direct', from, to, type: 'calls', types: [], relationIds: [], mode: 'sync' })

const edges = computed<Edge<RouteEdgeData>[]>(() => {
  const pv = desk.positioned.value
  if (!pv) return []
  const near = neighborhood.value
  const f = focusId.value
  const st = stage.value
  const layered = pv.view.mode === 'layered'
  const make = (e: ViewEdge, route: RouteEdgeData['route'] | undefined, core: boolean, extra: Partial<RouteEdgeData> = {}): Edge<RouteEdgeData> | null => {
    if (!route) return null
    const selected = selectedEdgeIds.value.has(e.id)
    const touchesFocus = !!f && (e.from === f || e.to === f)
    const play = playOf(e.id)
    return {
      id: core ? `core:${e.id}` : e.id,
      source: e.from,
      target: e.to,
      type: 'route',
      zIndex: play.play === 'current' ? 5 : core ? 3 : 1,
      markerEnd: { type: e.type === 'implements' ? MarkerType.Arrow : MarkerType.ArrowClosed, color: `var(--rel-${e.type})`, width: 14, height: 14 },
      data: {
        route,
        edge: e,
        // 运行视角下走过的边由步骤序号标注，不再标类型
        label: st && play.play ? '' : edgeLabel(e),
        selected,
        core,
        change: edgeChange(e),
        // 运行视角：按舞台显示（V5、V8）；分层总览：层间边在聚焦核心模块时变淡；普通层次：与聚焦对象无关的边变淡
        dim: st ? !play.play && !selected && edgeVis(e.id) === 'dim' : layered ? !!near && !core && !selected : !!near && !touchesFocus && !selected,
        // R15：选中步骤时，不属于选中 / 配对消息的走过的边淡为灰色
        muted: play.play === 'walked' && !!emphEdges.value && !emphEdges.value.has(e.id),
        ...play,
        ...extra,
      },
    }
  }
  // 边界边默认隐藏：只在聚焦（悬停 / 选中）其任一端、被选中或回放经过时出现，避免外部关系淹没内部结构
  const revealed = new Set(stageUi.reveal.value)
  const boundaryShown = (e: ViewEdge) =>
    selectedEdgeIds.value.has(e.id) || playEdges.value.has(e.id) || (!!f && (e.from === f || e.to === f)) || (!!st && (stageUi.mode.value === 'show' || revealed.has(e.from) || revealed.has(e.to)))
  const list = pv.view.edges
    .filter(e => !st || edgeVis(e.id) !== 'hide' || playEdges.value.has(e.id) || selectedEdgeIds.value.has(e.id) || playOf(e.id).play)
    .filter(e => !isBoundaryEdge(e) || boundaryShown(e))
    .map(e => make(e, pv.edges.get(e.id), false))
  if (layered) list.push(...visibleCoreEdges.value.map(e => make(e, pv.coreEdges.get(e.id), true)))
  // P11：结构中未建模的消息画临时虚线，不参与布局；分支预览落在未建模处同样画虚线
  for (const u of st?.unmodeled ?? [])
    list.push(make(tempEdge(u.edgeId, u.from, u.to), u.route, false, { unmodeled: true, label: '未建模', muted: !!emphEdges.value && !emphEdges.value.has(u.edgeId) }))
  for (const p of st?.previews ?? []) {
    if (p.at?.kind !== 'unmodeled' || !p.route) continue
    const id = unmodeledId(p.at.from, p.at.to)
    if (!st!.walked.has(id)) list.push(make(tempEdge(id, p.at.from, p.at.to), p.route, false, { unmodeled: true, play: 'preview', label: '' }))
  }
  return list.filter((e): e is Edge<RouteEdgeData> => e !== null)
})

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
const visibleIds = computed<Set<string> | null>(() => {
  const d = display.value
  if (!d || ![...d.nodes.values()].includes('hide')) return null
  return new Set([...d.nodes].filter(([, v]) => v !== 'hide').map(([id]) => id))
})
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
      <button class="link" @click="desk.goTo(desk.frameLevel.value!)">到能看到它的层次</button>
    </div>

    <div class="zoom">
      <button title="放大" @click="zoomIn()">＋</button>
      <button title="缩小" @click="zoomOut()">－</button>
      <button title="适应画布" @click="fitNow()">适应</button>
      <div v-if="stage" class="static-mode" role="group" aria-label="静态关系">
        <span class="muted">静态关系</span>
        <button
          v-for="m in (['hide', 'dim', 'show'] as const)"
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
