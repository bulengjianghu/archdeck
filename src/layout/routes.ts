/**
 * 手工走线与边界：参与者排布与曲线（A7）、边的标签与线宽档、平行边错开（L10），边界边的判定（L4）。
 */
import type { LevelView, ViewEdge } from '@/model'
import { NODE_SIZE, type Box, type EdgeRoute, type Point } from './geometry'

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
