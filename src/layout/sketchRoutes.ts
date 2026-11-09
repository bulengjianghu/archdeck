/**
 * 草图画布的走线（X15 修订，ADR-0063 决策 10、ADR-0025 P5 收紧；T2.5）：与模型画布同一套正交走线（routing.ts 的 detour：短桩 → 竖直 / 水平通道 → 短桩，
 * 避开节点、同一条通道上线多了改走旁边的通道 BusyLines），节点位置取草图的（人摆的、粘住的），走线不动框。
 * 端口按两端的相对位置取边：上下错开得开（竖向不重叠）走上下边，否则走左右边；同一节点同一侧的多条线沿边错开、短桩逐条加长（同对的平行线各走一条，L31 同口径）。
 * 引用线（X22）仍是到引用列的水平切线曲线，不在这里走。纯函数。
 */
import { BusyLines, detour, type PortAt } from './routing'
import type { Point } from './geometry'
import type { SketchScene } from './sketch'

type Side = 'top' | 'bottom' | 'left' | 'right'
interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** 竖向错得开：两框之间上下至少留这么多才走上下边 */
const VGAP = 16
/** 同一侧相邻两个端口的间距 */
const SLOT = 14
/** 同一侧第 i 条线的短桩加长量（上限） */
const LANE = 4
const MAX_LANE = 16

const centerOf = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

function sidesOf(a: Box, b: Box): [Side, Side] {
  if (b.y >= a.y + a.h + VGAP) return ['bottom', 'top']
  if (a.y >= b.y + b.h + VGAP) return ['top', 'bottom']
  return centerOf(b).x >= centerOf(a).x ? ['right', 'left'] : ['left', 'right']
}

function portAt(box: Box, side: Side, i: number, n: number): PortAt {
  const len = side === 'top' || side === 'bottom' ? box.w : box.h
  const step = Math.min(SLOT, (len - 16) / Math.max(1, n - 1))
  const along = (i - (n - 1) / 2) * step
  const lane = Math.min(i * LANE, MAX_LANE)
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  if (side === 'top') return { x: cx + along, y: box.y, dir: -1, lane }
  if (side === 'bottom') return { x: cx + along, y: box.y + box.h, dir: 1, lane }
  if (side === 'left') return { x: box.x, y: cy + along, dir: -1, axis: 'h', lane }
  return { x: box.x + box.w, y: cy + along, dir: 1, axis: 'h', lane }
}

/** 本层之间的每条线（引用线除外）的正交折线（画布坐标），按边 ID */
export function sketchRoutes(scene: Pick<SketchScene, 'nodes' | 'edges'>): Map<string, Point[]> {
  const boxes = new Map<string, Box>()
  for (const n of scene.nodes) if (n.data.kind === 'module') boxes.set(n.id, { x: n.position.x, y: n.position.y, w: n.data.w, h: n.data.h })
  const edges = scene.edges.filter(e => !e.data.external && boxes.has(e.source) && boxes.has(e.target) && e.source !== e.target)
  // 每个节点每一侧的线，按对端的位置排（减少交叉）
  const ends = new Map<string, { edge: string; key: number }[]>()
  const sides = new Map<string, [Side, Side]>()
  for (const e of edges) {
    const a = boxes.get(e.source)!
    const b = boxes.get(e.target)!
    const s = sidesOf(a, b)
    sides.set(e.id, s)
    const along = (side: Side, other: Box) => (side === 'top' || side === 'bottom' ? centerOf(other).x : centerOf(other).y)
    const push = (node: string, side: Side, other: Box) => {
      const k = `${node}\0${side}`
      ;(ends.get(k) ?? ends.set(k, []).get(k)!).push({ edge: `${e.id}\0${node === e.source ? 's' : 't'}`, key: along(side, other) })
    }
    push(e.source, s[0], b)
    push(e.target, s[1], a)
  }
  const slot = new Map<string, { i: number; n: number }>()
  for (const list of ends.values()) {
    list.sort((p, q) => p.key - q.key || (p.edge < q.edge ? -1 : 1))
    list.forEach((x, i) => slot.set(x.edge, { i, n: list.length }))
  }
  const obstacles = [...boxes.values()]
  const busy = new BusyLines()
  const out = new Map<string, Point[]>()
  for (const e of [...edges].sort((p, q) => (p.id < q.id ? -1 : 1))) {
    const [sa, sb] = sides.get(e.id)!
    const a = slot.get(`${e.id}\0s`)!
    const b = slot.get(`${e.id}\0t`)!
    out.set(e.id, detour(portAt(boxes.get(e.source)!, sa, a.i, a.n), portAt(boxes.get(e.target)!, sb, b.i, b.n), obstacles, busy))
  }
  return out
}
