/**
 * 按依赖分层的布局（L28、L29，ADR-0038）：模型层给出层号（levelTiers），这里换成 elk 的层（INTERACTIVE 分层按坐标定层，见 toElkGraph），
 * 并在布局结果上算层带、环组框与孤立列的外框。层号不由交互边决定：交互边与只引类型的束只参与走线。
 */
import type { Box } from './geometry'

/** 布局消费的分层（由模型层的 LevelTiers 化成可缓存的纯数据） */
export interface LayoutTiers {
  /** 节点 → 层号（0 为顶层） */
  tier: Readonly<Record<string, number>>
  count: number
  /** 环组：Y4 编号与成员 */
  groups: readonly { id: number; nodes: readonly string[] }[]
  /** 孤立的节点（不占层，单列在侧边；全部孤立时排成网格） */
  isolated: readonly string[]
  /** L29：画层带与层号 */
  banded: boolean
}

/** 布局结果上的分层几何（画布画层带、环组框） */
export interface TierGeometry {
  /** L29：层带（只在 banded 时给），自上而下 */
  bands: { tier: number; box: Box }[]
  /** L29：环组框（成员之间没有夹着别的节点时才给，否则只靠环编号） */
  groups: { id: number; box: Box }[]
}

/**
 * L28：elk 的层——层号自上而下逐层展开：同一层内有边相连的（环组内的依赖、同层之间的交互）按层内最长路径错开成子层，
 * 保证没有同一 elk 层内的边（elk 的 INTERACTIVE 分层遇到同层边会把节点往下推、打乱层号）；没有层号的节点（孤立的、「+N」）
 * 单列在侧边，从顶上往下逐个放进不与同层节点相连的 elk 层；全部没有层号时排成近似方形的网格（不按交互另排，修订 2）。
 * 返回节点 → elk 层（从 0 起、连续）。
 */
export function elkLayers(nodes: readonly string[], edges: readonly (readonly [string, string])[], tiers: LayoutTiers): Map<string, number> {
  const present = new Set(nodes)
  const adj = new Map<string, Set<string>>(nodes.map(n => [n, new Set()]))
  for (const [a, b] of edges)
    if (a !== b && present.has(a) && present.has(b)) {
      adj.get(a)!.add(b)
      adj.get(b)!.add(a)
    }
  const layer = new Map<string, number>()
  const tiered = nodes.filter(n => tiers.tier[n] !== undefined)
  // 层号可能不连续（如只有边界角色的层不进 elk）：按出现的层号压紧
  const levels = [...new Set(tiered.map(n => tiers.tier[n]))].sort((a, b) => a - b)
  let base = 0
  for (const t of levels) {
    const members = tiered.filter(n => tiers.tier[n] === t)
    const inT = new Set(members)
    // 层内的边按节点顺序定向（先出现的在上），无环；子层 = 层内最长路径
    const rank = new Map(members.map((n, i) => [n, i]))
    const sub = new Map<string, number>()
    for (const n of members) {
      let s = 0
      for (const m of adj.get(n)!) if (inT.has(m) && rank.get(m)! < rank.get(n)!) s = Math.max(s, sub.get(m)! + 1)
      sub.set(n, s)
    }
    let depth = 0
    for (const n of members) {
      layer.set(n, base + sub.get(n)!)
      depth = Math.max(depth, sub.get(n)!)
    }
    base += depth + 1
  }
  const rest = nodes.filter(n => !layer.has(n))
  const rows = new Map<number, string[]>()
  for (const [n, l] of layer) rows.set(l, [...(rows.get(l) ?? []), n])
  const width = tiered.length ? 1 : Math.max(1, Math.ceil(Math.sqrt(rest.length)))
  const used = new Map<number, number>()
  let from = 0
  for (const n of rest) {
    let l = from
    while ((used.get(l) ?? 0) >= width || (rows.get(l) ?? []).some(m => adj.get(n)!.has(m))) l++
    layer.set(n, l)
    rows.set(l, [...(rows.get(l) ?? []), n])
    used.set(l, (used.get(l) ?? 0) + 1)
    // 侧边单列：下一个从下一层开始；网格：从当前没满的第一行开始
    from = width === 1 ? l + 1 : from
    while (width > 1 && (used.get(from) ?? 0) >= width) from++
  }
  return layer
}

/** 层带上下、组框四周的留白（px）：小于 elk 层间距的一半，相邻两带不重叠 */
export const TIER_PAD = 14
export const GROUP_PAD = 10

const hull = (boxes: readonly Box[], pad: number): Box => {
  const x1 = Math.min(...boxes.map(b => b.x)) - pad
  const y1 = Math.min(...boxes.map(b => b.y)) - pad
  const x2 = Math.max(...boxes.map(b => b.x + b.w)) + pad
  const y2 = Math.max(...boxes.map(b => b.y + b.h)) + pad
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * L29：层带横跨父模块框的内部（左右与框留同样的内边距），上下包住该层节点；相邻两层的带在中间分界，不重叠。
 * 环组框包住组内节点，夹着别的节点时不画（交给环编号，Y4）。
 */
export function tierGeometry(nodes: ReadonlyMap<string, Box>, tiers: LayoutTiers, frame: Box | undefined, inset: number): TierGeometry {
  const bands: { tier: number; box: Box }[] = []
  if (tiers.banded) {
    const spans: { tier: number; y1: number; y2: number }[] = []
    for (let t = 0; t < tiers.count; t++) {
      const boxes = Object.keys(tiers.tier)
        .filter(n => tiers.tier[n] === t && nodes.has(n))
        .map(n => nodes.get(n)!)
      if (!boxes.length) continue
      const h = hull(boxes, TIER_PAD)
      spans.push({ tier: t, y1: h.y, y2: h.y + h.h })
    }
    // 相邻两带重叠（子层错开时）在中间分界
    for (let i = 1; i < spans.length; i++) if (spans[i].y1 < spans[i - 1].y2) spans[i].y1 = spans[i - 1].y2 = (spans[i].y1 + spans[i - 1].y2) / 2
    const all = [...nodes.values()]
    const x1 = frame ? frame.x + inset / 2 : Math.min(...all.map(b => b.x)) - TIER_PAD
    const x2 = frame ? frame.x + frame.w - inset / 2 : Math.max(...all.map(b => b.x + b.w)) + TIER_PAD
    for (const s of spans) bands.push({ tier: s.tier, box: { x: x1, y: s.y1, w: x2 - x1, h: s.y2 - s.y1 } })
  }
  const groups: { id: number; box: Box }[] = []
  for (const g of tiers.groups) {
    const boxes = g.nodes.filter(n => nodes.has(n)).map(n => nodes.get(n)!)
    if (boxes.length < 2) continue
    const box = hull(boxes, GROUP_PAD)
    const inner = new Set(g.nodes)
    const clash = [...nodes].some(([id, b]) => !inner.has(id) && overlaps(box, b))
    if (!clash) groups.push({ id: g.id, box })
  }
  return { bands, groups }
}
