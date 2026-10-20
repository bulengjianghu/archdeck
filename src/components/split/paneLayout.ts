/**
 * 分屏布局树（W-4）：可序列化的值，视图组件只按槽位挂载，不知道自己的位置。
 * 二期只提供「上下两块、比例可拖、下方可收起」；比例按项目记在本地，不进视图状态与 URL。
 * 以后的自由拖拽分屏只扩展这里的编辑操作。
 */
export type PaneSlot = 'structure' | 'sequence'

export type PaneLayout =
  | { kind: 'pane'; slot: PaneSlot; collapsed?: boolean }
  | { kind: 'split'; dir: 'row' | 'column'; sizes: number[]; children: PaneLayout[] }

export const DEFAULT_LAYOUT: PaneLayout = {
  kind: 'split',
  dir: 'column',
  sizes: [0.62, 0.38],
  children: [
    { kind: 'pane', slot: 'structure' },
    { kind: 'pane', slot: 'sequence' },
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

export function isPaneLayout(x: unknown): x is PaneLayout {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  if (o.kind === 'pane') return o.slot === 'structure' || o.slot === 'sequence'
  return (
    o.kind === 'split' &&
    (o.dir === 'row' || o.dir === 'column') &&
    Array.isArray(o.sizes) &&
    Array.isArray(o.children) &&
    o.sizes.length === o.children.length &&
    o.children.every(isPaneLayout)
  )
}

const key = (project?: string) => `h5p-arch-desk:split:${project ?? '-'}`

export function readLayout(project?: string): PaneLayout {
  try {
    const raw = JSON.parse(localStorage.getItem(key(project)) ?? 'null')
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
