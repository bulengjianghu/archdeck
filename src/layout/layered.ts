/**
 * 分层总览排布（O1–O7）：按层序分带，规则排布，不调用 elk；核心模块之间的跨层边画成曲线，框外元素（参与者、边界节点）按方位摆放、边正交走线（A7、L4）。
 */
import type { LevelView, ViewEdge } from '@/model'
import { SHELF, type Box, type EdgeRoute, type LayoutOptions, type PositionedView } from './geometry'
import { compassOf, isDynamic, isOutsideEdge, parallelOffsets, placeOutside, portFor, shifted, slotOf, withSourceLane } from './routes'
import { detour, type PortAt } from './routing'

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
  /** O9：共用件架与上方核心模块行之间的距离 */
  shelfGap: 12,
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

/** O9：带底共用件架的外框（带内左侧「共用件」字样起，到最后一块止），给画布画字样 */
export function bandShelfTop(nodes: ReadonlyMap<string, Box>, band: { shelf?: readonly string[] }): number | undefined {
  const first = band.shelf?.[0]
  return first ? nodes.get(first)?.y : undefined
}

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
    // O9：带底的共用件架，紧凑一行（放不下换行），左侧留出「共用件」字样
    const shelf = band.shelf ?? []
    const shelfPerRow = Math.max(1, Math.floor((middle - BAND.chipGap - SHELF.label + SHELF.gap) / (SHELF.w + SHELF.gap)))
    const shelfRows = Math.ceil(shelf.length / shelfPerRow)
    const shelfH = shelfRows ? shelfRows * (SHELF.h + SHELF.gap) - SHELF.gap + BAND.shelfGap : 0
    const coreH = rows * BAND.chip.h + (rows - 1) * BAND.chipGap
    const h = Math.max(BAND.minH, coreH + 2 * BAND.padY + shelfH)
    nodes.set(band.layerId, { x: 0, y, w: width, h })
    const rowTop = y + (h - shelfH - coreH) / 2
    const shelfTop = y + h - BAND.padY / 2 - (shelfH - BAND.shelfGap)
    shelf.forEach((id, k) =>
      nodes.set(id, {
        x: BAND.left + BAND.chipGap + SHELF.label + (k % shelfPerRow) * (SHELF.w + SHELF.gap),
        y: shelfTop + Math.floor(k / shelfPerRow) * (SHELF.h + SHELF.gap),
        w: SHELF.w,
        h: SHELF.h,
      }),
    )
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

  const edges = new Map<string, EdgeRoute>()
  // 相邻层之间：带间空隙里的竖线，同一空隙内的多条边横向错开
  // 跨多层：走右侧通道，每条占一条车道
  const gapSlots = new Map<string, number>()
  let lane = 0
  for (const e of view.edges) {
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    // 框外元素（参与者、边界节点）的边在它们摆好之后另行走线
    if (!a || !b || isOutsideEdge(view, e)) continue
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

  // 父模块框（根层即系统框）包住全部带与右侧通道，四周留 BAND.framePad，不与带的外沿重合
  const pad = BAND.framePad
  const right = lane ? width + 28 + (lane - 1) * BAND.lane : width
  const parentFrame = { x: -pad, y: -pad, w: right + 2 * pad, h: Math.max(0, y - BAND.gap) + 2 * pad }
  // A7、L4：边界节点在父模块框下方，用户在上方、外部系统与时间在右侧通道之外
  const frame = placeOutside(view, nodes, parentFrame, width + 28 + lane * BAND.lane + 56 - parentFrame.x - parentFrame.w)

  // 框外元素的边：正交走线，进出核心模块时先到带间空隙的中线，不贴着带的边框走
  const route = outsideRouter(view, nodes, bands)
  for (const e of view.edges)
    if (isOutsideEdge(view, e))
      setRoute(
        edges,
        e,
        route(
          e,
          view.edges.filter(x => isOutsideEdge(view, x)),
        ),
      )

  const coreEdges = new Map<string, EdgeRoute>()
  const coreOffsets = parallelOffsets(view.coreEdges ?? [])
  const coreOutside = (view.coreEdges ?? []).filter(e => isOutsideEdge(view, e))
  for (const e of view.coreEdges ?? []) {
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    if (!a || !b) continue
    if (isOutsideEdge(view, e)) {
      setRoute(coreEdges, e, route(e, coreOutside))
      continue
    }
    const d = coreOffsets.get(e.id) ?? 0
    const down = a.y < b.y
    const p1 = { x: a.x + a.w / 2, y: down ? a.y + a.h : a.y }
    const p2 = { x: b.x + b.w / 2, y: down ? b.y : b.y + b.h }
    coreEdges.set(e.id, shifted({ points: [p1, p2], curve: true, label: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } }, d))
  }

  return { view, nodes, edges, coreEdges, parentFrame, ...(frame ? { frame } : {}) }
}

const setRoute = (m: Map<string, EdgeRoute>, e: ViewEdge, r: EdgeRoute | undefined) => {
  if (r) m.set(e.id, r)
}

/**
 * 分层总览中框外元素的边：端口按方位（用户底边、外部系统左边、边界节点顶边）；带按对端方位取顶边 / 右边 / 底边；
 * 核心模块进边在顶边、出边在底边，短桩一直走到带间空隙的中线（第一条带之上、最后一条带之下取框内留白的中线）。
 */
function outsideRouter(view: LevelView, nodes: Map<string, Box>, bands: readonly { layerId: string; coreModuleIds: string[] }[]) {
  const bandBoxes = bands.map(b => nodes.get(b.layerId)!)
  const bandOf = new Map<string, number>()
  bands.forEach((b, i) => {
    bandOf.set(b.layerId, i)
    b.coreModuleIds.forEach(id => bandOf.set(id, i))
    bandOf.set(moreChipId(b.layerId), i)
  })
  const above = (i: number) => (i > 0 ? (bandBoxes[i - 1].y + bandBoxes[i - 1].h + bandBoxes[i].y) / 2 : bandBoxes[i].y - BAND.framePad / 2)
  const below = (i: number) => {
    const b = bandBoxes[i]
    return i < bandBoxes.length - 1 ? (b.y + b.h + bandBoxes[i + 1].y) / 2 : b.y + b.h + BAND.framePad / 2
  }
  const byId = new Map(view.nodes.map(n => [n.id, n]))
  const obstacles = [...bandBoxes, ...view.nodes.filter(n => compassOf(n) !== 'inner').flatMap(n => (nodes.get(n.id) ? [nodes.get(n.id)!] : []))]
  return (e: ViewEdge, group: readonly ViewEdge[]): EdgeRoute | undefined => {
    const port = (id: string, other: string, end: 'in' | 'out'): PortAt | undefined => {
      const box = nodes.get(id)
      const n = byId.get(id)
      if (!box) return undefined
      // L11 左动右静：同一类的边在同一半边里错开
      const dyn = isDynamic(e)
      const slot = slotOf(
        group.filter(x => isDynamic(x) === dyn),
        id,
        e.id,
      )
      const c = n ? compassOf(n) : 'inner'
      if (c !== 'inner') return portFor(box, c, end, 'DOWN', slot, undefined, dyn)
      const i = bandOf.get(id)
      if (i === undefined) return portFor(box, 'inner', end, 'DOWN', slot, undefined, dyn)
      const isBand = bands[i].layerId === id
      const oc = byId.get(other) ? compassOf(byId.get(other)!) : 'inner'
      // 带：朝向对端所在的方位；核心模块：上进下出
      if (isBand && oc === 'right') return portFor(box, 'inner', 'out', 'RIGHT', slot, undefined, dyn)
      const goesUp = isBand ? oc === 'top' : end === 'in'
      const p = portFor(box, 'inner', goesUp ? 'in' : 'out', 'DOWN', slot, undefined, dyn)
      return { ...p, stub: goesUp ? box.y - above(i) : below(i) - (box.y + box.h) }
    }
    const from = port(e.from, e.to, 'out')
    const toPort = port(e.to, e.from, 'in')
    const to = toPort && withSourceLane(toPort, slotOf(group, e.from, e.id))
    return from && to ? { points: detour(from, to, obstacles) } : undefined
  }
}
