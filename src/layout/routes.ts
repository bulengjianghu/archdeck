/**
 * 手工走线与边界：参与者排布与曲线（A7）、边的标签与线宽档、平行边错开（L10），边界边的判定（L4）。
 */
import type { LevelView, ViewEdge } from '@/model'
import { NODE_SIZE, type Box, type EdgeRoute, type Point, type PositionedView } from './geometry'
import { detour, type PortAt } from './routing'

// ── 外部参与者（A7）────────────────────────────────────────────

export const isActorNode = (view: LevelView, id: string) => view.nodes.some(n => n.id === id && n.role === 'actor')
export const hasActors = (view: LevelView) => view.nodes.some(n => n.role === 'actor')
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
export function actorRoute(a?: Box, b?: Box): EdgeRoute | undefined {
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
export function shifted(route: EdgeRoute, d: number): EdgeRoute {
  if (!d) return route
  const mv = (p: Point): Point => (route.curve === 'h' ? { x: p.x, y: p.y + d } : { x: p.x + d, y: p.y })
  return { ...route, points: route.points.map(mv), ...(route.label ? { label: mv(route.label) } : {}) }
}

const isBoundary = (id: string) => id.startsWith('boundary:')

/** 内部边（两端都不是边界节点）交给 elk；边界边另行绘制 */
export function isBoundaryEdge(e: ViewEdge): boolean {
  return isBoundary(e.from) || isBoundary(e.to)
}

// ── 框外的元素：方位表示角色（A7、L4）──────────────────────────

/** 父模块框到边界节点行、边界节点行到系统框（px） */
export const BOUNDARY_GAP = 40
export const SYSTEM_PAD = 28

/**
 * 方位：用户在系统框上方，外部系统与时间在系统框右侧，边界节点在父模块框下方、系统框之内，其余在父模块框内。
 * 方位固定在屏幕上，不随普通层次的布局方向（自上而下 / 自左向右）改变。
 */
export type Compass = 'top' | 'right' | 'bottom' | 'inner'

export function compassOf(n: { role?: string; actorKind?: string }): Compass {
  if (n.role === 'boundary') return 'bottom'
  if (n.role === 'actor') return n.actorKind === 'user' ? 'top' : 'right'
  return 'inner'
}

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
const expand = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d })

/**
 * 给定父模块框（已包住内部节点与走线），摆放框外的元素：边界节点在它下方一行（按视图顺序，即层次顺序），
 * 系统框包住父模块框与边界节点行（有边界节点时留 SYSTEM_PAD，没有时与父模块框重合）；参与者按方位放在系统框外（placeActors）。
 * 没有边界节点也没有参与者时不给系统框。rightGap 为外部系统离系统框的距离（分层总览要让出右侧通道）。
 */
export function placeOutside(view: LevelView, nodes: Map<string, Box>, parentFrame: Box, rightGap = ACTOR_GAP): Box | undefined {
  const bs = view.nodes.filter(n => n.role === 'boundary')
  if (!bs.length && !hasActors(view)) return undefined
  let frame = parentFrame
  if (bs.length) {
    const { w, h } = NODE_SIZE.boundary
    const gap = 20
    const rowW = bs.length * w + (bs.length - 1) * gap
    const x0 = parentFrame.x + parentFrame.w / 2 - rowW / 2
    const y = parentFrame.y + parentFrame.h + BOUNDARY_GAP
    bs.forEach((n, i) => nodes.set(n.id, { x: x0 + i * (w + gap), y, w, h }))
    frame = expand(union(parentFrame, { x: x0, y, w: rowW, h }), SYSTEM_PAD)
  }
  placeActors(view, nodes, frame, rightGap)
  return frame
}

// ── 框外元素的边按需走线（A7、L4、L11）──────────────────────────

/** 同一节点同一侧多条边的短桩逐条加长量（px） */
const LANE_GAP = 6
/** 加长量的上限：短桩不超出层间空隙（72）的一半 */
const MAX_LANE = 22

/** 框外元素的边（参与者的边、边界边）：普通层次不参与布局，要画时才走线 */
export const isOutsideEdge = (view: LevelView, e: ViewEdge) => isBoundaryEdge(e) || isActorNode(view, e.from) || isActorNode(view, e.to)

/** 走线按节点布局记忆：同一份布局里每条边只算一次（布局本身另按视图内容缓存） */
const outsideMemo = new WeakMap<Map<string, Box>, Map<string, EdgeRoute | undefined>>()

/**
 * 一条边的走线：布局给出的直接用；普通层次中框外元素的边不参与布局，第一次要画时按方位与端口方向正交绕行（不穿节点，从目标的入口侧进入）。
 */
export function edgeRoute(pv: PositionedView, e: ViewEdge): EdgeRoute | undefined {
  const laid = pv.edges.get(e.id)
  if (laid || pv.view.mode === 'layered' || !isOutsideEdge(pv.view, e)) return laid
  let memo = outsideMemo.get(pv.nodes)
  if (!memo) outsideMemo.set(pv.nodes, (memo = new Map()))
  // 走线依赖同一节点上其他框外边的序号：视图的这类边（如关系类型筛选后）不同则另算
  const key = `${e.id}|${pv.view.edges
    .filter(x => isOutsideEdge(pv.view, x))
    .map(x => x.id)
    .join(',')}`
  if (!memo.has(key)) memo.set(key, outsideRoute(pv, e))
  return memo.get(key)
}

/**
 * 端口按方位：用户在底边朝下、外部系统在左边朝左、边界节点在顶边朝上；内部节点进边在入口侧（自上而下为顶边，自左向右为左边）、
 * 出边在出口侧（底边 / 右边，L11）。同一节点同一侧的多条边沿该边错开 PARALLEL_GAP，短桩逐条加长。
 */
export function portFor(box: Box, compass: Compass, end: 'in' | 'out', direction: 'DOWN' | 'RIGHT', slot: { i: number; n: number }, stub?: number): PortAt {
  const along = (len: number) => Math.max(-len / 2 + 8, Math.min(len / 2 - 8, (slot.i - (slot.n - 1) / 2) * PARALLEL_GAP))
  const lane = Math.min(slot.i * LANE_GAP, MAX_LANE)
  const side =
    compass === 'top'
      ? 'bottom'
      : compass === 'right'
        ? 'left'
        : compass === 'bottom'
          ? 'top'
          : direction === 'DOWN'
            ? end === 'in'
              ? 'top'
              : 'bottom'
            : end === 'in'
              ? 'left'
              : 'right'
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const base = { lane, ...(stub !== undefined ? { stub } : {}) }
  if (side === 'top') return { x: cx + along(box.w), y: box.y, dir: -1, ...base }
  if (side === 'bottom') return { x: cx + along(box.w), y: box.y + box.h, dir: 1, ...base }
  if (side === 'left') return { x: box.x, y: cy + along(box.h), dir: -1, axis: 'h', ...base }
  return { x: box.x + box.w, y: cy + along(box.h), dir: 1, axis: 'h', ...base }
}

/** 终点短桩再按起点上的序号加长：同一起点出发、去往同一行的几条边各走一条横线，不重叠 */
export const withSourceLane = (p: PortAt, from: { i: number }): PortAt => ({ ...p, lane: Math.min((p.lane ?? 0) + from.i * LANE_GAP, MAX_LANE) })

/** 同一节点上（同一类）边的序号，用于错开 */
export function slotOf(edges: readonly ViewEdge[], node: string, id: string): { i: number; n: number } {
  const mine = edges.filter(x => x.from === node || x.to === node)
  return {
    i: Math.max(
      0,
      mine.findIndex(x => x.id === id),
    ),
    n: mine.length,
  }
}

function outsideRoute(pv: PositionedView, e: ViewEdge): EdgeRoute | undefined {
  const a = pv.nodes.get(e.from)
  const b = pv.nodes.get(e.to)
  const na = pv.view.nodes.find(n => n.id === e.from)
  const nb = pv.view.nodes.find(n => n.id === e.to)
  if (!a || !b || !na || !nb) return undefined
  const dir = pv.direction ?? 'DOWN'
  const outside = pv.view.edges.filter(x => isOutsideEdge(pv.view, x))
  const fs = slotOf(outside, e.from, e.id)
  const from = portFor(a, compassOf(na), 'out', dir, fs)
  const to = withSourceLane(portFor(b, compassOf(nb), 'in', dir, slotOf(outside, e.to, e.id)), fs)
  // 两端自身也是障碍：中间三段（横、竖通道、横）都在两端的短桩之外，不能穿过它们
  return { points: detour(from, to, [...pv.nodes.values()]) }
}
