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
/**
 * 进入终点端口前的直段：箭头（最深约 14）+ 拐角圆角 8 + 余量，拐弯不紧贴箭头。
 * 加上同侧错开的加长量（≤ 22）后，进内部节点的横线落在父模块框（留 28）与系统框（再留 44）之间、离两条框线各约 10，
 * 只在靠近目标处竖直穿过父模块框一次。
 */
export const ARRIVE = 38
/** L32：已占用的竖段（detour 选通道时避开）；add 把一条线的竖段记进去 */
export class BusyLines {
  verticals: { x: number; lo: number; hi: number }[] = []
  add(points: readonly Point[]) {
    points.slice(1).forEach((b, i) => {
      const a = points[i]
      if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 0.5) this.verticals.push({ x: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) })
    })
    return this
  }
}
/** L32：竖直通道里离已占的竖段不到这么近就算挤（一个轨距加余量） */
const BUSY_NEAR = 14
/** L32：一条竖直通道上每多一条线加的代价（px，按走线长度计）：通道里放得下三四条线之后，绕到旁边的通道更划算 */
const LOAD_COST = 60
/** 绕到所有节点外侧时离节点外沿的距离：落在父模块框（留 28）与系统框（再留 44）之间，不压框线 */
const OUTSIDE = 50

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
export function detour(from: PortAt, to: PortAt, obstacles: readonly { x: number; y: number; w: number; h: number }[], busy?: BusyLines): Point[] {
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
  // L32：这条竖直通道上已有几条线（内部边、同组已走好的框外边）离它不到一个轨距、竖向区间重叠，每条加 LOAD_COST 的代价，线多时分散到别的通道
  const lo = Math.min(p1.y, p2.y)
  const hi = Math.max(p1.y, p2.y)
  const crowd = (x: number) => (busy ? busy.verticals.filter(v => Math.abs(v.x - x) < BUSY_NEAR && v.lo < hi - 1 && lo < v.hi - 1).length : 0)
  const cost = (x: number) => Math.abs(x - p1.x) + Math.abs(x - p2.x) + crowd(x) * LOAD_COST
  const best = candidates.sort((a, b) => cost(a) - cost(b)).find(x => free(pathOf(x))) ?? (cost(left) < cost(right) ? left : right)
  const path = simplify(pathOf(best))
  busy?.add(path)
  return path
}

/**
 * L32：短桩不伸进对面的节点——沿端口方向到最近一个障碍（与端口同列 / 同行）的距离不够短桩加错开量时，短桩缩到离它 6 px（至少 6）。
 * elk 把互不相连的节点按 20 px 的组件间距排开，进边的直段（ARRIVE 38）会伸进上方的节点。
 */
export function clampStub(p: PortAt, obstacles: readonly Rect[]): PortAt {
  const want = (p.stub ?? STUB) + (p.lane ?? 0)
  let room = Infinity
  for (const o of obstacles) {
    if (p.axis === 'h') {
      if (p.y <= o.y || p.y >= o.y + o.h) continue
      const d = p.dir > 0 ? o.x - p.x : p.x - (o.x + o.w)
      if (d > 0.5) room = Math.min(room, d)
    } else {
      if (p.x <= o.x || p.x >= o.x + o.w) continue
      const d = p.dir > 0 ? o.y - p.y : p.y - (o.y + o.h)
      if (d > 0.5) room = Math.min(room, d)
    }
  }
  return want <= room - 6 ? p : { ...p, stub: Math.max(6, room - 6), lane: 0 }
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

// ── 通道分配（L11：可见的框外边各占一条轨道）──────────────────────

export interface TrackLine {
  id: string
  points: readonly Point[]
}

interface Seg {
  id: string
  /** 线段序号：points[i] → points[i + 1] */
  i: number
  /** 横段为 y、竖段为 x */
  at: number
  lo: number
  hi: number
  /** 想让出的方向（离开起点 / 让出进终点的直段）；0 为无偏好 */
  away: number
}

type Rect = { x: number; y: number; w: number; h: number }

/** 一条线在某个轴上的线段；movable 只取中间段（首段离开起点、末段进终点不动） */
function segsOn(id: string, pts: readonly Point[], axis: 'h' | 'v', movable: boolean): Seg[] {
  const out: Seg[] = []
  const [from, to] = movable ? [1, pts.length - 2] : [0, pts.length - 1]
  for (let i = from; i < to; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const horizontal = Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5
    const vertical = Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 0.5
    if ((axis === 'h' && !horizontal) || (axis === 'v' && !vertical)) continue
    const first = pts[1].y - pts[0].y + (pts[1].x - pts[0].x)
    const last = pts[pts.length - 1].y - pts[pts.length - 2].y + (pts[pts.length - 1].x - pts[pts.length - 2].x)
    const away = movable && axis === 'h' ? (i === pts.length - 3 ? -Math.sign(last) : i === 1 ? Math.sign(first) : 0) : 0
    out.push(
      axis === 'h'
        ? { id, i, at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), away }
        : { id, i, at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), away },
    )
  }
  return out
}

/**
 * L11、L32：把走廊里重合或挨得太近的线段分到各自的轨道——按边 ID 依次处理每条线的中间段（首段离开起点、末段进终点不动），
 * 在 0、±gap、±2gap……里挑第一个与已占用的平行段（同轴、区间重叠）相距都不小于 gap、挪动后不穿过障碍（节点）的位置；
 * 已占用的包括：已处理的线、fixed 的线（如 elk 排好的内部边，只占不动）与各线的首末段。紧接首段的横段倾向继续远离起点、紧接末段的横段倾向远离终点，
 * 先试这个方向。都不行时取冲突最少的（先比穿障碍）。结果确定：同样的输入（线与顺序）得到同样的轨道。
 */
export function allocateTracks(
  lines: readonly TrackLine[],
  gap: number,
  opts: { fixed?: readonly TrackLine[]; obstacles?: readonly Rect[] } = {},
): Map<string, Point[]> {
  const out = new Map(lines.map(l => [l.id, l.points.map(p => ({ ...p }))]))
  const obstacles = opts.obstacles ?? []
  const order = [...out.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  // 挪动一段会拉长它两侧的段：这三段都不能穿过障碍——中间段不贴近节点（外扩 2），首末段本就接在节点边上，只查是否穿进节点内部（内收 2）
  const inner = (o: Rect): Rect => ({ x: o.x + 2, y: o.y + 2, w: o.w - 4, h: o.h - 4 })
  const blocked = (pts: readonly Point[], i: number) =>
    [i - 1, i, i + 1]
      .filter(k => k >= 0 && k <= pts.length - 2)
      .some(k => obstacles.some(o => (k === 0 || k === pts.length - 2 ? crossesBox(pts[k], pts[k + 1], inner(inner(o))) : crossesBox(pts[k], pts[k + 1], o))))
  for (const axis of ['h', 'v'] as const) {
    const taken: Seg[] = [
      ...(opts.fixed ?? []).flatMap(l => segsOn(l.id, l.points, axis, false)),
      ...[...out].flatMap(([id, pts]) => segsOn(id, pts, axis, false).filter(s => s.i === 0 || s.i === pts.length - 2)),
    ]
    for (const id of order) {
      const pts = out.get(id)!
      for (const s of segsOn(id, pts, axis, true)) {
        const near = (at: number) => taken.filter(t => t.id !== id && t.lo < s.hi - 1 && s.lo < t.hi - 1 && Math.abs(t.at - at) < gap - 0.5).length
        const moved = (d: number) => {
          const copy = pts.map(p => ({ ...p }))
          for (const p of [copy[s.i], copy[s.i + 1]]) {
            if (axis === 'h') p.y += d
            else p.x += d
          }
          return copy
        }
        const dir = s.away || 1
        const steps = [0, ...Array.from({ length: 12 }, (_, k) => [dir * (k + 1), -dir * (k + 1)]).flat()]
        const score = (d: number) => (blocked(moved(d * gap), s.i) ? 1000 : 0) + near(s.at + d * gap)
        const best = steps.find(d => score(d) === 0) ?? [...steps].sort((p, q) => score(p) - score(q) || Math.abs(p) - Math.abs(q))[0]
        const d = best * gap
        if (d) {
          for (const p of [pts[s.i], pts[s.i + 1]]) {
            if (axis === 'h') p.y += d
            else p.x += d
          }
        }
        taken.push({ ...s, at: s.at + d })
      }
    }
  }
  return out
}

/** L32：框线（系统框、父模块框）作为只占不动的线交给 allocateTracks，分轨后的线段不贴着框线走 */
export function frameLines(frames: readonly (Rect | undefined)[]): TrackLine[] {
  return frames.flatMap((f, k) =>
    f
      ? [
          {
            id: `frame:${k}`,
            points: [
              { x: f.x, y: f.y },
              { x: f.x + f.w, y: f.y },
              { x: f.x + f.w, y: f.y + f.h },
              { x: f.x, y: f.y + f.h },
              { x: f.x, y: f.y },
            ],
          },
        ]
      : [],
  )
}

/** 折线上按长度比例 t（0–1）取点 */
export function pointAlong(points: readonly Point[], t: number): Point {
  const lens = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y))
  let rest = lens.reduce((n, l) => n + l, 0) * t
  for (let i = 0; i < lens.length; i++) {
    if (rest <= lens[i] && lens[i] > 0) {
      const k = rest / lens[i]
      return { x: points[i].x + (points[i + 1].x - points[i].x) * k, y: points[i].y + (points[i + 1].y - points[i].y) * k }
    }
    rest -= lens[i]
  }
  return points[points.length - 1] ?? { x: 0, y: 0 }
}

/** L33：一条要放标签的线与标签尺寸 */
export interface LabelLine extends TrackLine {
  size: { w: number; h: number }
  /** 先试的位置（如 elk 给的标签槽） */
  prefer?: Point
}

const hits = (p: { x: number; y: number; w: number; h: number }, q: { x: number; y: number; w: number; h: number }) =>
  p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h

/**
 * L33：标签在线上的候选位置——先最长一段的 0.5、0.3、0.7、0.15、0.85，再其余各段，再整条线的 0.5、0.35、0.65、0.2、0.8；
 * 最后沿整条线每 5% 一处（ADR-0041：机制标签让标签变宽，前面的都碰时再细找，前面能放下的位置不变）
 */
function labelCandidates(points: readonly Point[]): Point[] {
  const segs = points
    .slice(1)
    .map((b, i) => ({ a: points[i], b, len: Math.hypot(b.x - points[i].x, b.y - points[i].y) }))
    .filter(s => s.len > 0)
    .sort((p, q) => q.len - p.len)
  const at = (s: (typeof segs)[number], t: number) => ({ x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t })
  const longest = segs[0] ? [0.5, 0.3, 0.7, 0.15, 0.85].map(t => at(segs[0], t)) : []
  const rest = segs.slice(1).flatMap(s => [0.5, 0.25, 0.75].map(t => at(s, t)))
  const fine = Array.from({ length: 19 }, (_, i) => pointAlong(points, (i + 1) / 20))
  return [...longest, ...rest, ...[0.5, 0.35, 0.65, 0.2, 0.8].map(t => pointAlong(points, t)), ...fine]
}

/** 曲线（核心跨层边、参与者的边）按画布的 S 形曲线采样成折线：竖向（true）的控制点在起终点正下 / 正上，横向（'h'）的在正侧 */
export function curvePoints(points: readonly Point[], curve: true | 'h', n = 16): Point[] {
  const a = points[0]
  const b = points[points.length - 1]
  const c1 = curve === 'h' ? { x: (a.x + b.x) / 2, y: a.y } : { x: a.x, y: (a.y + b.y) / 2 }
  const c2 = curve === 'h' ? { x: (a.x + b.x) / 2, y: b.y } : { x: b.x, y: (a.y + b.y) / 2 }
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    const u = 1 - t
    return {
      x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
    }
  })
}

/**
 * L33：标签按实际尺寸放在各自的线上——按 ID 顺序，挑第一个既不压障碍（节点、文字区）、也不与已放的、会同时画出的（together）标签相碰的候选位置；
 * 都碰时取碰得最少的（先比与标签相碰的个数）。结果确定。
 */
export function placeLabelBoxes(
  lines: readonly LabelLine[],
  opts: { obstacles?: readonly { x: number; y: number; w: number; h: number }[]; together?: (a: string, b: string) => boolean } = {},
): Map<string, Point> {
  const obstacles = opts.obstacles ?? []
  const together = opts.together ?? (() => true)
  const items = [...lines]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(l => ({ l, cands: [...(l.prefer ? [l.prefer] : []), ...labelCandidates(l.points)] }))
    .filter(x => x.cands.length)
  const boxAt = (l: LabelLine, p: Point) => ({ x: p.x - l.size.w / 2, y: p.y - l.size.h / 2, w: l.size.w, h: l.size.h })
  type Placed = { id: string; box: { x: number; y: number; w: number; h: number } }
  const score = (placed: readonly Placed[], l: LabelLine, p: Point) => {
    const b = boxAt(l, p)
    return placed.filter(q => together(q.id, l.id) && hits(q.box, b)).length * 100 + obstacles.filter(o => hits(o, b)).length
  }
  /** 按给定的挑选次序放一遍，返回位置与总代价（与已放标签相碰 ×100 + 压障碍） */
  const run = (constrained: boolean) => {
    const rest = [...items]
    const placed: Placed[] = []
    const out = new Map<string, Point>()
    let cost = 0
    while (rest.length) {
      let pick = 0
      if (constrained) {
        let fewest = Infinity
        rest.forEach((x, i) => {
          const free = x.cands.filter(p => score(placed, x.l, p) === 0).length
          if (free < fewest) [pick, fewest] = [i, free]
        })
      }
      const { l, cands } = rest.splice(pick, 1)[0]
      const best = cands.find(p => score(placed, l, p) === 0) ?? [...cands].sort((p, q) => score(placed, l, p) - score(placed, l, q))[0]
      cost += score(placed, l, best)
      placed.push({ id: l.id, box: boxAt(l, best) })
      out.set(l.id, best)
    }
    return { out, cost }
  }
  // 先按 ID 先到先得；有相碰时再试「空位最少的先放」，代价更小才换（ADR-0041：标签变宽后窄处的空位容易被先到的占掉）
  const byId = run(false)
  if (!byId.cost) return byId.out
  const tight = run(true)
  return tight.cost < byId.cost ? tight.out : byId.out
}
