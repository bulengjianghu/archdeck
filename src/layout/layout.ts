/**
 * Layout：给 LevelView 算坐标与边的走线。
 * - graph：elkjs layered 算法，自上而下（或自左向右），全部节点（含边界节点与参与者）进 elk，每条边两端各有固定朝向的端口，正交走线（L4、L11）；
 * - layered：按层序分带，规则排布，不调用 elk（规则 O2、O3，见 docs/02-domain.md）。
 * 结果按视图内容缓存，同样的输入得到同样的输出。
 */
import type { ELK, ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api'
import type { LevelView, ViewEdge, ViewNode } from '@/model'

export interface Point {
  x: number
  y: number
}

export interface Box extends Point {
  w: number
  h: number
}

export interface EdgeRoute {
  points: Point[]
  /** 曲线（分层总览的核心跨层边与参与者的边、回放临时线、代码依赖叠加线）还是折线；'h' 为从侧边出发的横向曲线 */
  curve?: boolean | 'h'
  label?: Point
}

export interface PositionedView {
  view: LevelView
  nodes: Map<string, Box>
  edges: Map<string, EdgeRoute>
  /** layered：核心跨层边的走线 */
  coreEdges: Map<string, EdgeRoute>
  /** 有外部参与者时：内部结构外的边界框（根层为系统边界，A7） */
  frame?: Box
}

export const NODE_SIZE = { module: { w: 208, h: 76 }, boundary: { w: 176, h: 48 }, actor: { w: 160, h: 52 } }
export const BAND = {
  left: 236,
  right: 168,
  minMiddle: 520,
  chip: { w: 168, h: 46 },
  chipGap: 14,
  padY: 18,
  minH: 104,
  gap: 64,
  lane: 22,
  /** 系统边界框与带、右侧通道之间的留白 */
  framePad: 20,
  /** O7：带内每行模块块的上限 */
  maxColumns: 8,
}

/** 没有画布宽度时的带内列数 */
export const DEFAULT_BAND_COLUMNS = 5

export interface LayoutOptions {
  /** O7：分层总览的带内列数（bandColumnsFor 由画布宽度得出） */
  bandColumns?: number
}

// ── 分层总览 ─────────────────────────────────────────────────

/** 带内「+N 个其他模块」占位块的 ID */
export function moreChipId(layerId: string): string {
  return `more:${layerId}`
}

/** O7：带内每行能放几个模块块——按画布宽度铺开，至少 3、至多 BAND.maxColumns */
export function bandColumnsFor(canvasWidth: number): number {
  const fit = Math.floor((canvasWidth - BAND.left - BAND.right - BAND.chipGap) / (BAND.chip.w + BAND.chipGap))
  return Math.max(3, Math.min(BAND.maxColumns, fit))
}

/** 带内有占位块（「+N 个其他模块」或展开后的「收起」） */
const hasChip = (b: { hiddenCount: number; expanded?: number }) => b.hiddenCount > 0 || !!b.expanded

export function layoutLayered(view: LevelView, opts: LayoutOptions = {}): PositionedView {
  const bands = view.bands ?? []
  const nodes = new Map<string, Box>()
  const columns = opts.bandColumns ?? DEFAULT_BAND_COLUMNS
  const maxCore = Math.max(1, ...bands.map(b => b.coreModuleIds.length + (hasChip(b) ? 1 : 0)))
  const perRow = Math.max(3, Math.min(maxCore, columns))
  // O7：带宽按画布铺开（列数给出），内容少时也不缩窄
  const middle = Math.max(BAND.minMiddle, columns * (BAND.chip.w + BAND.chipGap) - BAND.chipGap + 2 * BAND.chipGap)
  const width = BAND.left + middle + BAND.right

  let y = 0
  const bandIndex = new Map<string, number>()
  bands.forEach((band, i) => {
    bandIndex.set(band.layerId, i)
    const slots = band.coreModuleIds.length + (hasChip(band) ? 1 : 0)
    const rows = Math.max(1, Math.ceil(slots / perRow))
    const h = Math.max(BAND.minH, rows * BAND.chip.h + (rows - 1) * BAND.chipGap + 2 * BAND.padY)
    nodes.set(band.layerId, { x: 0, y, w: width, h })
    const rowTop = y + (h - (rows * BAND.chip.h + (rows - 1) * BAND.chipGap)) / 2
    const chipBox = (k: number): Box => ({
      x: BAND.left + BAND.chipGap + (k % perRow) * (BAND.chip.w + BAND.chipGap),
      y: rowTop + Math.floor(k / perRow) * (BAND.chip.h + BAND.chipGap),
      w: BAND.chip.w,
      h: BAND.chip.h,
    })
    band.coreModuleIds.forEach((id, k) => nodes.set(id, chipBox(k)))
    if (hasChip(band)) nodes.set(moreChipId(band.layerId), chipBox(band.coreModuleIds.length))
    y += h + BAND.gap
  })

  // 边界节点（嵌套的分层子系统才会有）放在最下方一行
  const boundaries = view.nodes.filter(n => n.role === 'boundary')
  boundaries.forEach((n, i) => nodes.set(n.id, { x: i * (NODE_SIZE.boundary.w + 24), y, ...sizeOf(n) }))

  const edges = new Map<string, EdgeRoute>()
  // 相邻层之间：带间空隙里的竖线，同一空隙内的多条边横向错开
  // 跨多层：走右侧通道，每条占一条车道
  const gapSlots = new Map<string, number>()
  let lane = 0
  for (const e of view.edges) {
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    if (!a || !b) continue
    const ia = bandIndex.get(e.from)
    const ib = bandIndex.get(e.to)
    if (ia !== undefined && ib !== undefined && Math.abs(ia - ib) === 1) {
      const key = `${Math.min(ia, ib)}`
      const slot = gapSlots.get(key) ?? 0
      gapSlots.set(key, slot + 1)
      const x = BAND.left + middle / 2 + (slot % 2 === 0 ? 1 : -1) * Math.ceil(slot / 2) * 112
      const down = ia < ib
      const y1 = down ? a.y + a.h : a.y
      const y2 = down ? b.y : b.y + b.h
      edges.set(e.id, {
        points: [
          { x, y: y1 },
          { x, y: y2 },
        ],
        label: { x, y: (y1 + y2) / 2 },
      })
    } else {
      const x = width + 28 + lane * BAND.lane
      lane++
      const y1 = a.y + a.h / 2 + (lane % 3) * 8 - 8
      const y2 = b.y + b.h / 2 + (lane % 3) * 8 - 8
      edges.set(e.id, {
        points: [
          { x: a.x + a.w, y: y1 },
          { x, y: y1 },
          { x, y: y2 },
          { x: b.x + b.w, y: y2 },
        ],
        label: { x, y: (y1 + y2) / 2 },
      })
    }
  }

  // 系统边界框包住全部带与右侧通道，四周留 BAND.framePad，不与带的外沿重合
  const pad = BAND.framePad
  const right = lane ? width + 28 + (lane - 1) * BAND.lane : width
  const frame = { x: -pad, y: -pad, w: right + 2 * pad, h: Math.max(0, y - BAND.gap) + 2 * pad }
  // A7：用户在带的上方一行，外部系统与时间在右侧通道之外一列；与参与者相连的边画成曲线
  placeActors(view, nodes, frame, width + 28 + lane * BAND.lane + 56 - frame.x - frame.w)
  const offsets = parallelOffsets(view.edges)
  for (const e of view.edges) {
    if (edges.has(e.id)) continue
    const route = actorRoute(nodes.get(e.from), nodes.get(e.to))
    if (route) edges.set(e.id, shifted(route, offsets.get(e.id) ?? 0))
  }

  const coreEdges = new Map<string, EdgeRoute>()
  const coreOffsets = parallelOffsets(view.coreEdges ?? [])
  for (const e of view.coreEdges ?? []) {
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    if (!a || !b) continue
    const actorEnd = isActorNode(view, e.from) || isActorNode(view, e.to)
    const d = coreOffsets.get(e.id) ?? 0
    if (actorEnd) {
      coreEdges.set(e.id, shifted(actorRoute(a, b)!, d))
      continue
    }
    const down = a.y < b.y
    const p1 = { x: a.x + a.w / 2, y: down ? a.y + a.h : a.y }
    const p2 = { x: b.x + b.w / 2, y: down ? b.y : b.y + b.h }
    coreEdges.set(e.id, shifted({ points: [p1, p2], curve: true, label: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } }, d))
  }

  return { view, nodes, edges, coreEdges, ...(hasActors(view) ? { frame } : {}) }
}

// ── 外部参与者（A7）────────────────────────────────────────────

const isActorNode = (view: LevelView, id: string) => view.nodes.some(n => n.id === id && n.role === 'actor')
const hasActors = (view: LevelView) => view.nodes.some(n => n.role === 'actor')
export const ACTOR_GAP = 72

/**
 * 参与者排布：用户类在边界框上方一行，外部系统与时间类在右侧一列（离边界框 rightGap）；
 * 按所连内部节点的位置排序以减少交叉。
 */
export function placeActors(view: LevelView, nodes: Map<string, Box>, frame: Box, rightGap = ACTOR_GAP) {
  const actors = view.nodes.filter(n => n.role === 'actor')
  if (actors.length === 0) return
  const kindOf = (id: string) => view.nodes.find(n => n.id === id)?.actorKind ?? 'system'
  const anchor = (id: string, axis: 'x' | 'y') => {
    const vs = view.edges
      .filter(e => e.from === id || e.to === id)
      .map(e => nodes.get(e.from === id ? e.to : e.from))
      .filter((b): b is Box => !!b)
      .map(b => (axis === 'x' ? b.x + b.w / 2 : b.y + b.h / 2))
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : axis === 'x' ? frame.x + frame.w / 2 : frame.y + frame.h / 2
  }
  const { w, h } = NODE_SIZE.actor
  const gap = 20
  const users = actors.filter(a => kindOf(a.id) === 'user').sort((a, b) => anchor(a.id, 'x') - anchor(b.id, 'x'))
  const others = actors.filter(a => kindOf(a.id) !== 'user').sort((a, b) => anchor(a.id, 'y') - anchor(b.id, 'y'))
  let x = frame.x + frame.w / 2 - (users.length * w + (users.length - 1) * gap) / 2
  for (const a of users) {
    nodes.set(a.id, { x, y: frame.y - ACTOR_GAP - h, w, h })
    x += w + gap
  }
  let y = frame.y + frame.h / 2 - (others.length * h + (others.length - 1) * gap) / 2
  for (const a of others) {
    nodes.set(a.id, { x: frame.x + frame.w + rightGap, y, w, h })
    y += h + gap
  }
}

/** 两个盒子之间的曲线：上下错开时从上下边出发，否则从侧边出发（参与者的边、回放中的临时线） */
export function linkRoute(a?: Box, b?: Box): EdgeRoute | undefined {
  return actorRoute(a, b)
}

/** 参与者与内部节点之间的曲线：上方的参与者从底边出发，右侧的从左边出发 */
function actorRoute(a?: Box, b?: Box): EdgeRoute | undefined {
  if (!a || !b) return undefined
  const port = (box: Box, other: Box): Point => {
    if (other.y + other.h <= box.y) return { x: box.x + box.w / 2, y: box.y }
    if (other.y >= box.y + box.h) return { x: box.x + box.w / 2, y: box.y + box.h }
    return other.x >= box.x + box.w ? { x: box.x + box.w, y: box.y + box.h / 2 } : { x: box.x, y: box.y + box.h / 2 }
  }
  const p1 = port(a, b)
  const p2 = port(b, a)
  const side = p1.y !== a.y && p1.y !== a.y + a.h
  return { points: [p1, p2], curve: side ? 'h' : true, label: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } }
}

/** 节点与走线的总外框，用于适应画布；给出 only 时只取这些节点（运行视角隐藏静态内容时，V5） */
export function contentBounds(pv: PositionedView, only?: ReadonlySet<string>): Box | null {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  const add = (x: number, y: number) => {
    x1 = Math.min(x1, x)
    y1 = Math.min(y1, y)
    x2 = Math.max(x2, x)
    y2 = Math.max(y2, y)
  }
  for (const [id, b] of pv.nodes) {
    if (only && !only.has(id)) continue
    add(b.x, b.y)
    add(b.x + b.w, b.y + b.h)
  }
  if (!only) for (const r of pv.edges.values()) for (const p of r.points) add(p.x, p.y)
  if (x1 === Infinity) return null
  return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) }
}

// ── 普通层次 ─────────────────────────────────────────────────

export function sizeOf(n: ViewNode): { w: number; h: number } {
  return n.role === 'boundary' ? NODE_SIZE.boundary : n.role === 'actor' ? NODE_SIZE.actor : NODE_SIZE.module
}

/** L10：标签只标聚合条数——含多条关系的边为 `×N`，其余为空；类型名不进标签（靠颜色、图例与面板） */
export function edgeLabel(e: ViewEdge): string {
  const n = e.relationIds.length
  return n > 1 ? `×${n}` : ''
}

/** L10：线宽档位——聚合条数 1 / 2–4 / ≥5 */
export function edgeWeight(e: ViewEdge): 1 | 2 | 3 {
  const n = e.relationIds.length
  return n >= 5 ? 3 : n >= 2 ? 2 : 1
}

/** 平行边的错开量（px） */
export const PARALLEL_GAP = 10
/** 点是否落在折线包围盒向外扩 pad 的范围内 */
export function nearPoints(p: Point, pts: readonly Point[], pad: number): boolean {
  const xs = pts.map(q => q.x)
  const ys = pts.map(q => q.y)
  return p.x >= Math.min(...xs) - pad && p.x <= Math.max(...xs) + pad && p.y >= Math.min(...ys) - pad && p.y <= Math.max(...ys) + pad
}
/** elk 标签槽的最小尺寸：放得下「?」或「×N」 */
export const LABEL_SLOT = { w: 24, h: 18 }

/**
 * L10：同一对节点之间（不论方向）的多条边按序号对称错开，序号按边在视图中的顺序；只有一条的为 0。
 * elk 排的边各有端口、自行错开，这里用于分层总览的曲线（参与者的边、核心跨层边）。
 */
export function parallelOffsets(edges: readonly ViewEdge[]): Map<string, number> {
  const groups = new Map<string, string[]>()
  for (const e of edges) {
    const k = e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`
    groups.set(k, [...(groups.get(k) ?? []), e.id])
  }
  const out = new Map<string, number>()
  for (const ids of groups.values()) ids.forEach((id, i) => out.set(id, (i - (ids.length - 1) / 2) * PARALLEL_GAP))
  return out
}

/**
 * 平行边（同一对节点，L5）的终点锚点沿目标节点边缘错开 PARALLEL_GAP，箭头不叠压。
 * 只动终点重合的边：最后一段竖直时横移最后两点，水平时纵移——前一段仍保持正交。
 */
export function spreadEnds(viewEdges: readonly ViewEdge[], edges: Map<string, EdgeRoute>) {
  const groups = new Map<string, string[]>()
  for (const e of viewEdges) {
    const r = edges.get(e.id)
    if (!r || r.points.length < 2) continue
    const end = r.points[r.points.length - 1]
    const k = `${e.to}|${Math.round(end.x)},${Math.round(end.y)}`
    groups.set(k, [...(groups.get(k) ?? []), e.id])
  }
  for (const ids of groups.values()) {
    if (ids.length < 2) continue
    ids.forEach((id, i) => {
      const d = (i - (ids.length - 1) / 2) * PARALLEL_GAP
      const r = edges.get(id)!
      const pts = r.points.map(p => ({ ...p }))
      const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]]
      const vertical = Math.abs(a.x - b.x) < 0.5
      for (const p of [a, b]) {
        if (vertical) p.x += d
        else p.y += d
      }
      edges.set(id, { ...r, points: pts })
    })
  }
}

/** 曲线整体错开：上下出发的曲线横移，侧边出发的（'h'）纵移 */
function shifted(route: EdgeRoute, d: number): EdgeRoute {
  if (!d) return route
  const mv = (p: Point): Point => (route.curve === 'h' ? { x: p.x, y: p.y + d } : { x: p.x + d, y: p.y })
  return { ...route, points: route.points.map(mv), ...(route.label ? { label: mv(route.label) } : {}) }
}

const isBoundary = (id: string) => id.startsWith('boundary:')

/** 内部边（两端都不是边界节点）交给 elk；边界边另行绘制 */
export function isBoundaryEdge(e: ViewEdge): boolean {
  return isBoundary(e.from) || isBoundary(e.to)
}

/**
 * L4、L11：普通层次全部节点交给 elk——用户在第一行（DOWN；RIGHT 为第一列），内部子模块居中，边界节点与外部系统、时间在最后一行，
 * 最后一行的顺序按视图节点顺序（边界节点按层次顺序，P9）；边由 elk 正交绕行，不穿节点。
 * 用层约束（FIRST / LAST）而不用分区：分区时边界节点会被排成两行；最后一行的顺序用 semiInteractive 的位置提示固定。
 */
export type Row = 'first' | 'inner' | 'last'

export function rowOf(n: ViewNode): Row {
  if (n.role === 'boundary') return 'last'
  if (n.role === 'actor') return n.actorKind === 'user' ? 'first' : 'last'
  return 'inner'
}

/**
 * L11：端口方向——每条边在两端各有自己的端口，边固定（FIXED_SIDE）、顺序由 elk 排以减少交叉。
 * 内部节点进边在上、出边在下（RIGHT：左进右出）；最先一行的用户只朝下（右），最后几行的边界节点、外部系统只朝上（左）。
 */
export function portSide(n: ViewNode, end: 'in' | 'out', direction: 'DOWN' | 'RIGHT'): 'NORTH' | 'SOUTH' | 'WEST' | 'EAST' {
  const row = rowOf(n)
  const forward = row === 'first' ? true : row === 'inner' ? end === 'out' : false
  return direction === 'DOWN' ? (forward ? 'SOUTH' : 'NORTH') : forward ? 'EAST' : 'WEST'
}

export function toElkGraph(view: LevelView, direction: 'DOWN' | 'RIGHT' = 'DOWN'): ElkNode {
  const byId = new Map(view.nodes.map(n => [n.id, n]))
  const lastRow = [...view.nodes.filter(n => n.role === 'boundary'), ...view.nodes.filter(n => n.role === 'actor' && rowOf(n) === 'last')].map(n => n.id)
  const ports = new Map<string, { id: string; width: number; height: number; layoutOptions: Record<string, string> }[]>(view.nodes.map(n => [n.id, []]))
  const port = (node: string, id: string, end: 'in' | 'out') => {
    ports.get(node)!.push({ id, width: 1, height: 1, layoutOptions: { 'elk.port.side': portSide(byId.get(node)!, end, direction) } })
    return id
  }
  const edges = view.edges
    .filter(e => byId.has(e.from) && byId.has(e.to))
    // L5：同一对节点按类型的平行边各有端口，由 elk 错开。
    // 每条边都申请一个至少放得下「?」或「×N」的标签槽：事实标记在布局后才叠加，槽太小时 elk 可能不给坐标（画布另有中点兜底）
    .map<ElkExtendedEdge>(e => {
      const text = edgeLabel(e)
      return {
        id: e.id,
        sources: [port(e.from, `${e.id}#out`, 'out')],
        targets: [port(e.to, `${e.id}#in`, 'in')],
        labels: [{ id: `${e.id}#label`, text, width: Math.max(LABEL_SLOT.w, text.length * 7 + 18), height: LABEL_SLOT.h }],
      }
    })
  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.crossingMinimization.semiInteractive': 'true',
      'elk.layered.spacing.nodeNodeBetweenLayers': '72',
      'elk.spacing.nodeNode': '44',
      'elk.spacing.edgeNode': '24',
      'elk.spacing.edgeEdge': '14',
      'elk.spacing.portPort': '12',
      'elk.layered.spacing.edgeNodeBetweenLayers': '24',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.edgeLabels.inline': 'true',
    },
    children: view.nodes.map(n => {
      const row = rowOf(n)
      const last = row === 'last' ? lastRow.indexOf(n.id) : -1
      return {
        id: n.id,
        width: sizeOf(n).w,
        height: sizeOf(n).h,
        ports: ports.get(n.id),
        layoutOptions: {
          'elk.portConstraints': 'FIXED_SIDE',
          ...(row === 'inner' ? {} : { 'elk.layered.layering.layerConstraint': row === 'first' ? 'FIRST' : 'LAST' }),
          // 位置提示只用来定最后一行的先后：边界节点按视图顺序（层次顺序），其后是外部系统与时间
          ...(last >= 0 ? { 'elk.position': direction === 'DOWN' ? `(${last * 1000},0)` : `(0,${last * 1000})` } : {}),
        },
      }
    }),
    edges,
  }
}

export function fromElkGraph(view: LevelView, graph: ElkNode): PositionedView {
  const nodes = new Map<string, Box>()
  for (const c of graph.children ?? []) nodes.set(c.id, { x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? 0, h: c.height ?? 0 })
  const edges = new Map<string, EdgeRoute>()
  for (const e of (graph.edges ?? []) as ElkExtendedEdge[]) {
    const s = e.sections?.[0]
    if (!s) continue
    const lbl = e.labels?.[0]
    const points = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]
    const label = lbl && lbl.x !== undefined ? { x: lbl.x + (lbl.width ?? 0) / 2, y: (lbl.y ?? 0) + (lbl.height ?? 0) / 2 } : undefined
    // elk 有时把没放下的标签留在原点：离走线太远的标签坐标不用，交给画布按走线中点放（canvas/edges.ts routeMidpoint）
    edges.set(e.id, { points, ...(label && nearPoints(label, points, LABEL_SLOT.w + LABEL_SLOT.h) ? { label } : {}) })
  }
  spreadEnds(view.edges, edges)
  if (!hasActors(view)) return { view, nodes, edges, coreEdges: new Map() }
  // A7：有参与者时画内部结构的边界框（不含边界节点与参与者）
  const inner = view.nodes.filter(n => rowOf(n) === 'inner').map(n => nodes.get(n.id)!)
  const pad = 28
  const frame = inner.length
    ? (() => {
        const x1 = Math.min(...inner.map(b => b.x)) - pad
        const y1 = Math.min(...inner.map(b => b.y)) - pad
        return { x: x1, y: y1, w: Math.max(...inner.map(b => b.x + b.w)) + pad - x1, h: Math.max(...inner.map(b => b.y + b.h)) + pad - y1 }
      })()
    : { x: 0, y: 0, w: NODE_SIZE.module.w, h: NODE_SIZE.module.h }
  return { view, nodes, edges, coreEdges: new Map(), frame }
}

let elkPromise: Promise<ELK> | undefined

/** 浏览器里用 Worker 跑 elk，测试等无 Worker 环境用同步打包版 */
function getElk(): Promise<ELK> {
  elkPromise ??= (async () => {
    if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
      const [{ default: ElkApi }, { default: ElkWorker }] = await Promise.all([import('elkjs/lib/elk-api.js'), import('elkjs/lib/elk-worker.min.js?worker')])
      return new ElkApi({ workerFactory: () => new ElkWorker() })
    }
    const { default: ElkBundled } = await import('elkjs/lib/elk.bundled.js')
    return new ElkBundled()
  })()
  return elkPromise
}

/** 画布大致的宽高比；布局结果越接近它，适应画布后缩放越小 */
const TARGET_ASPECT = 1.4

/**
 * 普通层次先自上而下排；若结果又高又窄（依赖链长），再试自左向右，取宽高比更接近画布的一种。
 */
async function layoutGraph(view: LevelView): Promise<PositionedView> {
  const elk = await getElk()
  const down = fromElkGraph(view, await elk.layout(toElkGraph(view, 'DOWN')))
  const score = (pv: PositionedView) => {
    const b = contentBounds(pv)
    return b ? Math.abs(Math.log(b.w / b.h / TARGET_ASPECT)) : 0
  }
  const b = contentBounds(down)
  if (!b || b.w / b.h > TARGET_ASPECT / 2) return down
  const right = fromElkGraph(view, await elk.layout(toElkGraph(view, 'RIGHT')))
  return score(right) < score(down) ? right : down
}

const cache = new Map<string, PositionedView>()
const CACHE_LIMIT = 64

/** 布局算法的版本：端口、层约束等选项改了就升，旧结果不再命中 */
export const LAYOUT_VERSION = 'L11-ports-1'

export function cacheKey(view: LevelView, opts: LayoutOptions = {}): string {
  return JSON.stringify([
    LAYOUT_VERSION,
    view.mode === 'layered' ? (opts.bandColumns ?? DEFAULT_BAND_COLUMNS) : 0,
    view.mode,
    view.parentId,
    view.nodes.map(n => (n.actorKind ? `${n.id}:${n.actorKind}` : n.id)),
    view.edges.map(e => [e.id, e.relationIds.length]),
  ])
}

export async function layoutView(view: LevelView, opts: LayoutOptions = {}): Promise<PositionedView> {
  const key = cacheKey(view, opts)
  const hit = cache.get(key)
  if (hit) return { ...hit, view }
  let result: PositionedView
  if (view.mode === 'layered') result = layoutLayered(view, opts)
  else if (view.nodes.length === 0) result = { view, nodes: new Map(), edges: new Map(), coreEdges: new Map() }
  else result = await layoutGraph(view)
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  cache.set(key, result)
  return result
}
