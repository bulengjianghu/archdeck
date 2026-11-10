/**
 * AI 新框的安放（CI-7，DL-6，ADR-0063 决策 10）：新框落位一次，之后只有人能动；已有的框一个不动。
 * 三档：① 与它有关系的、已摆好的框旁边最近的空位（右、下、左、上、四角）；② 中心区可用区域里的网格空位（行优先）；③ 中心区右侧（现有内容最右边再往右一格）。
 * 坐标与草图的 layout 同一口径：非根草图相对中心区的内容原点（X22），根草图的 y 相对所属层带的顶（X21）。纯函数。
 */
import {
  GRID_GAP_X,
  GRID_GAP_Y,
  ROOT_BAND_COLS,
  ROOT_BAND_GAP,
  ROOT_BAND_PAD,
  ROOT_BAND_ROW,
  ROOT_BAND_X0,
  locateAll,
  ROOT_MOUNT,
  type GridArea,
  type SketchDef,
  type SketchPoint,
} from '@/model'
import { SKETCH_NODE } from './sketch'

export type PlacementTier = 'near' | 'free' | 'right'

export interface Placement extends SketchPoint {
  y: number
  tier: PlacementTier
}

/** 旁边的八个位置，按离得近、先水平后竖直排 */
const AROUND: readonly [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
]

/**
 * DL-6：给新框找位置。existing 为已有的框此刻的位置（显示用的位置，未写进 layout 的也算），fresh 为要安放的新框（按顺序，前面的放好后也算已占）；
 * relations 用来找「与它有关系的框」；area 为中心区的可用区域（非根草图）。根草图按层带：同一层带里的框才算邻居与占位。
 */
export function placeNewBoxes(
  def: SketchDef,
  existing: Readonly<Record<string, SketchPoint>>,
  fresh: readonly string[],
  area?: GridArea,
): Record<string, Placement> {
  const root = def.mount === ROOT_MOUNT
  const parentOf = new Map(locateAll(def).map(m => [m.id, m.parentId]))
  const gx = root ? ROOT_BAND_GAP : GRID_GAP_X
  const gy = root ? ROOT_BAND_ROW : GRID_GAP_Y
  const taken = new Map<string, SketchPoint>(Object.entries(existing).map(([id, p]) => [id, { x: p.x, y: p.y ?? (root ? ROOT_BAND_PAD : 0) }]))
  const peers = (id: string) => [...taken].filter(([x]) => !root || parentOf.get(x) === parentOf.get(id))
  const clash = (id: string, p: SketchPoint) =>
    peers(id).some(([, q]) => Math.abs(q.x - p.x) < SKETCH_NODE.w + 8 && Math.abs((q.y ?? 0) - (p.y ?? 0)) < SKETCH_NODE.h + 8)
  const inside = (p: SketchPoint) =>
    p.x >= (root ? ROOT_BAND_X0 : 0) && (p.y ?? 0) >= (root ? ROOT_BAND_PAD : 0) && (!area || root || p.x + SKETCH_NODE.w <= Math.max(area.w, SKETCH_NODE.w))
  const out: Record<string, Placement> = {}
  for (const id of fresh) {
    let hit: Placement | null = null
    // ① 有关系的框旁
    const related = (def.relations ?? [])
      .flatMap(r => (r.from === id ? [r.to] : r.to === id ? [r.from] : []))
      .filter(x => x !== id && taken.has(x) && (!root || parentOf.get(x) === parentOf.get(id)))
    for (const r of related) {
      const c = taken.get(r)!
      for (const [dx, dy] of AROUND) {
        const p = { x: c.x + dx * gx, y: (c.y ?? 0) + dy * gy }
        if (inside(p) && !clash(id, p)) {
          hit = { ...p, tier: 'near' }
          break
        }
      }
      if (hit) break
    }
    // ② 中心区里的空位（行优先）
    if (!hit) {
      const cols = root ? ROOT_BAND_COLS : area ? Math.max(1, Math.floor((area.w - SKETCH_NODE.w) / gx) + 1) : 4
      const rows = root ? 4 : area?.h ? Math.max(1, Math.floor((area.h - SKETCH_NODE.h) / gy) + 1) : 4
      const x0 = root ? ROOT_BAND_X0 : 0
      const y0 = root ? ROOT_BAND_PAD : 0
      for (let k = 0; k < cols * rows && !hit; k++) {
        const p = { x: x0 + (k % cols) * gx, y: y0 + Math.floor(k / cols) * gy }
        if (!clash(id, p)) hit = { ...p, tier: 'free' }
      }
    }
    // ③ 中心区右侧
    if (!hit) {
      const right = Math.max(root ? ROOT_BAND_X0 : 0, ...peers(id).map(([, q]) => q.x)) + gx
      let p = { x: right, y: root ? ROOT_BAND_PAD : 0 }
      for (let i = 0; i < 100 && clash(id, p); i++) p = { x: p.x, y: p.y + gy }
      hit = { ...p, tier: 'right' }
    }
    out[id] = hit
    taken.set(id, { x: hit.x, y: hit.y })
  }
  return out
}
