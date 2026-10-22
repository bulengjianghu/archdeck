import type { Point } from '@/layout/layout'
import { JUMP_RADIUS } from '@/layout/canvas'

/** 折线，拐角处用半径 r 的圆角；水平段上的跳点（L11，jumpsOf）处插入向上的半圆小桥 */
export function roundedPolyline(points: Point[], r = 8, jumps: readonly Point[] = []): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M${points[0].x},${points[0].y}`
  let d = `M${points[0].x},${points[0].y}`
  /** 从 from 画直线到 to，途经本段上的跳点 */
  const line = (from: Point, to: Point) => {
    if (Math.abs(from.y - to.y) < 0.5 && jumps.length) {
      const right = to.x > from.x
      const on = jumps.filter(j => Math.abs(j.y - from.y) < 0.5 && (right ? j.x > from.x && j.x < to.x : j.x < from.x && j.x > to.x))
      for (const j of on.sort((p, q) => (right ? p.x - q.x : q.x - p.x))) {
        const s = right ? -JUMP_RADIUS : JUMP_RADIUS
        d += ` L${j.x + s},${j.y} a${JUMP_RADIUS},${JUMP_RADIUS} 0 0 ${right ? 1 : 0} ${-2 * s},0`
      }
    }
    d += ` L${to.x},${to.y}`
  }
  let at = points[0]
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1]
    const p1 = points[i]
    const p2 = points[i + 1]
    const r1 = Math.min(r, dist(p0, p1) / 2, dist(p1, p2) / 2)
    const a = toward(p1, p0, r1)
    const b = toward(p1, p2, r1)
    line(at, a)
    d += ` Q${p1.x},${p1.y} ${b.x},${b.y}`
    at = b
  }
  line(at, points[points.length - 1])
  return d
}

/** 两点之间的竖向 S 形曲线（核心模块跨层边） */
export function verticalCurve(a: Point, b: Point): string {
  const dy = (b.y - a.y) / 2
  return `M${a.x},${a.y} C${a.x},${a.y + dy} ${b.x},${b.y - dy} ${b.x},${b.y}`
}

/** 两点之间的横向 S 形曲线（从侧边出发的参与者边） */
export function horizontalCurve(a: Point, b: Point): string {
  const dx = (b.x - a.x) / 2
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`
}

/** J5：两点之间的波浪线（时间耦合）：沿直线每 wavelength 一个周期、振幅 amplitude 的正弦折线，首尾落在端点上 */
export function wavyPath(a: Point, b: Point, amplitude = 3, wavelength = 12): string {
  const len = dist(a, b)
  if (len < 1) return `M${a.x},${a.y}`
  const ux = (b.x - a.x) / len
  const uy = (b.y - a.y) / len
  const nx = -uy
  const ny = ux
  const n = Math.max(2, Math.round(len / wavelength) * 2)
  let d = `M${a.x},${a.y}`
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const off = i === n ? 0 : i % 2 ? amplitude : -amplitude
    const x = a.x + ux * len * t + nx * off
    const y = a.y + uy * len * t + ny * off
    d += ` L${x.toFixed(1)},${y.toFixed(1)}`
  }
  return d
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function toward(from: Point, to: Point, len: number): Point {
  const d = dist(from, to) || 1
  return { x: from.x + ((to.x - from.x) / d) * len, y: from.y + ((to.y - from.y) / d) * len }
}

/**
 * 箭头处回缩（L10）：线终点沿来向退回 depth，箭头从这里画到原终点，空心「V」独立成形、不骑在线上。
 * 折线沿最后一段退（不超过该段长度）；竖向 / 横向 S 形曲线在终点处的切线是竖直 / 水平的，沿该方向退。
 */
export function retractEnd(points: readonly Point[], curve: boolean | 'h' | undefined, depth: number): Point[] {
  if (points.length < 2 || depth <= 0) return [...points]
  const a = points[points.length - 2]
  const b = points[points.length - 1]
  let end: Point
  if (curve && points.length === 2) {
    const along = curve === 'h' ? b.x - a.x : b.y - a.y
    const d = Math.min(depth, Math.abs(along) / 2) * Math.sign(along)
    end = curve === 'h' ? { x: b.x - d, y: b.y } : { x: b.x, y: b.y - d }
  } else end = toward(b, a, Math.min(depth, dist(a, b) - 1))
  return [...points.slice(0, -1), end]
}
