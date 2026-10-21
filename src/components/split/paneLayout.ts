/**
 * 分屏布局树（W-4）：可序列化的值，视图组件只按槽位挂载，不知道自己的位置。
 * 提供「两块、方向可切换（默认左右）、比例可拖、副栏可收起」；按项目记在本地，不进视图状态与 URL。
 * 槽位：structure 结构图；aside 副栏（时序图 / 源代码，G15）。
 * 以后的自由拖拽分屏只扩展这里的编辑操作。
 */
export type PaneSlot = 'structure' | 'aside'

export type PaneLayout =
  | { kind: 'pane'; slot: PaneSlot; collapsed?: boolean }
  | { kind: 'split'; dir: 'row' | 'column'; sizes: number[]; children: PaneLayout[] }

export const DEFAULT_LAYOUT: PaneLayout = {
  kind: 'split',
  dir: 'row',
  sizes: [0.55, 0.45],
  children: [
    { kind: 'pane', slot: 'structure' },
    { kind: 'pane', slot: 'aside' },
  ],
}

/** 调整某个分割的比例（第 i 与 i+1 块之间的分隔条拖到 ratio），每块不小于 min */
export function resize(layout: PaneLayout, path: number[], i: number, ratio: number, min = 0.12): PaneLayout {
  if (layout.kind !== 'split') return layout
  if (path.length) {
    const [head, ...rest] = path
    return { ...layout, children: layout.children.map((c, k) => (k === head ? resize(c, rest, i, ratio, min) : c)) }
  }
  const before = layout.sizes.slice(0, i).reduce((a, b) => a + b, 0)
  const pair = layout.sizes[i] + layout.sizes[i + 1]
  const a = Math.min(Math.max(ratio - before, min), pair - min)
  const sizes = [...layout.sizes]
  sizes[i] = a
  sizes[i + 1] = pair - a
  return { ...layout, sizes }
}

/** 收起 / 展开某个槽位 */
export function toggleSlot(layout: PaneLayout, slot: PaneSlot): PaneLayout {
  if (layout.kind === 'pane') return layout.slot === slot ? { ...layout, collapsed: !layout.collapsed } : layout
  return { ...layout, children: layout.children.map(c => toggleSlot(c, slot)) }
}

/** 根分割的方向：左右（row）或上下（column） */
export function directionOf(layout: PaneLayout): 'row' | 'column' {
  return layout.kind === 'split' ? layout.dir : 'row'
}

/** 切换根分割的方向，比例与收起状态保留 */
export function setDirection(layout: PaneLayout, dir: 'row' | 'column'): PaneLayout {
  return layout.kind === 'split' ? { ...layout, dir } : layout
}

export function isPaneLayout(x: unknown): x is PaneLayout {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  if (o.kind === 'pane') return o.slot === 'structure' || o.slot === 'aside'
  return (
    o.kind === 'split' &&
    (o.dir === 'row' || o.dir === 'column') &&
    Array.isArray(o.sizes) &&
    Array.isArray(o.children) &&
    o.sizes.length === o.children.length &&
    o.children.every(isPaneLayout)
  )
}

// v2：默认方向改为左右（ADR-0006），旧的上下比例不再沿用
const key = (project?: string) => `h5p-arch-desk:split:v2:${project ?? '-'}`

/** 旧的槽位名 sequence（副栏泛化前，ADR-0007）读出时改为 aside */
function migrate(x: unknown): unknown {
  if (!x || typeof x !== 'object') return x
  const o = x as Record<string, unknown>
  if (o.kind === 'pane') return o.slot === 'sequence' ? { ...o, slot: 'aside' } : o
  return Array.isArray(o.children) ? { ...o, children: o.children.map(migrate) } : o
}

export function readLayout(project?: string): PaneLayout {
  try {
    const raw = migrate(JSON.parse(localStorage.getItem(key(project)) ?? 'null'))
    return isPaneLayout(raw) ? raw : DEFAULT_LAYOUT
  } catch {
    return DEFAULT_LAYOUT
  }
}

export function saveLayout(project: string | undefined, layout: PaneLayout) {
  try {
    localStorage.setItem(key(project), JSON.stringify(layout))
  } catch {
    /* 存不了就算了 */
  }
}
