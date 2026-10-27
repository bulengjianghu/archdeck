/**
 * 定尺寸点阵端口（C6、L20②、L20a②、L20b、L23；ADR-0036）：展开表面不重排——节点位置、尺寸与不接元素的边的走线取收起态的布局，
 * 这里在固定的节点上补两样：入边一侧的一排端口点，与接到点的边的走线。纯函数，不调 elk。
 *   点阵：自上而下骑在顶边、自左向右骑在左边，居中排一排；组（L20b 子模块）之间多留一段；排不下先压点距与组间距，仍排不下按优先次序从末尾截掉（计入「+N」，行尾给它留位）。
 *   走线（返工 2026-10-28）：散开的束（交互段为原视图边）在节点前分叉——束本身走到最后一段，每个点在自己的高度分出一支、横到点、垂直进点，
 *   终点停在点的边缘（箭头尖）；分支间距 PARALLEL_GAP，同侧越往外分得越远（离节点越远），分叉后互不相交、不共用线段；
 *   同一节点上不同的束各占一段扇出线（fanLevels 取交叉最少的次序）。束里没画成点的元素级边合成一条接到节点本体（`#rest`），走线即束原来的走线。
 */
import type { LevelView } from '@/model'
import { restEdgeId, spreadEdgeId, type Box, type EdgeRoute, type Point, type PositionedView } from './geometry'
import { layoutExpansion, spreadBundles, type StructureLinks } from './layout'
import { PARALLEL_GAP } from './routes'

/**
 * 点距（压缩下限）、组间多留（压缩下限）、两端留白（自上而下 / 自左向右）、行尾「+N」占位、扇出线离节点的距离与逐条加远量（同平行边间距，
 * 最后一段不够长时压缩到 minStep）、走线终点离点中心的距离（点的半宽，箭头尖落在点的边缘）
 */
export const DOTS = { pitch: 12, minPitch: 9, gap: 8, minGap: 4, pad: 12, sidePad: 8, more: 22, fan: 10, fanStep: PARALLEL_GAP, minStep: 4, r: 5 }

export interface DotRow {
  /** 画成点的元素（按入边一侧的顺序）与绝对坐标 */
  placed: { name: string; x: number; y: number }[]
  /** 入边一侧放不下、截掉的元素（计入「+N」） */
  dropped: string[]
}

/**
 * L20a②：在节点盒子的入边一侧排一排点。elements 为显示次序（L20b 已按组排好），groups 与它对齐（组号，本体为 null），
 * ranked 为优先次序（截掉时从它的末尾开始）；more 为封顶外已有的元素数（> 0 时行尾留「+N」的位）。
 */
export function surfaceDots(
  box: Box,
  direction: 'DOWN' | 'RIGHT',
  elements: readonly string[],
  groups?: readonly (number | null)[],
  ranked?: readonly string[],
  more = 0,
): DotRow {
  const down = direction === 'DOWN'
  const length = down ? box.w - 2 * DOTS.pad : box.h - 2 * DOTS.sidePad
  const groupOf = new Map(elements.map((n, i) => [n, groups?.[i] ?? null]))
  const order = ranked?.length ? [...ranked, ...elements.filter(n => !ranked.includes(n))] : [...elements]
  let keep = [...elements]
  const breaks = (list: readonly string[]) => list.slice(1).filter((n, i) => groupOf.get(n) !== groupOf.get(list[i])).length
  const span = (list: readonly string[], pitch: number, gap: number) => Math.max(0, list.length - 1) * pitch + breaks(list) * gap
  const fit = (list: readonly string[], room: number) => {
    for (const gap of [DOTS.gap, DOTS.minGap])
      for (let pitch = DOTS.pitch; pitch >= DOTS.minPitch; pitch--) if (span(list, pitch, gap) <= room) return { pitch, gap }
    return null
  }
  let step = fit(keep, length - (more > 0 ? DOTS.more : 0))
  while (!step && keep.length > 1) {
    const cut = [...order].reverse().find(n => keep.includes(n))!
    keep = keep.filter(n => n !== cut)
    step = fit(keep, length - DOTS.more)
  }
  step ??= { pitch: DOTS.minPitch, gap: DOTS.minGap }
  const room = length - (more > 0 || keep.length < elements.length ? DOTS.more : 0)
  const start = (down ? box.x + DOTS.pad : box.y + DOTS.sidePad) + Math.max(0, (room - span(keep, step.pitch, step.gap)) / 2)
  let at = start
  const placed = keep.map((name, i) => {
    if (i > 0) at += step.pitch + (groupOf.get(name) !== groupOf.get(keep[i - 1]) ? step.gap : 0)
    return down ? { name, x: at, y: box.y } : { name, x: box.x, y: at }
  })
  return { placed, dropped: elements.filter(n => !keep.includes(n)) }
}

const swap = (p: Point): Point => ({ x: p.y, y: p.x })

/**
 * L20a②（返工）：接到点的一条分支——沿干线 trunk（收起态的束或视图边的走线，即束本身）走到最后一段，在离节点 distance 处分叉，
 * 横到点、垂直进点，终点停在点的边缘（离点中心 DOTS.r，箭头尖落在那里）；点正好在干线上时直下。分叉点不越过最后一段的起点。
 */
export function tapRoute(trunk: readonly Point[], dot: Point, direction: 'DOWN' | 'RIGHT', distance: number): Point[] {
  const pts0 = simplify([...trunk])
  if (pts0.length < 2) return [...pts0, dot]
  // 在「自上而下」的坐标里算：自左向右时交换 x、y
  const t = direction === 'DOWN' ? pts0 : pts0.map(swap)
  const d = direction === 'DOWN' ? dot : swap(dot)
  const end = t[t.length - 1]
  const prev = t[t.length - 2]
  const tip = { x: d.x, y: d.y - DOTS.r }
  const from = Math.abs(prev.x - end.x) < 0.5 ? prev.y : end.y - 2 * DOTS.fan
  let turn = Math.max(end.y - distance, from + 4)
  if (turn > tip.y - 2) turn = (from + tip.y) / 2
  const pts = simplify(Math.abs(end.x - d.x) < 0.5 ? [...t.slice(0, -1), tip] : [...t.slice(0, -1), { x: end.x, y: turn }, { x: d.x, y: turn }, tip])
  return direction === 'DOWN' ? pts : pts.map(swap)
}

/** 去掉重合点与共线的中间点 */
function simplify(pts: Point[]): Point[] {
  const out: Point[] = []
  for (const p of pts) {
    const b = out[out.length - 1]
    if (b && Math.abs(b.x - p.x) < 0.5 && Math.abs(b.y - p.y) < 0.5) continue
    const a = out[out.length - 2]
    if (a && b && ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - p.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - p.y) < 0.5))) out.pop()
    out.push(p)
  }
  return out
}

/**
 * L20a②：一个节点上各干线的扇出线次序（0 离节点最近）。干线 t 在 u 之外（离节点更远）时，t 落向各点的竖线穿过 u 的扇出横线、
 * u 的进点竖线穿过 t 的扇出横线；取这类交叉总数最少的次序——干线不多于 6 条时穷举，多了按落点数从多到少（落点多的靠近节点）。
 */
export function fanLevels(trunks: readonly { end: number; drops: readonly number[] }[]): number[] {
  const span = trunks.map(t => [Math.min(t.end, ...t.drops), Math.max(t.end, ...t.drops)] as const)
  const inside = (x: number, [a, b]: readonly [number, number]) => x > a + 0.5 && x < b - 0.5
  // over[t][u]：t 在 u 之外时的交叉数
  const over = trunks.map((t, i) => trunks.map((u, j) => (i === j ? 0 : t.drops.filter(x => inside(x, span[j])).length + (inside(u.end, span[i]) ? 1 : 0))))
  const cost = (order: readonly number[]) => order.reduce((n, t, k) => n + order.slice(0, k).reduce((m, u) => m + over[t][u], 0), 0)
  let best = trunks.map((_, i) => i).sort((a, b) => trunks[b].drops.length - trunks[a].drops.length || trunks[a].end - trunks[b].end)
  if (trunks.length <= 6) {
    const perms = (rest: number[]): number[][] =>
      rest.length <= 1 ? [rest] : rest.flatMap((x, i) => perms([...rest.slice(0, i), ...rest.slice(i + 1)]).map(p => [x, ...p]))
    for (const p of perms(best)) if (cost(p) < cost(best)) best = p
  }
  // best 从近到远；返回每条干线的层号
  const out = new Array<number>(trunks.length)
  best.forEach((t, k) => (out[t] = k))
  return out
}

/**
 * C6、L20②（ADR-0036）：在收起态的布局 base 上展开表面——节点与其余走线原样，补端口点（elements、elementsMore）、被散开的束（spread）、
 * 接到点的元素级边与交互散开段的走线、束里其余的一条（`#rest`），以及框外边接到点时的端点（`<边 ID>#in`）。没有展开时原样返回。
 */
export function expandSurface(base: PositionedView, view: LevelView, links: StructureLinks | null | undefined): PositionedView {
  const exp = layoutExpansion(view, links)
  if (!exp) return base
  const direction = base.direction ?? 'DOWN'
  const elements = new Map<string, DotRow['placed']>()
  const more = new Map(exp.more ?? [])
  for (const [node, names] of exp.nodes) {
    const box = base.nodes.get(node)
    if (!box) continue
    const row = surfaceDots(box, direction, names, exp.groups?.get(node), exp.ranked?.get(node), exp.more?.get(node) ?? 0)
    elements.set(node, row.placed)
    if (row.dropped.length) more.set(node, (more.get(node) ?? 0) + row.dropped.length)
  }
  // 每条接到点的边所在的干线：元素级边 → 它的束，散开段 → 原视图边
  const trunkOf = new Map<string, string>()
  for (const e of links?.elements ?? []) if (exp.targets.has(e.id)) trunkOf.set(e.id, e.bundle)
  for (const x of links?.interactions ?? []) for (const el of x.elements) trunkOf.set(spreadEdgeId(x.edge, el), x.edge)
  const along = (p: Point) => (direction === 'DOWN' ? p.x : p.y)
  // 分叉：每条干线（束本身）在节点前按点各分一支；点在干线进点同一侧的，越往外的分叉越远（离节点越远），同一束的分支互不相交、不共用线段
  type Member = { id: string; dot: Point; at: number }
  const trunks = new Map<string, { node: string; route: EdgeRoute; members: Member[] }>()
  for (const [id, t] of exp.targets) {
    const trunk = trunkOf.get(id)
    const dot = elements.get(t.node)?.find(p => p.name === t.element)
    const route = trunk ? base.edges.get(trunk) : undefined
    if (!trunk || !dot || !route) continue
    const x = trunks.get(trunk) ?? trunks.set(trunk, { node: t.node, route, members: [] }).get(trunk)!
    x.members.push({ id, dot, at: along(dot) })
  }
  const rank = new Map<string, number>()
  const bands = new Map<string, number>()
  for (const [trunk, x] of trunks) {
    const pts = x.route.points
    const body = along(pts[pts.length - 1])
    const right = x.members.filter(m => m.at > body + 0.5).sort((p, q) => p.at - q.at)
    const left = x.members.filter(m => m.at < body - 0.5).sort((p, q) => q.at - p.at)
    right.forEach((m, k) => rank.set(m.id, k))
    left.forEach((m, k) => rank.set(m.id, k))
    for (const m of x.members) if (!rank.has(m.id)) rank.set(m.id, 0)
    bands.set(trunk, Math.max(right.length, left.length, 1))
  }
  // 同一节点上不同干线各占一段扇出线：次序取交叉最少的一种（fanLevels），逐段叠远
  const base0 = new Map<string, number>()
  const byNode = new Map<string, string[]>()
  for (const [trunk, x] of trunks) byNode.set(x.node, [...(byNode.get(x.node) ?? []), trunk])
  const step = new Map<string, number>()
  for (const [node, ids] of byNode) {
    const list = ids.map(id => {
      const pts = trunks.get(id)!.route.points
      return { id, end: along(pts[pts.length - 1]), drops: trunks.get(id)!.members.map(m => m.at) }
    })
    const levels = fanLevels(list)
    let acc = 0
    for (const i of list.map((_, i) => i).sort((p, q) => levels[p] - levels[q])) {
      base0.set(list[i].id, acc)
      acc += bands.get(list[i].id)!
    }
    // 最后一段不够长时压缩逐条加远量（不小于 minStep）：按各干线最后一段的长度取最短的
    const box = base.nodes.get(node)!
    const room = Math.min(
      ...list.map(t => {
        const pts = trunks.get(t.id)!.route.points
        const prev = pts[pts.length - 2] ?? pts[0]
        return direction === 'DOWN' ? box.y - prev.y : box.x - prev.x
      }),
    )
    const want = DOTS.fan + (acc - 1) * DOTS.fanStep + DOTS.r + 8
    step.set(node, acc > 1 && want > room ? Math.max(DOTS.minStep, (room - DOTS.fan - DOTS.r - 8) / (acc - 1)) : DOTS.fanStep)
  }
  const edges = new Map<string, EdgeRoute>(base.edges)
  const ports = new Map(base.ports ?? [])
  for (const [id, t] of exp.targets) {
    const dot = elements.get(t.node)?.find(p => p.name === t.element)
    if (!dot) continue
    const tip = direction === 'DOWN' ? { x: dot.x, y: dot.y - DOTS.r } : { x: dot.x - DOTS.r, y: dot.y }
    ports.set(`${id}#in`, tip)
    const trunk = trunkOf.get(id)
    const x = trunk ? trunks.get(trunk) : undefined
    if (!x || !trunk) continue
    const distance = DOTS.fan + ((base0.get(trunk) ?? 0) + (rank.get(id) ?? 0)) * (step.get(t.node) ?? DOTS.fanStep)
    edges.set(id, { points: tapRoute(x.route.points, dot, direction, distance) })
  }
  const spread = spreadBundles(links)
  for (const b of spread) {
    const r = base.edges.get(b)
    if (r) edges.set(restEdgeId(b), r)
  }
  return { ...base, edges, ports, elements, spread, ...(more.size ? { elementsMore: more } : {}) }
}
