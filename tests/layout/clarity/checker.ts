/**
 * W（ADR-0039）：线的清晰度几何检查器——测试工具，跑在布局结果上，数画出来以后读不清的几类几何问题（L30）。
 * 输入是一组「同时画出来」的线（走线点、是否曲线、标签位置与文字）与障碍（节点、文字区、框线）；输出每类的计数与位置。
 *   overlap   线段与线段重合：两条不同的线有一段平行、中心相距不到 OVERLAP_NEAR 且重叠超过 OVERLAP_MIN（共线或近到分不出两条）
 *   arrows    箭头终点重合：两条线的终点相距不到 ARROW_MIN
 *   crossNode 线压过节点或文字区：线段穿过节点内部（两端所在节点的端口除外）或带的标题、「可依赖」栏、计数标签
 *   labels    标签与标签重叠，或标签压在节点上
 *   hug       线贴着框线走：与框线（系统框、父模块框、带）平行、相距不到 HUG_MAX 且并行超过 HUG_MIN
 *   onFrame   终点落在框线上（不在任何节点的边上）
 * 曲线按画布的 S 形曲线采样成折线参与「压节点」与「贴框」，不参与「重合」。
 */
import type { Box, Point } from '../../../src/layout/layout'

export interface CheckLine {
  id: string
  points: readonly Point[]
  curve?: boolean | 'h'
  /** w：整个标签位的宽（两段时含段间距，ADR-0041）；不给时按 text 一段估 */
  label?: { at: Point; text: string; w?: number }
  /** 两端节点 ID：线可以从它们的边上出入 */
  ends: readonly [string, string]
}

export interface Obstacle {
  id: string
  box: Box
  /** node：节点（线不可穿过，标签不可压）；text：文字区（线不可穿过） */
  kind: 'node' | 'text'
}

export interface Scene {
  lines: readonly CheckLine[]
  obstacles: readonly Obstacle[]
  /** 框线：线不该贴着走、终点不该落在上面 */
  frames: readonly Box[]
  /** 终点可以落在它们的边上的容器（分层总览的带） */
  anchors?: readonly Box[]
}

export const KINDS = ['overlap', 'arrows', 'crossNode', 'labels', 'hug', 'onFrame'] as const
export type Kind = (typeof KINDS)[number]

export interface Finding {
  kind: Kind
  /** 涉及的线 / 障碍 ID，排好序，用于跨场景去重 */
  ids: string[]
  at: Point
}

export const OVERLAP_MIN = 6
/** 视觉重合：两条平行线中心相距不到这么多（线宽 1.5–3 px，再近就分不出两条） */
export const OVERLAP_NEAR = 6
export const ARROW_MIN = 4
export const HUG_MAX = 6
export const HUG_MIN = 24

const EPS = 1.5

interface Seg {
  a: Point
  b: Point
}

function sampleCurve(points: readonly Point[], curve: true | 'h'): Point[] {
  const [a, b] = [points[0], points[points.length - 1]]
  const c1 = curve === 'h' ? { x: (a.x + b.x) / 2, y: a.y } : { x: a.x, y: (a.y + b.y) / 2 }
  const c2 = curve === 'h' ? { x: (a.x + b.x) / 2, y: b.y } : { x: b.x, y: (a.y + b.y) / 2 }
  const out: Point[] = []
  for (let i = 0; i <= 16; i++) {
    const t = i / 16
    const u = 1 - t
    out.push({
      x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
    })
  }
  return out
}

const polyOf = (l: CheckLine): Point[] => (l.curve && l.points.length === 2 ? sampleCurve(l.points, l.curve) : [...l.points])
const segsOf = (pts: readonly Point[]): Seg[] => pts.slice(1).map((b, i) => ({ a: pts[i], b }))
const isH = (s: Seg) => Math.abs(s.a.y - s.b.y) < 0.5 && Math.abs(s.a.x - s.b.x) >= 0.5
const isV = (s: Seg) => Math.abs(s.a.x - s.b.x) < 0.5 && Math.abs(s.a.y - s.b.y) >= 0.5

/** 线段是否穿过盒子内部（盒子向内收 inset） */
function segHitsBox(s: Seg, box: Box, inset: number): boolean {
  const x1 = box.x + inset
  const y1 = box.y + inset
  const x2 = box.x + box.w - inset
  const y2 = box.y + box.h - inset
  if (x2 <= x1 || y2 <= y1) return false
  // Liang–Barsky 裁剪
  let t0 = 0
  let t1 = 1
  const dx = s.b.x - s.a.x
  const dy = s.b.y - s.a.y
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-9) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }
  return clip(-dx, s.a.x - x1) && clip(dx, x2 - s.a.x) && clip(-dy, s.a.y - y1) && clip(dy, y2 - s.a.y) && t1 - t0 > 1e-6
}

const boxesHit = (p: Box, q: Box) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h

/** 标签盒子：pill（字号 11，左右各 6 内边距、高 18）；中文按 11 px、其余按 6.5 px 估宽 */
export function labelBox(at: Point, text: string, width?: number): Box {
  const w = width ?? [...text].reduce((n, c) => n + (/[\u3000-\u9fff\uff00-\uffef]/.test(c) ? 11 : 6.5), 0) + 12
  const h = 18
  return { x: at.x - w / 2, y: at.y - h / 2, w, h }
}

const onBoxEdge = (p: Point, b: Box) =>
  (p.x >= b.x - EPS && p.x <= b.x + b.w + EPS && (Math.abs(p.y - b.y) < EPS || Math.abs(p.y - b.y - b.h) < EPS)) ||
  (p.y >= b.y - EPS && p.y <= b.y + b.h + EPS && (Math.abs(p.x - b.x) < EPS || Math.abs(p.x - b.x - b.w) < EPS))

export function check(scene: Scene): Finding[] {
  const out: Finding[] = []
  const lines = scene.lines.filter(l => l.points.length >= 2)
  const polys = new Map(lines.map(l => [l.id, polyOf(l)]))
  const sorted = (...ids: string[]) => [...ids].sort()

  // overlap：只看折线（曲线不共线）
  const straight = lines.filter(l => !(l.curve && l.points.length === 2))
  for (let i = 0; i < straight.length; i++)
    for (let j = i + 1; j < straight.length; j++) {
      const [p, q] = [straight[i], straight[j]]
      let hit: Point | null = null
      for (const s of segsOf(p.points))
        for (const t of segsOf(q.points)) {
          if (hit) break
          if (isH(s) && isH(t) && Math.abs(s.a.y - t.a.y) < OVERLAP_NEAR) {
            const lo = Math.max(Math.min(s.a.x, s.b.x), Math.min(t.a.x, t.b.x))
            const hi = Math.min(Math.max(s.a.x, s.b.x), Math.max(t.a.x, t.b.x))
            if (hi - lo > OVERLAP_MIN) hit = { x: (lo + hi) / 2, y: s.a.y }
          } else if (isV(s) && isV(t) && Math.abs(s.a.x - t.a.x) < OVERLAP_NEAR) {
            const lo = Math.max(Math.min(s.a.y, s.b.y), Math.min(t.a.y, t.b.y))
            const hi = Math.min(Math.max(s.a.y, s.b.y), Math.max(t.a.y, t.b.y))
            if (hi - lo > OVERLAP_MIN) hit = { x: s.a.x, y: (lo + hi) / 2 }
          }
        }
      if (hit) out.push({ kind: 'overlap', ids: sorted(p.id, q.id), at: hit })
    }

  // arrows
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i].points[lines[i].points.length - 1]
      const b = lines[j].points[lines[j].points.length - 1]
      if (Math.hypot(a.x - b.x, a.y - b.y) < ARROW_MIN) out.push({ kind: 'arrows', ids: sorted(lines[i].id, lines[j].id), at: a })
    }

  // crossNode：节点内收 2（端口落在边上不算），文字区不收
  for (const l of lines) {
    const segs = segsOf(polys.get(l.id)!)
    for (const o of scene.obstacles) {
      const own = l.ends.includes(o.id)
      const inset = o.kind === 'node' ? (own ? 3 : 2) : 0
      const s = segs.find(x => segHitsBox(x, o.box, inset))
      if (s) out.push({ kind: 'crossNode', ids: [l.id, o.id], at: { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 } })
    }
  }

  // labels：标签互压、标签压节点
  const labeled = lines.filter(l => l.label && l.label.text)
  const lboxes = labeled.map(l => ({ id: l.id, box: labelBox(l.label!.at, l.label!.text, l.label!.w) }))
  for (let i = 0; i < lboxes.length; i++) {
    for (let j = i + 1; j < lboxes.length; j++)
      if (boxesHit(lboxes[i].box, lboxes[j].box)) out.push({ kind: 'labels', ids: sorted(lboxes[i].id, lboxes[j].id), at: labeled[i].label!.at })
    for (const o of scene.obstacles) if (boxesHit(lboxes[i].box, o.box)) out.push({ kind: 'labels', ids: [lboxes[i].id, o.id], at: labeled[i].label!.at })
  }

  // hug：与框线平行、相距不到 HUG_MAX、并行超过 HUG_MIN
  for (const l of lines) {
    const segs = segsOf(polys.get(l.id)!)
    let hit: Point | null = null
    for (const f of scene.frames) {
      for (const s of segs) {
        if (hit) break
        if (isH(s)) {
          for (const y of [f.y, f.y + f.h]) {
            const lo = Math.max(Math.min(s.a.x, s.b.x), f.x)
            const hi = Math.min(Math.max(s.a.x, s.b.x), f.x + f.w)
            if (Math.abs(s.a.y - y) < HUG_MAX && hi - lo > HUG_MIN) hit = { x: (lo + hi) / 2, y }
          }
        } else if (isV(s)) {
          for (const x of [f.x, f.x + f.w]) {
            const lo = Math.max(Math.min(s.a.y, s.b.y), f.y)
            const hi = Math.min(Math.max(s.a.y, s.b.y), f.y + f.h)
            if (Math.abs(s.a.x - x) < HUG_MAX && hi - lo > HUG_MIN) hit = { x, y: (lo + hi) / 2 }
          }
        }
      }
    }
    if (hit) out.push({ kind: 'hug', ids: [l.id], at: hit })
  }

  // onFrame：终点在框线上、不在任何节点的边上
  const nodeBoxes = [...scene.obstacles.filter(o => o.kind === 'node').map(o => o.box), ...(scene.anchors ?? [])]
  for (const l of lines) {
    const p = l.points[l.points.length - 1]
    if (nodeBoxes.some(b => onBoxEdge(p, b))) continue
    if (scene.frames.some(f => onBoxEdge(p, f))) out.push({ kind: 'onFrame', ids: [l.id], at: p })
  }
  return out
}

export type Counts = Record<Kind, number>
export const zeroCounts = (): Counts => Object.fromEntries(KINDS.map(k => [k, 0])) as Counts

/** 多个场景的发现去重（同一类、同一组 ID 只计一次）后计数 */
export function countFindings(findings: readonly Finding[]): Counts {
  const seen = new Set<string>()
  const c = zeroCounts()
  for (const f of findings) {
    const k = `${f.kind}|${f.ids.join('|')}`
    if (seen.has(k)) continue
    seen.add(k)
    c[f.kind]++
  }
  return c
}
