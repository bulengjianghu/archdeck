/**
 * 分层总览排布（O1–O7）：按层序分带，规则排布，不调用 elk；核心模块之间的跨层边画成曲线，框外元素（参与者、边界节点）按方位摆放、边正交走线（A7、L4）。
 * 带间空隙按穿过它的横段撑开（O14）：每条横段占一条轨道，轨道的次序让核心车道的线互不交叉（O15）；外部系统与时间在左侧，右侧只留层间关系线（O16）。
 */
import type { LevelView, ViewEdge } from '@/model'
import { SHELF, type Box, type EdgeRoute, type LayoutOptions, type PositionedView } from './geometry'
import { compassOf, isOutsideEdge, PARALLEL_GAP, labelSize, placeOutside, portFor, slotOf, withSourceLane, type Compass } from './routes'
import { allocateTracks, curvePoints, detour, placeLabelBoxes, type LabelLine, type PortAt } from './routing'
// L23b（第九轮）：总览核心边的把手角标——独立的一段，见文件末尾 coreHandleBadges
import type { ModelIndex } from '@/model'
import { handleBadge, type HandleBadge } from './routes'

export const BAND = {
  left: 236,
  right: 168,
  minMiddle: 520,
  chip: { w: 168, h: 46 },
  chipGap: 14,
  padY: 24,
  minH: 104,
  /** O14：带间空隙的最小高度（没有横段或横段少时） */
  gap: 64,
  lane: 22,
  /** O3b：跨多层的核心跨层边在层间边车道之外的核心车道，间距比层间边车道紧 */
  coreLane: 12,
  /** O14：空隙里横段的轨距（同平行边间距）与最外一条轨道到带边、框线的留白（放得下带上边的计数标签） */
  track: PARALLEL_GAP,
  trackPad: 18,
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

/** O14、O15：空隙里的一条横段——属于哪条边的哪一端、哪一组（向上离开 / 向左的框外边 / 向下离开）、核心车道号、是否常显 */
interface GapItem {
  key: string
  edge: ViewEdge
  group: 'up' | 'side' | 'down'
  lane: number
  always: boolean
}

/**
 * O14、O15：每个空隙（0 为第一条带之上的框内留白，i 为第 i−1 与第 i 条带之间，n 为最后一条带之下）里的横段分到轨道。
 * 次序自上而下：向上离开的核心车道横段（内车道在上）→ 框外边的横段 → 向下离开的核心车道横段（内车道在下），这样车道竖段不穿过同空隙的别的横段。
 * 同一车道号的核心边没有共同端点、不会同时画出，共用一条轨道；框外边的横段按「常显的独占、有共同端点的不同轨」着色。
 * 返回各端的（空隙、轨道号）与各空隙的轨道数。
 */
export function gapTracks(items: readonly (readonly GapItem[])[]): { trackOf: Map<string, { gap: number; t: number }>; counts: number[] } {
  const trackOf = new Map<string, { gap: number; t: number }>()
  const ends = (x: GapItem) => [x.edge.from, x.edge.to]
  const conflicts = (a: GapItem, b: GapItem) => a.always || b.always || ends(a).some(n => ends(b).includes(n))
  const counts = items.map((list, gap) => {
    let t = 0
    const byLane = (group: 'up' | 'down', order: 1 | -1) => {
      const lanes = [...new Set(list.filter(x => x.group === group).map(x => x.lane))].sort((a, b) => order * (a - b))
      for (const k of lanes) {
        for (const x of list) if (x.group === group && x.lane === k) trackOf.set(x.key, { gap, t })
        t++
      }
    }
    byLane('up', 1)
    const colors: GapItem[][] = []
    for (const x of list.filter(s => s.group === 'side').sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
      const c = colors.find(group => group.every(o => !conflicts(o, x)))
      if (c) c.push(x)
      else colors.push([x])
    }
    for (const c of colors) {
      for (const x of c) trackOf.set(x.key, { gap, t })
      t++
    }
    byLane('down', -1)
    return t
  })
  return { trackOf, counts }
}

/** O14：放得下 t 条轨道的空隙高度（不低于 floor） */
export const gapHeight = (t: number, floor: number) => Math.max(floor, t ? (t - 1) * BAND.track + 2 * BAND.trackPad : 0)

export function layoutLayered(view: LevelView, opts: LayoutOptions = {}): PositionedView {
  const bands = view.bands ?? []
  const nodes = new Map<string, Box>()
  const columns = opts.bandColumns ?? DEFAULT_BAND_COLUMNS
  // L14：带内的边界角色——port 压在带的上边、adapter 贴带的左边（标题栏旁、外部系统一侧），不占核心模块的行
  const rimOf = new Map(view.nodes.flatMap(n => (n.rim && n.role === 'core' ? [[n.id, n.rim] as const] : [])))
  const regular = (b: { coreModuleIds: string[] }) => b.coreModuleIds.filter(id => !rimOf.has(id))
  const maxCore = Math.max(1, ...bands.map(b => regular(b).length + (hasChip(b) ? 1 : 0)))
  const perRow = Math.max(3, Math.min(maxCore, columns))
  // O7：带宽按画布铺开（列数给出），内容少时也不缩窄
  const middle = Math.max(BAND.minMiddle, columns * (BAND.chip.w + BAND.chipGap) - BAND.chipGap + 2 * BAND.chipGap)
  // L14：有 adapter 时带内最左多一列，紧贴左侧标题栏（外部系统一侧，A7）
  const adapterCol = view.nodes.some(n => n.rim === 'adapter' && n.role === 'core') ? BAND.chip.w + BAND.chipGap : 0
  const chipLeft = BAND.left + adapterCol
  const width = BAND.left + adapterCol + middle + BAND.right

  // ── 拓扑（不依赖坐标）：节点所在的带、跨多层的核心边与车道、空隙里的横段（O14、O15）──
  const byId = new Map(view.nodes.map(n => [n.id, n]))
  const bandIds = new Set(bands.map(b => b.layerId))
  const bandOf = new Map<string, number>()
  bands.forEach((b, i) => {
    bandOf.set(b.layerId, i)
    b.coreModuleIds.forEach(id => bandOf.set(id, i))
    if (hasChip(b)) bandOf.set(moreChipId(b.layerId), i)
  })
  const compassAt = (id: string): Compass => {
    const n = byId.get(id)
    return n ? compassOf(n) : 'inner'
  }
  const spansLayers = (e: ViewEdge) => {
    const ia = bandOf.get(e.from)
    const ib = bandOf.get(e.to)
    return ia !== undefined && ib !== undefined && Math.abs(ia - ib) > 1 && !isOutsideEdge(view, e)
  }
  const core = view.coreEdges ?? []
  const coreLaneOf = assignLanes(core.filter(spansLayers))
  const coreLanes = Math.max(0, ...coreLaneOf.values()) + (coreLaneOf.size ? 1 : 0)
  const outside = view.edges.filter(e => isOutsideEdge(view, e))
  const coreOutside = core.filter(e => isOutsideEdge(view, e))

  /** 框外边在带 / 核心模块那一端走哪条边：带朝对端方位（左侧参与者走左边，O16）；核心模块上进下出（A7） */
  const innerSide = (id: string, other: string, end: 'in' | 'out'): 'top' | 'bottom' | 'left' => {
    if (!bandIds.has(id)) return end === 'in' ? 'top' : 'bottom'
    const oc = compassAt(other)
    return oc === 'left' ? 'left' : oc === 'top' ? 'top' : 'bottom'
  }
  const items: GapItem[][] = Array.from({ length: bands.length + 1 }, () => [])
  for (const e of core.filter(spansLayers)) {
    const i = bandOf.get(e.from)!
    const j = bandOf.get(e.to)!
    const lane = coreLaneOf.get(e.id)!
    // 向下：出端在源带之下的空隙、竖段从轨道向下离开；入端在目标带之上的空隙、竖段从上方来（向上离开）。向上时相反
    items[j > i ? i + 1 : i].push({ key: `${e.id}:out`, edge: e, group: j > i ? 'down' : 'up', lane, always: false })
    items[j > i ? j : j + 1].push({ key: `${e.id}:in`, edge: e, group: j > i ? 'up' : 'down', lane, always: false })
  }
  for (const [group, always] of [
    [outside, true],
    [coreOutside, false],
  ] as const)
    for (const e of group)
      for (const [id, other, end] of [
        [e.from, e.to, 'out'],
        [e.to, e.from, 'in'],
      ] as const) {
        const i = bandOf.get(id)
        if (i === undefined || compassAt(id) !== 'inner') continue
        const side = innerSide(id, other, end)
        if (side !== 'left') items[side === 'top' ? i : i + 1].push({ key: `${e.id}:${end}`, edge: e, group: 'side', lane: 0, always })
      }
  const { trackOf, counts } = gapTracks(items)
  const gapH = counts.map((t, g) => gapHeight(t, g === 0 || g === bands.length ? BAND.framePad : BAND.gap))

  // ── 带与块的位置 ──
  let y = 0
  bands.forEach((band, i) => {
    const cores = regular(band)
    const ports = band.coreModuleIds.filter(id => rimOf.get(id) === 'port')
    const adapters = band.coreModuleIds.filter(id => rimOf.get(id) === 'adapter')
    const slots = cores.length + (hasChip(band) ? 1 : 0)
    const rows = Math.max(1, Math.ceil(slots / perRow))
    // port 一半压在带内：核心模块行往下让出半块
    const rimTop = ports.length ? BAND.chip.h / 2 : 0
    // O9：带底的共用件架，紧凑一行（放不下换行），左侧留出「共用件」字样；adapter 列在架之上
    const shelf = band.shelf ?? []
    const shelfPerRow = Math.max(1, Math.floor((middle - BAND.chipGap - SHELF.label + SHELF.gap) / (SHELF.w + SHELF.gap)))
    const shelfRows = Math.ceil(shelf.length / shelfPerRow)
    const shelfH = shelfRows ? shelfRows * (SHELF.h + SHELF.gap) - SHELF.gap + BAND.shelfGap : 0
    const adaptersH = adapters.length ? adapters.length * BAND.chip.h + (adapters.length - 1) * BAND.chipGap + 2 * BAND.padY + rimTop + shelfH : 0
    const coreH = rows * BAND.chip.h + (rows - 1) * BAND.chipGap
    const h = Math.max(BAND.minH, coreH + 2 * BAND.padY + shelfH + rimTop, adaptersH)
    nodes.set(band.layerId, { x: 0, y, w: width, h })
    const rowTop = y + rimTop + (h - rimTop - shelfH - coreH) / 2
    ports.forEach((id, k) =>
      nodes.set(id, { x: chipLeft + BAND.chipGap + k * (BAND.chip.w + BAND.chipGap), y: y - BAND.chip.h / 2, w: BAND.chip.w, h: BAND.chip.h }),
    )
    adapters.forEach((id, k) =>
      nodes.set(id, {
        x: BAND.left + BAND.chipGap / 2,
        y: y + rimTop + BAND.padY + k * (BAND.chip.h + BAND.chipGap),
        w: BAND.chip.w,
        h: BAND.chip.h,
      }),
    )
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
      x: chipLeft + BAND.chipGap + (k % perRow) * (BAND.chip.w + BAND.chipGap),
      y: rowTop + Math.floor(k / perRow) * (BAND.chip.h + BAND.chipGap),
      w: BAND.chip.w,
      h: BAND.chip.h,
    })
    cores.forEach((id, k) => nodes.set(id, chipBox(k)))
    if (hasChip(band)) nodes.set(moreChipId(band.layerId), chipBox(cores.length))
    y += h + (i < bands.length - 1 ? gapH[i + 1] : 0)
  })
  const bandBoxes = bands.map(b => nodes.get(b.layerId)!)
  /** O14：空隙 g 的上下沿（第一条带之上、最后一条带之下到框线） */
  const gapSpan = (g: number): [number, number] => {
    const top = g === 0 ? (bandBoxes[0]?.y ?? 0) - gapH[0] : bandBoxes[g - 1].y + bandBoxes[g - 1].h
    const bottom = g === bands.length ? top + gapH[g] : bandBoxes[g].y
    return [top, bottom]
  }
  const trackY = (key: string): number | undefined => {
    const at = trackOf.get(key)
    if (!at) return undefined
    const [top, bottom] = gapSpan(at.gap)
    return (top + bottom) / 2 + (at.t - (counts[at.gap] - 1) / 2) * BAND.track
  }

  const edges = new Map<string, EdgeRoute>()
  // 相邻层之间：带间空隙里的竖线，走块与块之间的竖巷（O15：不与块的端口短桩重合），同一空隙内的多条边从离中线最近的巷起依次占用；
  // 条数多于巷数时（并集布局里还有结构边，L15）改为从中线起左右交替、按条数收窄间距，最外一条不超出带的中间区域
  // 跨多层：走右侧通道，每条占一条车道
  const adjacent = (e: ViewEdge) => {
    const ia = bandOf.get(e.from)
    const ib = bandOf.get(e.to)
    return ia !== undefined && ib !== undefined && Math.abs(ia - ib) === 1 && nodes.has(e.from) && nodes.has(e.to) && !isOutsideEdge(view, e)
  }
  const mid = chipLeft + middle / 2
  const alleys = Array.from({ length: perRow + 1 }, (_, k) => chipLeft + BAND.chipGap / 2 + k * (BAND.chip.w + BAND.chipGap)).sort(
    (p, q) => Math.abs(p - mid) - Math.abs(q - mid) || p - q,
  )
  const gapCount = new Map<string, number>()
  for (const e of view.edges.filter(adjacent)) {
    const key = `${Math.min(bandOf.get(e.from)!, bandOf.get(e.to)!)}`
    gapCount.set(key, (gapCount.get(key) ?? 0) + 1)
  }
  const gapStep = (key: string) => Math.min(112, (middle / 2 - BAND.chipGap) / Math.max(1, Math.ceil(((gapCount.get(key) ?? 1) - 1) / 2)))
  const alleyX = (key: string, slot: number) =>
    (gapCount.get(key) ?? 0) <= alleys.length ? alleys[slot] : mid + (slot % 2 === 0 ? 1 : -1) * Math.ceil(slot / 2) * gapStep(key)
  const gapSlots = new Map<string, number>()
  let lane = 0
  // 跨多层的通道边：先定车道，端口在带右边统一分配（O3a）
  const channel: { e: ViewEdge; a: Box; b: Box; x: number }[] = []
  for (const e of view.edges) {
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    // 框外元素（参与者、边界节点）的边在它们摆好之后另行走线
    if (!a || !b || isOutsideEdge(view, e)) continue
    const ia = bandOf.get(e.from)
    const ib = bandOf.get(e.to)
    if (ia !== undefined && ib !== undefined && adjacent(e)) {
      const key = `${Math.min(ia, ib)}`
      const slot = gapSlots.get(key) ?? 0
      gapSlots.set(key, slot + 1)
      const x = alleyX(key, slot)
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
      channel.push({ e, a, b, x: width + 28 + lane * BAND.lane })
      lane++
    }
  }

  // O3b：跨多层的核心跨层边走层间边车道之外的核心车道，有共同端点的边不同车道；车道常留，不随悬停改变框宽
  const coreX = (k: number) => width + 28 + lane * BAND.lane + k * BAND.coreLane

  // 父模块框（根层即系统框）包住全部带与右侧通道，左右留 BAND.framePad，上下留出空隙 0 与 n（O14），不与带的外沿重合
  const pad = BAND.framePad
  const right = coreLanes ? coreX(coreLanes - 1) : lane ? width + 28 + (lane - 1) * BAND.lane : width
  const top = gapSpan(0)[0]
  const bottom = bands.length ? gapSpan(bands.length)[1] : 0
  const parentFrame = { x: -pad, y: top, w: right + 2 * pad, h: Math.max(0, bottom - top) }
  // A7、L4：边界节点在父模块框下方，用户在上方、外部系统与时间在左侧（O16：右侧只留层间关系线）
  const frame = placeOutside(view, nodes, parentFrame)

  // O3a：带右边的端口统一分配（侧边通道边），上半进、下半出；O16：带左边同样分配（与左侧参与者的边）
  const leftEnds = (group: readonly ViewEdge[]): BandEnd[] =>
    group.flatMap(e =>
      (
        [
          [e.from, e.to, 'out'],
          [e.to, e.from, 'in'],
        ] as const
      ).flatMap(([id, other, end]) => (bandIds.has(id) && compassAt(other) === 'left' ? [{ id: e.id, band: id, end, other: nodes.get(other), lane: 0 }] : [])),
    )
  const rightY = bandSidePorts(
    nodes,
    channel.flatMap(({ e, a, b, x }): BandEnd[] => [
      { id: e.id, band: e.from, end: 'out', other: b, lane: x },
      { id: e.id, band: e.to, end: 'in', other: a, lane: x },
    ]),
  )
  const leftY = bandSidePorts(nodes, leftEnds(outside))
  for (const { e, a, b, x } of channel) {
    const y1 = rightY.get(`${e.id}:out`)!
    const y2 = rightY.get(`${e.id}:in`)!
    edges.set(e.id, {
      points: [
        { x: a.x + a.w, y: y1 },
        { x, y: y1 },
        { x, y: y2 },
        { x: b.x + b.w, y: y2 },
      ],
    })
  }

  // 框外元素的边：正交走线，进出带与核心模块时先到空隙里自己的轨道，不贴着带的边框走（O14）
  const route = outsideRouter(view, nodes, bands, bandOf, trackY)
  // 常显的框外边与核心跨层边中的框外边在参与者上一起排端口位置：聚焦时画出的不与常显的同位（L31）
  const allOutside = [...outside, ...coreOutside]
  const outsideBase = outside.flatMap(e => {
    const r = route(e, allOutside, leftY)
    return r ? [{ id: e.id, points: r.points }] : []
  })
  // L32：常显的框外边一起分轨（左侧参与者与系统框之间的竖段、同一轨道上的横段）
  const fixedLines = [...edges].map(([id, r]) => ({ id, points: r.points }))
  const outsideObstacles = [...bandBoxes, ...view.nodes.filter(n => compassOf(n) !== 'inner').flatMap(n => (nodes.get(n.id) ? [nodes.get(n.id)!] : []))]
  for (const [id, points] of allocateTracks(outsideBase, PARALLEL_GAP, { fixed: fixedLines, obstacles: outsideObstacles })) edges.set(id, { points })

  // O3b：核心跨层边的端口——朝对端取顶边或底边（与参与者的边按 A7 上进下出），同一侧左半进、右半出，半边内按对端横向位置排；
  // O15：走核心车道（向右）的按轨道由远到近从左到右、到左侧参与者（向左）的由近到远，竖段不穿过同侧别的横段
  const coreEdges = new Map<string, EdgeRoute>()
  const centerX = (id: string) => {
    const b = nodes.get(id)
    return b ? b.x + b.w / 2 : Infinity
  }
  const sideOf = (id: string, other: string, end: 'in' | 'out'): 'top' | 'bottom' | 'left' => {
    if (compassAt(other) !== 'inner') return innerSide(id, other, end)
    const i = bandOf.get(id) ?? 0
    const j = bandOf.get(other) ?? 0
    return j > i || (j === i && (nodes.get(other)?.y ?? 0) > (nodes.get(id)?.y ?? 0)) ? 'bottom' : 'top'
  }
  const reach = (key: string, box: Box, side: 'top' | 'bottom') => {
    const t = trackY(key)
    return t === undefined ? 0 : Math.abs(t - (side === 'bottom' ? box.y + box.h : box.y))
  }
  const coreEnds = core.flatMap((e): SideEnd[] =>
    (
      [
        [e.from, e.to, 'out'],
        [e.to, e.from, 'in'],
      ] as const
    ).flatMap(([id, other, end]) => {
      const box = nodes.get(id)
      if (!box || compassAt(id) !== 'inner') return []
      const side = sideOf(id, other, end)
      if (side === 'left') return []
      const key = `${e.id}:${end}`
      const otherX = spansLayers(e) ? 1e6 - reach(key, box, side) : compassAt(other) === 'left' ? -1e6 + reach(key, box, side) : centerX(other)
      return [{ id: e.id, node: id, side, end, otherX }]
    }),
  )
  const coreX0 = sidePorts(nodes, coreEnds)
  const coreLeftY = bandSidePorts(nodes, leftEnds(coreOutside))
  // 核心跨层边中的框外边：聚焦时与常显的线一起画，分轨时常显的线只占不动（L32）
  const coreOutsideBase = coreOutside.flatMap(e => {
    const r = route(e, allOutside, coreLeftY, coreX0)
    return r ? [{ id: e.id, points: r.points }] : []
  })
  const alwaysLines = [...edges].map(([id, r]) => ({ id, points: r.points }))
  for (const [id, points] of allocateTracks(coreOutsideBase, PARALLEL_GAP, { fixed: alwaysLines, obstacles: outsideObstacles })) coreEdges.set(id, { points })
  for (const e of core) {
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    if (!a || !b || isOutsideEdge(view, e)) continue
    const at = (id: string, box: Box, other: string, end: 'in' | 'out') => {
      const side = sideOf(id, other, end)
      return { x: coreX0.get(`${e.id}:${end}`) ?? box.x + box.w / 2, y: side === 'bottom' ? box.y + box.h : box.y, side }
    }
    const p1 = at(e.from, a, e.to, 'out')
    const p2 = at(e.to, b, e.from, 'in')
    const k = coreLaneOf.get(e.id)
    if (k === undefined) {
      coreEdges.set(e.id, { points: [p1, p2].map(({ x, y }) => ({ x, y })), curve: true, label: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } })
      continue
    }
    // 跨多层：端口 → 空隙里自己的轨道 → 核心车道 → 目标一侧空隙里的轨道 → 进入目标，不穿过中间的带
    const x = coreX(k)
    const y1 = trackY(`${e.id}:out`)!
    const y2 = trackY(`${e.id}:in`)!
    coreEdges.set(e.id, {
      points: [
        { x: p1.x, y: p1.y },
        { x: p1.x, y: y1 },
        { x, y: y1 },
        { x, y: y2 },
        { x: p2.x, y: y2 },
        { x: p2.x, y: p2.y },
      ],
    })
  }

  // L33：标签按实际尺寸沿线挑位置——常显的边互不相压，核心跨层边与常显的、与有共同端点（会同时画出）的互不相压，都不压块、参与者与带的文字区
  placeLayeredLabels(view, nodes, bands, edges, coreEdges)
  return { view, nodes, edges, coreEdges, parentFrame, ...(frame ? { frame } : {}) }
}

/** 带的文字区（L33 标签避让）：左侧标题与说明栏、右侧「可依赖」栏、上边框左端的计数标签（O11，在标题栏之上，块的端口短桩不经过）——与 BandNode 的排版一致 */
export function bandTextBoxes(band: Box, counts: boolean): Box[] {
  const boxes = [
    { x: band.x + 16, y: band.y, w: 200, h: band.h },
    { x: band.x + band.w - 154, y: band.y, w: 140, h: band.h },
  ]
  if (counts) boxes.push({ x: band.x + 16, y: band.y - 9, w: 128, h: 16 })
  return boxes
}

function placeLayeredLabels(
  view: LevelView,
  nodes: ReadonlyMap<string, Box>,
  bands: readonly { layerId: string; shelf?: readonly string[]; hiddenCount: number }[],
  edges: Map<string, EdgeRoute>,
  coreEdges: Map<string, EdgeRoute>,
) {
  const bandIds = new Set(bands.map(b => b.layerId))
  const obstacles = [
    ...[...nodes].filter(([id]) => !bandIds.has(id)).map(([, b]) => b),
    ...bands.flatMap(b => bandTextBoxes(nodes.get(b.layerId)!, !!(b.shelf?.length || b.hiddenCount))),
  ]
  const lineOf = (e: ViewEdge, r: EdgeRoute | undefined, id: string): LabelLine[] => {
    const size = labelSize(e)
    if (!r || !size) return []
    // 曲线按画出来的 S 形采样，标签落在曲线上（避开中段的端点以外都可选）
    return [{ id, points: r.curve && r.points.length === 2 ? curvePoints(r.points, r.curve).slice(3, -3) : r.points, size }]
  }
  const always = view.edges.flatMap(e => lineOf(e, edges.get(e.id), e.id))
  const core = (view.coreEdges ?? []).flatMap(e => lineOf(e, coreEdges.get(e.id), `core:${e.id}`))
  const ends = new Map<string, string[]>([
    ...view.edges.map(e => [e.id, [e.from, e.to]] as [string, string[]]),
    ...(view.coreEdges ?? []).map(e => [`core:${e.id}`, [e.from, e.to]] as [string, string[]]),
  ])
  const isCore = (id: string) => id.startsWith('core:')
  // 常显的边与谁都同时画出；两条核心跨层边只在有共同端点时同时画出（O4：聚焦一个核心模块时画它的边）
  const together = (a: string, b: string) => !isCore(a) || !isCore(b) || ends.get(a)!.some(n => ends.get(b)!.includes(n))
  const placed = placeLabelBoxes([...always, ...core], { obstacles, together })
  for (const [id, at] of placed) {
    const m = isCore(id) ? coreEdges : edges
    const key = isCore(id) ? id.slice('core:'.length) : id
    m.set(key, { ...m.get(key)!, label: at })
  }
}

/** O3b：车道分配——按 ID 依次取最小的、与已分配的有共同端点的边都不同的车道 */
function assignLanes(edges: readonly ViewEdge[]): Map<string, number> {
  const out = new Map<string, number>()
  const used = new Map<string, Set<number>>()
  for (const e of [...edges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const taken = new Set([...(used.get(e.from) ?? []), ...(used.get(e.to) ?? [])])
    let k = 0
    while (taken.has(k)) k++
    out.set(e.id, k)
    for (const n of [e.from, e.to]) used.set(n, new Set([...(used.get(n) ?? []), k]))
  }
  return out
}

/** 节点顶边或底边上的一个端点：`otherX` 为排序键（对端的横向位置；走核心车道、连到左侧参与者的按轨道远近，见 O15） */
interface SideEnd {
  id: string
  node: string
  side: 'top' | 'bottom'
  end: 'in' | 'out'
  otherX: number
}

/**
 * O3b：节点顶边 / 底边的端口分配，键为 `<边 ID>:<in|out>`，值为端口的 x。同一侧左半进、右半出，各半内居中、按 otherX 从左到右、
 * PARALLEL_GAP 错开；L31：这一侧只有进或只有出时用整条边，放不下时等分压缩。
 */
function sidePorts(nodes: ReadonlyMap<string, Box>, ends: readonly SideEnd[]): Map<string, number> {
  const out = new Map<string, number>()
  const groups = new Map<string, SideEnd[]>()
  for (const x of ends) {
    const k = `${x.node}\n${x.side}\n${x.end}`
    groups.set(k, [...(groups.get(k) ?? []), x])
  }
  for (const group of groups.values()) {
    const box = nodes.get(group[0].node)
    if (!box) continue
    const { node, side, end } = group[0]
    const sorted = [...group].sort((p, q) => p.otherX - q.otherX || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0))
    const shared = groups.has(`${node}\n${side}\n${end === 'in' ? 'out' : 'in'}`)
    const len = shared ? box.w / 2 : box.w
    const center = !shared ? box.x + box.w / 2 : end === 'in' ? box.x + len / 2 : box.x + len + len / 2
    const step = Math.min(PARALLEL_GAP, (len - 16) / Math.max(1, sorted.length - 1))
    sorted.forEach((x, i) => out.set(`${x.id}:${x.end}`, center + (i - (sorted.length - 1) / 2) * step))
  }
  return out
}

/** 带左边 / 右边上的一个端点：`lane` 为通道车道的 x（左侧参与者的边为 0） */
interface BandEnd {
  id: string
  band: string
  end: 'in' | 'out'
  other: Box | undefined
  lane: number
}

/**
 * O3a、O16：带一侧（右边的侧边通道、左边的参与者）的端口统一分配，键为 `<边 ID>:<in|out>`，值为端口的 y。上半进、下半出，各半内居中、
 * 按 PARALLEL_GAP 错开（放不下时收窄）；半内先排对端在上方的（车道由内到外自上而下）、再排对端在下方的（由外到内），横段不压过同侧别的竖段。
 */
function bandSidePorts(nodes: ReadonlyMap<string, Box>, ends: readonly BandEnd[]): Map<string, number> {
  const out = new Map<string, number>()
  const groups = new Map<string, BandEnd[]>()
  for (const x of ends) {
    const k = `${x.band}\n${x.end}`
    groups.set(k, [...(groups.get(k) ?? []), x])
  }
  for (const group of groups.values()) {
    const box = nodes.get(group[0].band)
    if (!box) continue
    const mid = box.y + box.h / 2
    const above = (x: BandEnd) => (x.other ? x.other.y + x.other.h / 2 < mid : true)
    const sorted = [...group].sort(
      (p, q) => Number(!above(p)) - Number(!above(q)) || (above(p) ? p.lane - q.lane : q.lane - p.lane) || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0),
    )
    const half = box.h / 2
    const center = group[0].end === 'in' ? box.y + half / 2 : mid + half / 2
    const step = Math.min(PARALLEL_GAP, (half - 16) / Math.max(1, sorted.length - 1))
    sorted.forEach((x, i) => out.set(`${x.id}:${x.end}`, center + (i - (sorted.length - 1) / 2) * step))
  }
  return out
}

/**
 * 分层总览中框外元素的边：端口按方位（用户底边、外部系统右边、边界节点顶边）；带按对端方位取顶边 / 左边 / 底边；
 * 核心模块进边在顶边、出边在底边，短桩一直走到空隙里自己的轨道（O14）。
 */
function outsideRouter(
  view: LevelView,
  nodes: Map<string, Box>,
  bands: readonly { layerId: string; coreModuleIds: string[] }[],
  bandOf: ReadonlyMap<string, number>,
  trackY: (key: string) => number | undefined,
) {
  const bandBoxes = bands.map(b => nodes.get(b.layerId)!)
  const byId = new Map(view.nodes.map(n => [n.id, n]))
  const obstacles = [...bandBoxes, ...view.nodes.filter(n => compassOf(n) !== 'inner').flatMap(n => (nodes.get(n.id) ? [nodes.get(n.id)!] : []))]
  return (e: ViewEdge, group: readonly ViewEdge[], leftY: ReadonlyMap<string, number>, sideX?: ReadonlyMap<string, number>): EdgeRoute | undefined => {
    const port = (id: string, other: string, end: 'in' | 'out'): PortAt | undefined => {
      const box = nodes.get(id)
      const n = byId.get(id)
      if (!box) return undefined
      const slot = slotOf(group, id, e.id)
      const c = n ? compassOf(n) : 'inner'
      // L31：参与者、边界节点没有端口记号，用整条边；模块在前半（L11）
      if (c !== 'inner') return portFor(box, c, end, 'DOWN', slot, undefined, false)
      const i = bandOf.get(id)
      if (i === undefined) return portFor(box, 'inner', end, 'DOWN', slot, undefined, true)
      const isBand = bands[i].layerId === id
      const oc = byId.get(other) ? compassOf(byId.get(other)!) : 'inner'
      // 带：朝向对端所在的方位，左边上半进、下半出（O16）；核心模块：上进下出
      if (isBand && oc === 'left') {
        const p = portFor(box, 'inner', 'in', 'RIGHT', slot, undefined, true)
        return { ...p, y: leftY.get(`${e.id}:${end}`) ?? p.y }
      }
      const goesUp = isBand ? oc === 'top' : end === 'in'
      const p = portFor(box, 'inner', goesUp ? 'in' : 'out', 'DOWN', slot, undefined, true)
      const t = trackY(`${e.id}:${end}`)
      const edgeY = goesUp ? box.y : box.y + box.h
      // O3b：核心跨层边一组里，端口位置与核心模块之间的边一起分配；O14：短桩到自己的轨道
      return { ...p, x: sideX?.get(`${e.id}:${end}`) ?? p.x, ...(t !== undefined ? { stub: Math.abs(t - edgeY), lane: 0 } : {}) }
    }
    const from = port(e.from, e.to, 'out')
    const toPort = port(e.to, e.from, 'in')
    const to = toPort && (toPort.stub !== undefined && toPort.lane === 0 ? toPort : withSourceLane(toPort, slotOf(group, e.from, e.id)))
    return from && to ? { points: detour(from, to, obstacles) } : undefined
  }
}

/**
 * O4、L23b：分层总览核心跨层交互边的把手角标与悬停分组（ADR-0033）——只给数据，不动走线与端口；总览不展开表面，
 * 「×N · M 把手」与按所属子模块分组的悬停列表回答「落在几个把手」，落在哪一处下钻到普通层次再看（L20b / L23）。
 */
export function coreHandleBadges(view: LevelView, index: ModelIndex): Map<string, HandleBadge> {
  const out = new Map<string, HandleBadge>()
  if (view.mode !== 'layered') return out
  for (const e of view.coreEdges ?? []) {
    const b = handleBadge(index, view, e)
    if (b) out.set(e.id, b)
  }
  return out
}
