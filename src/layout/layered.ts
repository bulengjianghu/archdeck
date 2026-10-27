/**
 * 分层总览排布（O1–O7）：按层序分带，规则排布，不调用 elk；核心模块之间的跨层边画成曲线，框外元素（参与者、边界节点）按方位摆放、边正交走线（A7、L4）。
 */
import type { LevelView, ViewEdge } from '@/model'
import { SHELF, type Box, type EdgeRoute, type LayoutOptions, type PositionedView } from './geometry'
import { compassOf, isOutsideEdge, PARALLEL_GAP, placeOutside, portFor, slotOf, withSourceLane } from './routes'
import { detour, type PortAt } from './routing'
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
  gap: 64,
  lane: 22,
  /** O3b：跨多层的核心跨层边在层间边车道之外的核心车道，间距比层间边车道紧 */
  coreLane: 12,
  /** O3b：同一带间空隙里核心车道横段的上下错开量 */
  coreRise: 4,
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
  // L14：带内的边界角色——port 压在带的上边、adapter 贴带的右边（右侧留白区），不占核心模块的行
  const rimOf = new Map(view.nodes.flatMap(n => (n.rim && n.role === 'core' ? [[n.id, n.rim] as const] : [])))
  const regular = (b: { coreModuleIds: string[] }) => b.coreModuleIds.filter(id => !rimOf.has(id))
  const maxCore = Math.max(1, ...bands.map(b => regular(b).length + (hasChip(b) ? 1 : 0)))
  const perRow = Math.max(3, Math.min(maxCore, columns))
  // O7：带宽按画布铺开（列数给出），内容少时也不缩窄
  const middle = Math.max(BAND.minMiddle, columns * (BAND.chip.w + BAND.chipGap) - BAND.chipGap + 2 * BAND.chipGap)
  // L14：有 adapter 时带内多一列，紧贴右侧「可依赖」栏（带的右边、外部系统一侧）
  const adapterCol = view.nodes.some(n => n.rim === 'adapter' && n.role === 'core') ? BAND.chip.w + BAND.chipGap : 0
  const width = BAND.left + middle + adapterCol + BAND.right

  let y = 0
  const bandIndex = new Map<string, number>()
  bands.forEach((band, i) => {
    bandIndex.set(band.layerId, i)
    const cores = regular(band)
    const ports = band.coreModuleIds.filter(id => rimOf.get(id) === 'port')
    const adapters = band.coreModuleIds.filter(id => rimOf.get(id) === 'adapter')
    const slots = cores.length + (hasChip(band) ? 1 : 0)
    const rows = Math.max(1, Math.ceil(slots / perRow))
    // port 一半压在带内：核心模块行往下让出半块
    const rimTop = ports.length ? BAND.chip.h / 2 : 0
    const adaptersH = adapters.length ? adapters.length * BAND.chip.h + (adapters.length - 1) * BAND.chipGap + 2 * BAND.padY + rimTop : 0
    // O9：带底的共用件架，紧凑一行（放不下换行），左侧留出「共用件」字样
    const shelf = band.shelf ?? []
    const shelfPerRow = Math.max(1, Math.floor((middle - BAND.chipGap - SHELF.label + SHELF.gap) / (SHELF.w + SHELF.gap)))
    const shelfRows = Math.ceil(shelf.length / shelfPerRow)
    const shelfH = shelfRows ? shelfRows * (SHELF.h + SHELF.gap) - SHELF.gap + BAND.shelfGap : 0
    const coreH = rows * BAND.chip.h + (rows - 1) * BAND.chipGap
    const h = Math.max(BAND.minH, coreH + 2 * BAND.padY + shelfH + rimTop, adaptersH)
    nodes.set(band.layerId, { x: 0, y, w: width, h })
    const rowTop = y + rimTop + (h - rimTop - shelfH - coreH) / 2
    ports.forEach((id, k) =>
      nodes.set(id, { x: BAND.left + BAND.chipGap + k * (BAND.chip.w + BAND.chipGap), y: y - BAND.chip.h / 2, w: BAND.chip.w, h: BAND.chip.h }),
    )
    adapters.forEach((id, k) =>
      nodes.set(id, {
        x: width - BAND.right - BAND.chip.w - BAND.chipGap / 2,
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
      x: BAND.left + BAND.chipGap + (k % perRow) * (BAND.chip.w + BAND.chipGap),
      y: rowTop + Math.floor(k / perRow) * (BAND.chip.h + BAND.chipGap),
      w: BAND.chip.w,
      h: BAND.chip.h,
    })
    cores.forEach((id, k) => nodes.set(id, chipBox(k)))
    if (hasChip(band)) nodes.set(moreChipId(band.layerId), chipBox(cores.length))
    y += h + BAND.gap
  })

  const edges = new Map<string, EdgeRoute>()
  // 相邻层之间：带间空隙里的竖线，同一空隙内的多条边从中线起左右交替错开 112 px；条数多（并集布局里还有结构边，L15）时
  // 按空隙内的条数收窄间距，最外一条不超出带的中间区域
  // 跨多层：走右侧通道，每条占一条车道
  const adjacent = (e: ViewEdge) => {
    const ia = bandIndex.get(e.from)
    const ib = bandIndex.get(e.to)
    return ia !== undefined && ib !== undefined && Math.abs(ia - ib) === 1 && nodes.has(e.from) && nodes.has(e.to) && !isOutsideEdge(view, e)
  }
  const gapCount = new Map<string, number>()
  for (const e of view.edges.filter(adjacent)) {
    const key = `${Math.min(bandIndex.get(e.from)!, bandIndex.get(e.to)!)}`
    gapCount.set(key, (gapCount.get(key) ?? 0) + 1)
  }
  const gapStep = (key: string) => Math.min(112, (middle / 2 - BAND.chipGap) / Math.max(1, Math.ceil(((gapCount.get(key) ?? 1) - 1) / 2)))
  const gapSlots = new Map<string, number>()
  let lane = 0
  // 跨多层的通道边：先定车道，端口等参与者摆好后与它们的边一起在带右边分配（O3a）
  const channel: { e: ViewEdge; a: Box; b: Box; x: number }[] = []
  for (const e of view.edges) {
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    // 框外元素（参与者、边界节点）的边在它们摆好之后另行走线
    if (!a || !b || isOutsideEdge(view, e)) continue
    const ia = bandIndex.get(e.from)
    const ib = bandIndex.get(e.to)
    if (ia !== undefined && ib !== undefined && adjacent(e)) {
      const key = `${Math.min(ia, ib)}`
      const slot = gapSlots.get(key) ?? 0
      gapSlots.set(key, slot + 1)
      const x = BAND.left + middle / 2 + (slot % 2 === 0 ? 1 : -1) * Math.ceil(slot / 2) * gapStep(key)
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
  const bandOfNode = new Map<string, number>()
  bands.forEach((b, i) => {
    bandOfNode.set(b.layerId, i)
    b.coreModuleIds.forEach(id => bandOfNode.set(id, i))
    bandOfNode.set(moreChipId(b.layerId), i)
  })
  const spansLayers = (e: ViewEdge) => {
    const ia = bandOfNode.get(e.from)
    const ib = bandOfNode.get(e.to)
    return ia !== undefined && ib !== undefined && Math.abs(ia - ib) > 1 && nodes.has(e.from) && nodes.has(e.to) && !isOutsideEdge(view, e)
  }
  const coreLaneOf = assignLanes((view.coreEdges ?? []).filter(spansLayers))
  const coreLanes = Math.max(0, ...coreLaneOf.values()) + (coreLaneOf.size ? 1 : 0)
  const coreX = (k: number) => width + 28 + lane * BAND.lane + k * BAND.coreLane

  // 父模块框（根层即系统框）包住全部带与右侧通道，四周留 BAND.framePad，不与带的外沿重合
  const pad = BAND.framePad
  const right = coreLanes ? coreX(coreLanes - 1) : lane ? width + 28 + (lane - 1) * BAND.lane : width
  const parentFrame = { x: -pad, y: -pad, w: right + 2 * pad, h: Math.max(0, y - BAND.gap) + 2 * pad }
  // A7、L4：边界节点在父模块框下方，用户在上方、外部系统与时间在右侧通道之外
  const next = coreLanes ? coreX(coreLanes - 1) + BAND.lane : width + 28 + lane * BAND.lane
  const frame = placeOutside(view, nodes, parentFrame, next + 56 - parentFrame.x - parentFrame.w)

  // O3a：带右边的端口统一分配，上半进、下半出
  const bandIds = new Set(bands.map(b => b.layerId))
  const byId = new Map(view.nodes.map(n => [n.id, n]))
  const toRight = (e: ViewEdge) => {
    const n = byId.get(bandIds.has(e.from) ? e.to : e.from)
    return (bandIds.has(e.from) || bandIds.has(e.to)) && !!n && compassOf(n) === 'right'
  }
  const outside = view.edges.filter(e => isOutsideEdge(view, e))
  const coreOutside = (view.coreEdges ?? []).filter(e => isOutsideEdge(view, e))
  const ends = (group: readonly ViewEdge[]): BandEnd[] =>
    group.filter(toRight).map(e => {
      const out = bandIds.has(e.from)
      return { id: e.id, band: out ? e.from : e.to, end: out ? 'out' : 'in', other: nodes.get(out ? e.to : e.from), lane: Infinity }
    })
  const rightY = bandRightPorts(nodes, [
    ...channel.flatMap(({ e, a, b, x }): BandEnd[] => [
      { id: e.id, band: e.from, end: 'out', other: b, lane: x },
      { id: e.id, band: e.to, end: 'in', other: a, lane: x },
    ]),
    ...ends(outside),
  ])
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
      label: { x, y: (y1 + y2) / 2 },
    })
  }

  // 框外元素的边：正交走线，进出核心模块时先到带间空隙的中线，不贴着带的边框走
  const gaps = gapLines(bands.map(b => nodes.get(b.layerId)!))
  const route = outsideRouter(view, nodes, bands, gaps)
  for (const e of outside) setRoute(edges, e, route(e, outside, rightY))

  // O3b：核心跨层边的端口——朝对端取顶边或底边（与参与者的边按 A7 上进下出），同一侧左半进、右半出，半边内按对端横向位置排
  const coreEdges = new Map<string, EdgeRoute>()
  const core = view.coreEdges ?? []
  const centerX = (id: string) => {
    const b = nodes.get(id)
    return b ? b.x + b.w / 2 : Infinity
  }
  const sideOf = (id: string, other: string, end: 'in' | 'out'): 'top' | 'bottom' | 'right' => {
    const o = byId.get(other)
    const oc = o ? compassOf(o) : 'inner'
    if (oc !== 'inner') return bandIds.has(id) ? (oc === 'right' ? 'right' : oc === 'top' ? 'top' : 'bottom') : end === 'in' ? 'top' : 'bottom'
    const i = bandOfNode.get(id) ?? 0
    const j = bandOfNode.get(other) ?? 0
    return j > i || (j === i && (nodes.get(other)?.y ?? 0) > (nodes.get(id)?.y ?? 0)) ? 'bottom' : 'top'
  }
  const coreEnds = core.flatMap((e): SideEnd[] =>
    (
      [
        [e.from, e.to, 'out'],
        [e.to, e.from, 'in'],
      ] as const
    ).flatMap(([id, other, end]) => {
      const o = byId.get(other)
      if (byId.get(id) && compassOf(byId.get(id)!) !== 'inner') return []
      const side = sideOf(id, other, end)
      if (side === 'right') return []
      const far = spansLayers(e) || (o && compassOf(o) === 'right')
      return [{ id: e.id, node: id, side, end, otherX: far ? Infinity : centerX(other) }]
    }),
  )
  const coreX0 = sidePorts(nodes, coreEnds)
  // 核心跨层边中经带右边的另成一组（悬停时才画）
  const coreRightY = bandRightPorts(nodes, ends(coreOutside))
  for (const e of core) {
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    if (!a || !b) continue
    if (isOutsideEdge(view, e)) {
      setRoute(coreEdges, e, route(e, coreOutside, coreRightY, coreX0))
      continue
    }
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
    // 跨多层：端口 → 相邻带间空隙 → 核心车道 → 目标一侧的带间空隙 → 进入目标，不穿过中间的带
    const rise = (k - (coreLanes - 1) / 2) * BAND.coreRise
    const gapY = (id: string, side: 'top' | 'bottom') => {
      const i = bandOfNode.get(id)!
      return (side === 'bottom' ? gaps.below(i) : gaps.above(i)) + rise
    }
    const x = coreX(k)
    const y1 = gapY(e.from, p1.side === 'bottom' ? 'bottom' : 'top')
    const y2 = gapY(e.to, p2.side === 'bottom' ? 'bottom' : 'top')
    coreEdges.set(e.id, {
      points: [
        { x: p1.x, y: p1.y },
        { x: p1.x, y: y1 },
        { x, y: y1 },
        { x, y: y2 },
        { x: p2.x, y: y2 },
        { x: p2.x, y: p2.y },
      ],
      label: { x, y: (y1 + y2) / 2 },
    })
  }

  return { view, nodes, edges, coreEdges, parentFrame, ...(frame ? { frame } : {}) }
}

const setRoute = (m: Map<string, EdgeRoute>, e: ViewEdge, r: EdgeRoute | undefined) => {
  if (r) m.set(e.id, r)
}

/** 带间空隙的中线：第一条带之上、最后一条带之下取框内留白的中线 */
function gapLines(bandBoxes: readonly Box[]) {
  return {
    above: (i: number) => (i > 0 ? (bandBoxes[i - 1].y + bandBoxes[i - 1].h + bandBoxes[i].y) / 2 : bandBoxes[i].y - BAND.framePad / 2),
    below: (i: number) => {
      const b = bandBoxes[i]
      return i < bandBoxes.length - 1 ? (b.y + b.h + bandBoxes[i + 1].y) / 2 : b.y + b.h + BAND.framePad / 2
    },
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

/** 节点顶边或底边上的一个端点：`otherX` 为对端的横向位置，走侧边通道或连到右侧参与者的记作最右（Infinity） */
interface SideEnd {
  id: string
  node: string
  side: 'top' | 'bottom'
  end: 'in' | 'out'
  otherX: number
}

/**
 * O3b：节点顶边 / 底边的端口分配，键为 `<边 ID>:<in|out>`，值为端口的 x。同一侧左半进、右半出，各半内居中、按对端横向位置从左到右、
 * PARALLEL_GAP 错开（放不下时收窄）。
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
    const sorted = [...group].sort((p, q) => p.otherX - q.otherX || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0))
    const half = box.w / 2
    const center = group[0].end === 'in' ? box.x + half / 2 : box.x + half + half / 2
    const step = Math.min(PARALLEL_GAP, (half - 16) / Math.max(1, sorted.length - 1))
    sorted.forEach((x, i) => out.set(`${x.id}:${x.end}`, center + (i - (sorted.length - 1) / 2) * step))
  }
  return out
}

/** 带右边上的一个端点：`lane` 为通道车道的 x，参与者的边记作最外一道（Infinity） */
interface BandEnd {
  id: string
  band: string
  end: 'in' | 'out'
  other: Box | undefined
  lane: number
}

/**
 * O3a：带右边的端口统一分配，键为 `<边 ID>:<in|out>`，值为端口的 y。上半进、下半出，各半内居中、按 PARALLEL_GAP 错开（放不下时收窄）；
 * 半内先排对端在上方的（车道由内到外自上而下）、再排对端在下方的（由外到内），横段不压过同侧别的竖段。
 */
function bandRightPorts(nodes: ReadonlyMap<string, Box>, ends: readonly BandEnd[]): Map<string, number> {
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
 * 分层总览中框外元素的边：端口按方位（用户底边、外部系统左边、边界节点顶边）；带按对端方位取顶边 / 右边 / 底边；
 * 核心模块进边在顶边、出边在底边，短桩一直走到带间空隙的中线（第一条带之上、最后一条带之下取框内留白的中线）。
 */
function outsideRouter(
  view: LevelView,
  nodes: Map<string, Box>,
  bands: readonly { layerId: string; coreModuleIds: string[] }[],
  { above, below }: ReturnType<typeof gapLines>,
) {
  const bandBoxes = bands.map(b => nodes.get(b.layerId)!)
  const bandOf = new Map<string, number>()
  bands.forEach((b, i) => {
    bandOf.set(b.layerId, i)
    b.coreModuleIds.forEach(id => bandOf.set(id, i))
    bandOf.set(moreChipId(b.layerId), i)
  })
  const byId = new Map(view.nodes.map(n => [n.id, n]))
  const obstacles = [...bandBoxes, ...view.nodes.filter(n => compassOf(n) !== 'inner').flatMap(n => (nodes.get(n.id) ? [nodes.get(n.id)!] : []))]
  return (e: ViewEdge, group: readonly ViewEdge[], rightY: ReadonlyMap<string, number>, sideX?: ReadonlyMap<string, number>): EdgeRoute | undefined => {
    const port = (id: string, other: string, end: 'in' | 'out'): PortAt | undefined => {
      const box = nodes.get(id)
      const n = byId.get(id)
      if (!box) return undefined
      // L11：关系边一律在该侧的前半错开，后半留给端口记号（L13）
      const dyn = true
      const slot = slotOf(group, id, e.id)
      const c = n ? compassOf(n) : 'inner'
      if (c !== 'inner') return portFor(box, c, end, 'DOWN', slot, undefined, dyn)
      const i = bandOf.get(id)
      if (i === undefined) return portFor(box, 'inner', end, 'DOWN', slot, undefined, dyn)
      const isBand = bands[i].layerId === id
      const oc = byId.get(other) ? compassOf(byId.get(other)!) : 'inner'
      // 带：朝向对端所在的方位，右边上半进、下半出（O3a）；核心模块：上进下出
      if (isBand && oc === 'right') {
        const p = portFor(box, 'inner', 'out', 'RIGHT', slot, undefined, dyn)
        return { ...p, y: rightY.get(`${e.id}:${end}`) ?? p.y }
      }
      const goesUp = isBand ? oc === 'top' : end === 'in'
      const p = portFor(box, 'inner', goesUp ? 'in' : 'out', 'DOWN', slot, undefined, dyn)
      // O3b：核心跨层边一组里，端口位置与核心模块之间的边一起分配
      return { ...p, x: sideX?.get(`${e.id}:${end}`) ?? p.x, stub: goesUp ? box.y - above(i) : below(i) - (box.y + box.h) }
    }
    const from = port(e.from, e.to, 'out')
    const toPort = port(e.to, e.from, 'in')
    const to = toPort && withSourceLane(toPort, slotOf(group, e.from, e.id))
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
