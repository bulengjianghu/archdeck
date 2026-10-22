/**
 * 跳线（L11）：正交走线无法避免的交叉，在交叉处画一个半圆小桥。纯函数，画布场景对本层可见的折线边调用。
 * 约定：水平段跳过竖直段；同一对节点之间的边（平行边、往返边）互不算交叉；曲线（核心跨层边、回放临时线、叠加线）不参与；
 * 离线段端点太近的交叉不跳（拐角圆角与箭头处画不下小桥）。
 */
import type { Point } from './layout'

/** 小桥半径（px） */
export const JUMP_RADIUS = 4
/** 交叉点离线段端点至少这么远才跳：拐角圆角 8 + 小桥半径 + 余量 */
export const JUMP_MARGIN = 16

export interface JumpLine {
  id: string
  points: readonly Point[]
  /** 两端节点（不论方向），同一对的边互不算交叉 */
  pair: string
}

const EPS = 0.5

/** 每条边的跳点：落在它自己水平段上的交叉点，按所在线段与沿线方向排好；没有跳点的边不在结果里 */
export function jumpsOf(lines: readonly JumpLine[]): Map<string, Point[]> {
  const verticals = lines.flatMap(l =>
    l.points.slice(1).flatMap((b, i) => {
      const a = l.points[i]
      return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) > EPS ? [{ pair: l.pair, x: a.x, y1: Math.min(a.y, b.y), y2: Math.max(a.y, b.y) }] : []
    }),
  )
  const out = new Map<string, Point[]>()
  for (const l of lines) {
    const jumps: Point[] = []
    l.points.slice(1).forEach((b, i) => {
      const a = l.points[i]
      if (Math.abs(a.y - b.y) >= EPS || Math.abs(a.x - b.x) < EPS) return
      const [x1, x2] = a.x < b.x ? [a.x, b.x] : [b.x, a.x]
      const hits = verticals
        .filter(v => v.pair !== l.pair && v.x > x1 + JUMP_MARGIN && v.x < x2 - JUMP_MARGIN && a.y > v.y1 + EPS && a.y < v.y2 - EPS)
        .map(v => v.x)
      // 沿线方向排序；相距小于一个小桥的只跳一次
      const sorted = [...new Set(hits)].sort((p, q) => (a.x < b.x ? p - q : q - p))
      for (const x of sorted)
        if (!jumps.length || jumps[jumps.length - 1].y !== a.y || Math.abs(jumps[jumps.length - 1].x - x) >= JUMP_RADIUS * 2 + 2) jumps.push({ x, y: a.y })
    })
    if (jumps.length) out.set(l.id, jumps)
  }
  return out
}

// ── 按需的正交绕行（L4：边界边显示时才走线）──────────────────────

/**
 * 端口：盒子某条边上的出入点。axis 为离开盒子的方向所在的轴（'v' 上下、'h' 左右，缺省 'v'），
 * dir 为沿该轴的方向（+1 向下 / 向右，−1 向上 / 向左）。
 */
export interface PortAt {
  x: number
  y: number
  dir: 1 | -1
  axis?: 'v' | 'h'
  /** 短桩加长量：同一节点同一侧的多条边各走一条线，不重叠 */
  lane?: number
  /** 短桩长度（缺省 STUB）：分层总览里进核心模块的边要先到带间空隙的中线 */
  stub?: number
}

/** 离开端口先走的短桩，落在层间空隙里 */
export const STUB = 14
/** 绕到所有节点外侧时离节点外沿的距离：落在父模块框（留 28）与系统框（再留 28）之间，不压框线 */
const OUTSIDE = 42

const crossesBox = (a: Point, b: Point, box: { x: number; y: number; w: number; h: number }) => {
  const x1 = Math.min(a.x, b.x)
  const x2 = Math.max(a.x, b.x)
  const y1 = Math.min(a.y, b.y)
  const y2 = Math.max(a.y, b.y)
  return x2 > box.x - 2 && x1 < box.x + box.w + 2 && y2 > box.y - 2 && y1 < box.y + box.h + 2
}

/**
 * 在固定的节点之间画一条正交折线：起点端口 → 短桩（沿端口方向）→ 横到一条竖直通道 x → 竖直到终点短桩的高度 → 横到终点短桩 → 进终点端口。
 * 端口可在上下边（参与者在上方、边界节点在下方）或左右边（右侧的外部系统从左边进出）。
 * 通道 x 取起终点自身、障碍之间空隙的中线与外框两侧，选中间三段都不穿障碍（含两端节点自身）、总长最短的；都不行时走外框外侧。
 */
export function detour(from: PortAt, to: PortAt, obstacles: readonly { x: number; y: number; w: number; h: number }[]): Point[] {
  const p1 = stubEnd(from)
  const p2 = stubEnd(to)
  const xs = obstacles.flatMap(o => [o.x, o.x + o.w])
  const left = Math.min(from.x, to.x, ...xs) - OUTSIDE
  const right = Math.max(from.x, to.x, ...xs) + OUTSIDE
  const sorted = [...obstacles].sort((a, b) => a.x - b.x)
  const gaps = sorted.slice(1).map((o, i) => (sorted[i].x + sorted[i].w + o.x) / 2)
  const candidates = [p1.x, p2.x, ...gaps, left, right]
  const pathOf = (x: number): Point[] => [{ x: from.x, y: from.y }, p1, { x, y: p1.y }, { x, y: p2.y }, p2, { x: to.x, y: to.y }]
  const free = (pts: Point[]) => pts.slice(2, 5).every((b, i) => obstacles.every(o => !crossesBox(pts[i + 1], b, o)))
  const cost = (x: number) => Math.abs(x - p1.x) + Math.abs(x - p2.x)
  const best = candidates.sort((a, b) => cost(a) - cost(b)).find(x => free(pathOf(x))) ?? (cost(left) < cost(right) ? left : right)
  return simplify(pathOf(best))
}

/** 端口沿其方向走出短桩后的点 */
function stubEnd(p: PortAt): Point {
  const d = p.dir * ((p.stub ?? STUB) + (p.lane ?? 0))
  return p.axis === 'h' ? { x: p.x + d, y: p.y } : { x: p.x, y: p.y + d }
}

/** 去掉重合点与共线的中间点 */
function simplify(pts: Point[]): Point[] {
  const out: Point[] = []
  for (const p of pts) {
    if (out.length && Math.abs(out[out.length - 1].x - p.x) < 0.5 && Math.abs(out[out.length - 1].y - p.y) < 0.5) continue
    const a = out[out.length - 2]
    const b = out[out.length - 1]
    if (a && b && ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - p.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - p.y) < 0.5))) out.pop()
    out.push(p)
  }
  return out
}
