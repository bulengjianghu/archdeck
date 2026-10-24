/**
 * 结构视角的直连走线（L15，第七轮 T4 起；协调者 2026-10-25 裁决）：结构边不参与布局、不走正交、不绕框——
 * 从起点节点边缘到终点节点边缘画直线，穿过其他节点时允许压在节点下方（节点画在边之上）。
 * 同一对节点之间的边（双向、按种类分的各条）沿法向平行错开、互不重合：先排正向（起点 ID 小的一方出发）、后排反向，
 * 所以双向的两组各在中线一侧。分层总览的带是整行宽的盒子，带与带之间的边画成竖直的直线，按带对沿带宽均匀铺开。
 * 交互视角与运行视角的正交走线（L11、O3）不走这里。
 */
import type { Box, EdgeRoute, Point, PositionedView } from './geometry'
import { BAND } from './layered'

/** 一条要走线的结构边：ID 与两端视图节点 */
export interface DepLink {
  id: string
  from: string
  to: string
}

/** 同一对节点之间平行边的间距（px） */
export const DIRECT_GAP = 9

const center = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

/** 从盒内一点 p 朝 q 的射线与盒子边缘的交点（p 在盒外时取 p 本身） */
export function rimPoint(box: Box, p: Point, q: Point): Point {
  const dx = q.x - p.x
  const dy = q.y - p.y
  const inside = p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h
  if (!inside || (!dx && !dy)) return p
  const tx = dx > 0 ? (box.x + box.w - p.x) / dx : dx < 0 ? (box.x - p.x) / dx : Infinity
  const ty = dy > 0 ? (box.y + box.h - p.y) / dy : dy < 0 ? (box.y - p.y) / dy : Infinity
  const t = Math.min(tx, ty, 1)
  return { x: p.x + dx * t, y: p.y + dy * t }
}

/** 按无序节点对分组：正向（from < to）在前、反向在后，组内按 ID */
function pairGroups(links: readonly DepLink[]): DepLink[][] {
  const groups = new Map<string, DepLink[]>()
  for (const e of links) {
    const k = e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`
    groups.set(k, [...(groups.get(k) ?? []), e])
  }
  const fwd = (e: DepLink) => (e.from < e.to ? 0 : 1)
  return [...groups.values()].map(list => [...list].sort((a, b) => fwd(a) - fwd(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))
}

/** 错开量：组内序号对称铺开，但不超出两端较小盒子的半宽 / 半高（留 4 px） */
function offsetOf(i: number, n: number, a: Box, b: Box): number {
  const limit = Math.max(0, Math.min(a.w, a.h, b.w, b.h) / 2 - 4)
  const step = n > 1 ? Math.min(DIRECT_GAP, (2 * limit) / (n - 1)) : 0
  return (i - (n - 1) / 2) * step
}

/**
 * L15：两节点之间的直连——两端中心连线（沿法向错开 offset，法向按无序对的正向取，双向两条落在两侧）在各自盒子边缘截断。
 * 标签在中点。
 */
export function directRoute(a: Box, b: Box, offset = 0, forward = true): EdgeRoute {
  const ca = center(a)
  const cb = center(b)
  const [s, t] = forward ? [ca, cb] : [cb, ca]
  const len = Math.hypot(t.x - s.x, t.y - s.y) || 1
  const nx = -(t.y - s.y) / len
  const ny = (t.x - s.x) / len
  const p = { x: ca.x + nx * offset, y: ca.y + ny * offset }
  const q = { x: cb.x + nx * offset, y: cb.y + ny * offset }
  const start = rimPoint(a, p, q)
  const end = rimPoint(b, q, p)
  return { points: [start, end], label: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } }
}

/** L15：一组结构边的直连走线（普通层次的全部、分层总览中带间之外的） */
export function directRoutes(pv: PositionedView, links: readonly DepLink[]): Map<string, EdgeRoute> {
  const out = new Map<string, EdgeRoute>()
  for (const list of pairGroups(links))
    list.forEach((e, i) => {
      const a = pv.nodes.get(e.from)
      const b = pv.nodes.get(e.to)
      if (!a || !b) return
      out.set(e.id, directRoute(a, b, offsetOf(i, list.length, a, b), e.from < e.to))
    })
  return out
}

/**
 * O13③、L15：分层总览中带与带之间的结构边——竖直直线，从起点带的上 / 下边缘到终点带的下 / 上边缘，
 * 跨多层的穿过中间的带（压在带内的块下方）。带对按层序排好后沿带的中间区域均匀铺开，同一对内的各条按 DIRECT_GAP 错开。
 */
export function bandDirectRoutes(pv: PositionedView, links: readonly DepLink[]): Map<string, EdgeRoute> {
  const bands = pv.view.bands ?? []
  const out = new Map<string, EdgeRoute>()
  if (!bands.length || !links.length) return out
  const order = new Map(bands.map((b, i) => [b.layerId, i]))
  const first = pv.nodes.get(bands[0].layerId)
  if (!first) return out
  const left = first.x + BAND.left
  const width = Math.max(0, first.w - BAND.left - BAND.right)
  const groups = pairGroups(links.filter(e => order.has(e.from) && order.has(e.to))).sort((p, q) => {
    const rank = (g: DepLink[]) => {
      const [i, j] = [order.get(g[0].from)!, order.get(g[0].to)!].sort((x, y) => x - y)
      return [i, j] as const
    }
    const [pi, pj] = rank(p)
    const [qi, qj] = rank(q)
    return pi - qi || pj - qj
  })
  groups.forEach((list, k) => {
    const cx = left + ((k + 1) * width) / (groups.length + 1)
    list.forEach((e, i) => {
      const a = pv.nodes.get(e.from)
      const b = pv.nodes.get(e.to)
      if (!a || !b) return
      const x = cx + (i - (list.length - 1) / 2) * DIRECT_GAP
      const down = a.y < b.y
      const y1 = down ? a.y + a.h : a.y
      const y2 = down ? b.y : b.y + b.h
      out.set(e.id, {
        points: [
          { x, y: y1 },
          { x, y: y2 },
        ],
        label: { x, y: (y1 + y2) / 2 },
      })
    })
  })
  return out
}
