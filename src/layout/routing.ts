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
