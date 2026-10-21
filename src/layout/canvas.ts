/**
 * 画布场景（ADR-0013）：把带坐标的层次视图换成画布要画的节点与边——位置、类型、数据（选中、变淡、设计版本标记、回放态、
 * 选中突出的灰化）、类名、层级，以及运行视角下适应画布用的可见节点。纯函数，与 stageOverlay、stageDisplay 同属 Layout；
 * 画布组件只把结果写入 Vue Flow、把交互转成操作。规则见 docs/architecture/workbench.md §4。
 *   结构视角：聚焦对象（悬停优先、其次选中）不相邻的节点与边变淡；核心跨层边只在聚焦核心模块时出现（O4）；边界边只在聚焦其一端或被选中时出现（L4）。
 *   运行视角：舞台显示决定显隐与淡化（V5、V8、V9、V10）；回放叠加（P7、P10、P11、F6）；选中步骤时其余走过的边与步骤序号变灰（R15、R16）。
 *   选中文件：归属模块在本层的投影节点加文件高亮（G14）。
 */
import { FIELD_LABELS, moduleName, type ActorEntity, type ActorKind, type ModelDiff, type ModelIndex, type ModuleEntity, type ScenarioLevelView, type ViewEdge } from '@/model'
import { edgeLabel, isBoundaryEdge, moreChipId, type Box, type EdgeRoute, type PositionedView } from './layout'
import { stageDisplay, unmodeledId, type StageOverlay, type StaticMode, type Visibility } from './stage'

/** 画布节点的公共数据 */
export interface NodeData {
  moduleId: string
  name: string
  module?: ModuleEntity
  childCount: number
  selected: boolean
  /** 结构视角有聚焦对象（悬停 / 选中）时，与它无关的节点变淡；运行视角按舞台显示 */
  dim: boolean
  /** 边界节点：外部模块所在路径 */
  path?: string
  /** 带（层）专用 */
  band?: { abstraction?: string; mayDependOn: string[]; hiddenCount: number }
  /** +N 占位块 */
  hiddenCount?: number
  /** 设计版本：本模块相对对比基线新增或修改 */
  change?: 'added' | 'changed'
  /** 修改了哪些字段（显示用） */
  changedFields?: string
  /** 设计版本：涉及其子树或相关关系的变更条数 */
  touched?: number
  /** 外部参与者节点 */
  actor?: ActorEntity
  actorKind?: ActorKind
  /** 运行视角：步骤序号（结构图上的序号标记） */
  steps?: { n: number; frameId: string; current: boolean; muted?: boolean }[]
  /** 运行视角：分支点某个选项的预览 */
  preview?: { pointId: string; option: number; label: string }
}

export interface RouteEdgeData {
  route: EdgeRoute
  edge: ViewEdge
  label: string
  selected: boolean
  dim: boolean
  /** 核心跨层边，只在悬停/选中时出现 */
  core?: boolean
  /** 设计版本：边包含新增或修改的关系 */
  change?: 'added' | 'changed'
  /** 运行视角：当前消息、走过、分支预览、时序图悬停预览 */
  play?: 'current' | 'walked' | 'preview' | 'hover'
  /** R15：选中步骤时，不属于选中 / 配对消息的走过的边淡为灰色 */
  muted?: boolean
  /** 当前消息与边的箭头方向相反（P10） */
  flowReverse?: boolean
  /** 结构中未建模的临时线（P11） */
  unmodeled?: boolean
}

export type CanvasNodeType = 'frame' | 'module' | 'boundary' | 'band' | 'core' | 'more' | 'actor' | 'step' | 'preview'

/** 与 Vue Flow 的节点同形 */
export interface CanvasNode {
  id: string
  type: CanvasNodeType
  position: { x: number; y: number }
  data: NodeData
  zIndex: number
  width: number
  height: number
  style: { width: string; height: string }
  selectable: false
  draggable: false
  connectable: false
  class?: string
}

/** 与 Vue Flow 的边同形；箭头类型由画布换成 Vue Flow 的枚举 */
export interface CanvasEdge {
  id: string
  source: string
  target: string
  type: 'route'
  zIndex: number
  markerEnd: { type: 'arrow' | 'arrowclosed'; color: string; width: number; height: number }
  data: RouteEdgeData
}

export interface CanvasInput {
  positioned: PositionedView | null
  index: ModelIndex | null
  selection: { kind: string; id: string } | null
  /** 悬停：视图节点 ID，或 `step:<帧 ID>`（悬停时序图消息） */
  hover: string | null
  /** 运行视角的舞台叠加；结构视角为 null */
  stage: StageOverlay | null
  scenarioView: ScenarioLevelView | null
  /** 选中突出：选中步骤所在的可见消息与配对消息（R15、R16）；选中的不是步骤时 selected 为 null */
  emphasis: { selected: number | null; paired: ReadonlySet<number> } | null
  /** 参与本场景的舞台节点（V5） */
  participants: ReadonlyMap<string, 'path' | 'other'>
  /** 静态关系显示方式与「在画布上显示」的节点（V8、V9） */
  mode: StaticMode
  reveal: readonly string[]
  /** 设计版本且开启「标出变更」时的差异；否则为 null */
  diff: ModelDiff | null
  /** G14：选中文件在本层投影的节点 */
  fileHits: ReadonlySet<string> | null
  /** 停在分支点时的分支点 ID（分支预览用） */
  branchPointId: string | null
}

export interface CanvasScene {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  /** V5：运行视角隐藏了静态内容时只按这些节点适应画布；否则为 null（取全部内容） */
  visibleIds: Set<string> | null
}

/** 临时边（未建模、预览）用的视图边外形 */
const tempEdge = (id: string, from: string, to: string): ViewEdge => ({ id, kind: 'direct', from, to, type: 'calls', types: [], relationIds: [], mode: 'sync' })

export function canvasScene(input: CanvasInput): CanvasScene {
  const { positioned: pv, index: idx, selection: sel, hover, stage: st, scenarioView: sv } = input
  if (!pv) return { nodes: [], edges: [], visibleIds: null }
  const layered = pv.view.mode === 'layered'

  /** 悬停时序图中的一条消息时，它在本层的落点（预览） */
  const hoverLanding = (() => {
    if (!hover?.startsWith('step:') || !sv) return null
    const m = sv.messageOf.get(hover.slice('step:'.length))
    return m === undefined ? null : sv.messages[m].at
  })()

  /** 聚焦对象：悬停优先，其次是选中的模块（选中的外部模块在本视图里以边界节点出现） */
  const focusId = (() => {
    if (hover?.startsWith('step:')) return null
    if (hover) return hover
    if (sel?.kind === 'actor') return sel.id
    if (sel?.kind !== 'module') return null
    return !pv.nodes.has(sel.id) && pv.nodes.has(`boundary:${sel.id}`) ? `boundary:${sel.id}` : sel.id
  })()

  const selectedEdgeIds = (() => {
    if (sel?.kind === 'edge') return new Set([sel.id])
    if (sel?.kind === 'relation') return new Set([...pv.view.edges, ...(pv.view.coreEdges ?? [])].filter(e => e.relationIds.includes(sel.id)).map(e => e.id))
    return new Set<string>()
  })()

  /** 回放走过的、预览的、悬停预览的边（视图边 ID） */
  const playEdges = new Set<string>(st?.walked.keys() ?? [])
  for (const p of st?.previews ?? []) if (p.at?.kind === 'edge') playEdges.add(p.at.edgeId)
  if (hoverLanding?.kind === 'edge') playEdges.add(hoverLanding.edgeId)

  /** 舞台显示（V5、V8、V9、V10）：运行视角下每个节点与边显示、淡化还是隐藏 */
  const display = (() => {
    if (!st) return null
    const play = new Set(playEdges)
    const cur = st.current?.at
    if (cur?.kind === 'edge') play.add(cur.edgeId)
    // V10：悬停的节点（时序图消息的悬停不算）
    const h = hover && !hover.startsWith('step:') ? hover : null
    return stageDisplay({ view: pv.view, participants: input.participants, playEdges: play, mode: input.mode, reveal: new Set(input.reveal), hover: h })
  })()
  const visOf = (id: string): Visibility => display?.nodes.get(id) ?? 'show'
  const edgeVis = (id: string): Visibility => display?.edges.get(id) ?? 'show'

  /** R15、R16：选中步骤的消息与配对消息，以及它们所在的边；选中的不是步骤时为 null（不变灰） */
  const em = input.emphasis
  const emphMessages = em?.selected == null ? null : new Set([em.selected, ...em.paired])
  const emphEdges = (() => {
    if (!emphMessages || !sv) return null
    const ids = new Set<string>()
    for (const i of emphMessages) {
      const at = sv.messages[i]?.at
      if (at?.kind === 'edge') ids.add(at.edgeId)
      else if (at?.kind === 'unmodeled') ids.add(unmodeledId(at.from, at.to))
      else if (at?.kind === 'internal') ids.add(`node:${at.node}`)
    }
    return ids
  })()

  /** 分层总览中显示的核心跨层边：与聚焦对象相连的、被选中的，或回放落在其上的（P7） */
  const visibleCoreEdges = (pv.view.coreEdges ?? []).filter(
    e => (focusId && (e.from === focusId || e.to === focusId)) || selectedEdgeIds.has(e.id) || playEdges.has(e.id),
  )

  /** 与聚焦对象相邻的节点 ID；无聚焦对象时为 null（不变淡） */
  const near = (() => {
    const f = focusId
    if (!f || !pv.nodes.has(f)) return null
    // 分层总览中只有核心模块与参与者参与聚焦，选中层（带）不让其他内容变淡
    if (layered && !pv.view.nodes.some(n => n.id === f && (n.role === 'core' || n.role === 'actor'))) return null
    const set = new Set([f])
    for (const e of layered ? visibleCoreEdges : pv.view.edges) {
      if (e.from === f) set.add(e.to)
      if (e.to === f) set.add(e.from)
    }
    return set
  })()

  const marks = input.diff
  function diffOf(moduleId: string): Pick<NodeData, 'change' | 'changedFields' | 'touched'> {
    if (!marks) return {}
    const c = marks.module.get(moduleId)
    return {
      change: c?.kind === 'added' || c?.kind === 'changed' ? c.kind : undefined,
      changedFields: c?.fields?.map(f => FIELD_LABELS[f] ?? f).join('、'),
      touched: marks.touched.get(moduleId),
    }
  }
  function edgeChange(e: ViewEdge): 'added' | 'changed' | undefined {
    if (!marks) return undefined
    const kinds = e.relationIds.map(id => marks.relation.get(id)?.kind)
    return kinds.includes('added') ? 'added' : kinds.includes('changed') ? 'changed' : undefined
  }

  /** 运行视角下节点的回放态：当前消息的端点或内部活动、悬停预览 */
  function playClass(id: string): string | undefined {
    if (!st) return undefined
    const cur = st.current?.at
    // P7：分层总览中同一层不同泳道之间的消息，带与两端的核心模块小块都标为活动
    const touches = (at: typeof cur | null) =>
      !!at && ((at.kind === 'internal' ? at.node === id : at.from === id || at.to === id) || at.lanes?.from === id || at.lanes?.to === id)
    if (touches(cur)) return cur!.kind === 'internal' ? 'play-current play-internal' : 'play-current'
    if (touches(hoverLanding)) return 'play-hover'
    return undefined
  }

  // ── 节点 ──
  const nodes: CanvasNode[] = []
  if (idx) {
    // 运行视角：按舞台显示（V5、V8、V9）；结构视角：与聚焦对象无关的变淡
    const dimmed = (id: string, base: boolean) => (st ? visOf(id) === 'dim' : base)
    const hidden = (id: string) => !!st && visOf(id) === 'hide'
    const classOf = (id: string) => [playClass(id), input.fileHits?.has(id) ? 'file-hit' : ''].filter(Boolean).join(' ') || undefined
    const place = (id: string, box: Box, type: CanvasNodeType, data: NodeData, zIndex: number) =>
      nodes.push({
        id,
        type,
        position: { x: box.x, y: box.y },
        data,
        zIndex,
        width: box.w,
        height: box.h,
        style: { width: `${box.w}px`, height: `${box.h}px` },
        selectable: false,
        draggable: false,
        connectable: false,
        class: classOf(id),
      })

    if (pv.frame) place('frame', pv.frame, 'frame', { moduleId: pv.view.parentId, name: moduleName(idx, pv.view.parentId), childCount: 0, selected: false, dim: false }, -1)
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
    if (st && sv) {
      const current = st.current?.index
      for (const mark of st.walked.values()) {
        if (!mark.at) continue
        const steps = mark.steps.map(n => ({ n, frameId: sv.messages[n - 1].frameIds[0], current: n - 1 === current, muted: !!emphMessages && !emphMessages.has(n - 1) }))
        place(`step:${mark.edgeId}`, { ...mark.at, w: 1, h: 1 }, 'step', { moduleId: '', name: '', childCount: 0, selected: false, dim: false, steps }, 6)
      }
      for (const p of st.previews) {
        if (!p.pos || !input.branchPointId) continue
        const preview = { pointId: input.branchPointId, option: p.option, label: p.label }
        place(`preview:${p.option}`, { ...p.pos, w: 1, h: 1 }, 'preview', { moduleId: '', name: '', childCount: 0, selected: false, dim: false, preview }, 7)
      }
    }
  }

  // ── 边 ──
  /** 回放态：当前（带方向）、走过、预览、悬停 */
  function playOf(id: string): Pick<RouteEdgeData, 'play' | 'flowReverse'> {
    if (!st) return {}
    const cur = st.current?.at
    const curId = cur?.kind === 'edge' ? cur.edgeId : cur?.kind === 'unmodeled' ? unmodeledId(cur.from, cur.to) : null
    if (curId === id) return { play: 'current', flowReverse: cur!.kind === 'edge' ? cur!.reverse : false }
    const hov = hoverLanding
    if (hov && (hov.kind === 'edge' ? hov.edgeId : hov.kind === 'unmodeled' ? unmodeledId(hov.from, hov.to) : null) === id) return { play: 'hover' }
    if (st.previews.some(p => p.at?.kind === 'edge' && p.at.edgeId === id)) return { play: 'preview' }
    if (st.walked.has(id)) return { play: 'walked' }
    return {}
  }

  const f = focusId
  const make = (e: ViewEdge, route: EdgeRoute | undefined, core: boolean, extra: Partial<RouteEdgeData> = {}): CanvasEdge | null => {
    if (!route) return null
    const selected = selectedEdgeIds.has(e.id)
    const touchesFocus = !!f && (e.from === f || e.to === f)
    const play = playOf(e.id)
    return {
      id: core ? `core:${e.id}` : e.id,
      source: e.from,
      target: e.to,
      type: 'route',
      zIndex: play.play === 'current' ? 5 : core ? 3 : 1,
      markerEnd: { type: e.type === 'implements' ? 'arrow' : 'arrowclosed', color: `var(--rel-${e.type})`, width: 14, height: 14 },
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
        muted: play.play === 'walked' && !!emphEdges && !emphEdges.has(e.id),
        ...play,
        ...extra,
      },
    }
  }
  // 边界边默认隐藏：只在聚焦（悬停 / 选中）其任一端、被选中或回放经过时出现，避免外部关系淹没内部结构
  const revealed = new Set(input.reveal)
  const boundaryShown = (e: ViewEdge) =>
    selectedEdgeIds.has(e.id) || playEdges.has(e.id) || (!!f && (e.from === f || e.to === f)) || (!!st && (input.mode === 'show' || revealed.has(e.from) || revealed.has(e.to)))
  const list = pv.view.edges
    .filter(e => !st || edgeVis(e.id) !== 'hide' || playEdges.has(e.id) || selectedEdgeIds.has(e.id) || playOf(e.id).play)
    .filter(e => !isBoundaryEdge(e) || boundaryShown(e))
    .map(e => make(e, pv.edges.get(e.id), false))
  if (layered) list.push(...visibleCoreEdges.map(e => make(e, pv.coreEdges.get(e.id), true)))
  // P11：结构中未建模的消息画临时虚线，不参与布局；分支预览落在未建模处同样画虚线
  for (const u of st?.unmodeled ?? [])
    list.push(make(tempEdge(u.edgeId, u.from, u.to), u.route, false, { unmodeled: true, label: '未建模', muted: !!emphEdges && !emphEdges.has(u.edgeId) }))
  for (const p of st?.previews ?? []) {
    if (p.at?.kind !== 'unmodeled' || !p.route) continue
    const id = unmodeledId(p.at.from, p.at.to)
    if (!st!.walked.has(id)) list.push(make(tempEdge(id, p.at.from, p.at.to), p.route, false, { unmodeled: true, play: 'preview', label: '' }))
  }

  const visibleIds = display && [...display.nodes.values()].includes('hide') ? new Set([...display.nodes].filter(([, v]) => v !== 'hide').map(([id]) => id)) : null
  return { nodes, edges: list.filter((e): e is CanvasEdge => e !== null), visibleIds }
}
