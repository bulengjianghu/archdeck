/**
 * 分层总览排布（O1–O7）：按层序分带，规则排布，不调用 elk；核心跨层边与参与者的边画成曲线。
 */
import type { LevelView } from '@/model'
import { NODE_SIZE, sizeOf, type Box, type EdgeRoute, type LayoutOptions, type PositionedView } from './geometry'
import { actorRoute, hasActors, isActorNode, parallelOffsets, placeActors, shifted } from './routes'

export const BAND = {
  left: 236,
  right: 168,
  minMiddle: 520,
  chip: { w: 168, h: 46 },
  chipGap: 14,
  padY: 24,
  minH: 104,
  gap: 64,
  lane: 22,
  /** 系统边界框与带、右侧通道之间的留白：与普通层次父模块框的 FRAME_PAD 同量级 */
  framePad: 28,
  /** O7：带内每行模块块的上限 */
  maxColumns: 8,
}

/** 没有画布宽度时的带内列数 */
export const DEFAULT_BAND_COLUMNS = 5

// ── 分层总览 ─────────────────────────────────────────────────

/** 带内「+N 个其他模块」占位块的 ID */
export function moreChipId(layerId: string): string {
  return `more:${layerId}`
}

/** O7：带内每行能放几个模块块——按画布宽度铺开，至少 3、至多 BAND.maxColumns */
export function bandColumnsFor(canvasWidth: number): number {
  const fit = Math.floor((canvasWidth - BAND.left - BAND.right - BAND.chipGap) / (BAND.chip.w + BAND.chipGap))
  return Math.max(3, Math.min(BAND.maxColumns, fit))
}

/** 带内有占位块（「+N 个其他模块」或展开后的「收起」） */
const hasChip = (b: { hiddenCount: number; expanded?: number }) => b.hiddenCount > 0 || !!b.expanded

export function layoutLayered(view: LevelView, opts: LayoutOptions = {}): PositionedView {
  const bands = view.bands ?? []
  const nodes = new Map<string, Box>()
  const columns = opts.bandColumns ?? DEFAULT_BAND_COLUMNS
  const maxCore = Math.max(1, ...bands.map(b => b.coreModuleIds.length + (hasChip(b) ? 1 : 0)))
  const perRow = Math.max(3, Math.min(maxCore, columns))
  // O7：带宽按画布铺开（列数给出），内容少时也不缩窄
  const middle = Math.max(BAND.minMiddle, columns * (BAND.chip.w + BAND.chipGap) - BAND.chipGap + 2 * BAND.chipGap)
  const width = BAND.left + middle + BAND.right

  let y = 0
  const bandIndex = new Map<string, number>()
  bands.forEach((band, i) => {
    bandIndex.set(band.layerId, i)
    const slots = band.coreModuleIds.length + (hasChip(band) ? 1 : 0)
    const rows = Math.max(1, Math.ceil(slots / perRow))
    const h = Math.max(BAND.minH, rows * BAND.chip.h + (rows - 1) * BAND.chipGap + 2 * BAND.padY)
    nodes.set(band.layerId, { x: 0, y, w: width, h })
    const rowTop = y + (h - (rows * BAND.chip.h + (rows - 1) * BAND.chipGap)) / 2
    const chipBox = (k: number): Box => ({
      x: BAND.left + BAND.chipGap + (k % perRow) * (BAND.chip.w + BAND.chipGap),
      y: rowTop + Math.floor(k / perRow) * (BAND.chip.h + BAND.chipGap),
      w: BAND.chip.w,
      h: BAND.chip.h,
    })
    band.coreModuleIds.forEach((id, k) => nodes.set(id, chipBox(k)))
    if (hasChip(band)) nodes.set(moreChipId(band.layerId), chipBox(band.coreModuleIds.length))
    y += h + BAND.gap
  })

  // 边界节点（嵌套的分层子系统才会有）放在最下方一行
  const boundaries = view.nodes.filter(n => n.role === 'boundary')
  boundaries.forEach((n, i) => nodes.set(n.id, { x: i * (NODE_SIZE.boundary.w + 24), y, ...sizeOf(n) }))

  const edges = new Map<string, EdgeRoute>()
  // 相邻层之间：带间空隙里的竖线，同一空隙内的多条边横向错开
  // 跨多层：走右侧通道，每条占一条车道
  const gapSlots = new Map<string, number>()
  let lane = 0
  for (const e of view.edges) {
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    if (!a || !b) continue
    const ia = bandIndex.get(e.from)
    const ib = bandIndex.get(e.to)
    if (ia !== undefined && ib !== undefined && Math.abs(ia - ib) === 1) {
      const key = `${Math.min(ia, ib)}`
      const slot = gapSlots.get(key) ?? 0
      gapSlots.set(key, slot + 1)
      const x = BAND.left + middle / 2 + (slot % 2 === 0 ? 1 : -1) * Math.ceil(slot / 2) * 112
      const down = ia < ib
      const y1 = down ? a.y + a.h : a.y
      const y2 = down ? b.y : b.y + b.h
      edges.set(e.id, {
        points: [
          { x, y: y1 },
          { x, y: y2 },
        ],
        label: { x, y: (y1 + y2) / 2 },
      })
    } else {
      const x = width + 28 + lane * BAND.lane
      lane++
      const y1 = a.y + a.h / 2 + (lane % 3) * 8 - 8
      const y2 = b.y + b.h / 2 + (lane % 3) * 8 - 8
      edges.set(e.id, {
        points: [
          { x: a.x + a.w, y: y1 },
          { x, y: y1 },
          { x, y: y2 },
          { x: b.x + b.w, y: y2 },
        ],
        label: { x, y: (y1 + y2) / 2 },
      })
    }
  }

  // 系统边界框包住全部带与右侧通道，四周留 BAND.framePad，不与带的外沿重合
  const pad = BAND.framePad
  const right = lane ? width + 28 + (lane - 1) * BAND.lane : width
  const frame = { x: -pad, y: -pad, w: right + 2 * pad, h: Math.max(0, y - BAND.gap) + 2 * pad }
  // A7：用户在带的上方一行，外部系统与时间在右侧通道之外一列；与参与者相连的边画成曲线
  placeActors(view, nodes, frame, width + 28 + lane * BAND.lane + 56 - frame.x - frame.w)
  const offsets = parallelOffsets(view.edges)
  for (const e of view.edges) {
    if (edges.has(e.id)) continue
    const route = actorRoute(nodes.get(e.from), nodes.get(e.to))
    if (route) edges.set(e.id, shifted(route, offsets.get(e.id) ?? 0))
  }

  const coreEdges = new Map<string, EdgeRoute>()
  const coreOffsets = parallelOffsets(view.coreEdges ?? [])
  for (const e of view.coreEdges ?? []) {
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    if (!a || !b) continue
    const actorEnd = isActorNode(view, e.from) || isActorNode(view, e.to)
    const d = coreOffsets.get(e.id) ?? 0
    if (actorEnd) {
      coreEdges.set(e.id, shifted(actorRoute(a, b)!, d))
      continue
    }
    const down = a.y < b.y
    const p1 = { x: a.x + a.w / 2, y: down ? a.y + a.h : a.y }
    const p2 = { x: b.x + b.w / 2, y: down ? b.y : b.y + b.h }
    coreEdges.set(e.id, shifted({ points: [p1, p2], curve: true, label: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } }, d))
  }

  return { view, nodes, edges, coreEdges, ...(hasActors(view) ? { frame } : {}) }
}
