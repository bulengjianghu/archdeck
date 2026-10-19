/**
 * Layout：给 LevelView 算坐标与边的走线。
 * - graph：elkjs layered 算法，自上而下，正交走线；
 * - layered：按层序分带，规则排布，不调用 elk（需求 §3.6）。
 * 结果按视图内容缓存，同样的输入得到同样的输出。
 */
import type { ELK, ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api'
import type { LevelView, ViewEdge, ViewNode } from '@/model'

export interface Point {
  x: number
  y: number
}

export interface Box extends Point {
  w: number
  h: number
}

export interface EdgeRoute {
  points: Point[]
  /** 曲线（核心模块跨层边）还是折线 */
  curve?: boolean
  label?: Point
}

export interface PositionedView {
  view: LevelView
  nodes: Map<string, Box>
  edges: Map<string, EdgeRoute>
  /** layered：核心跨层边的走线 */
  coreEdges: Map<string, EdgeRoute>
}

export const NODE_SIZE = { module: { w: 208, h: 76 }, boundary: { w: 176, h: 48 } }
export const BAND = {
  left: 236,
  right: 168,
  minMiddle: 520,
  chip: { w: 168, h: 46 },
  chipGap: 14,
  padY: 18,
  minH: 104,
  gap: 64,
  lane: 22,
}

// ── 分层总览 ─────────────────────────────────────────────────

/** 带内「+N 个其他模块」占位块的 ID */
export function moreChipId(layerId: string): string {
  return `more:${layerId}`
}

export function layoutLayered(view: LevelView): PositionedView {
  const bands = view.bands ?? []
  const nodes = new Map<string, Box>()
  const maxCore = Math.max(1, ...bands.map(b => b.coreModuleIds.length + (b.hiddenCount > 0 ? 1 : 0)))
  const perRow = Math.max(3, Math.min(maxCore, 5))
  const middle = Math.max(BAND.minMiddle, perRow * (BAND.chip.w + BAND.chipGap) - BAND.chipGap + 2 * BAND.chipGap)
  const width = BAND.left + middle + BAND.right

  let y = 0
  const bandIndex = new Map<string, number>()
  bands.forEach((band, i) => {
    bandIndex.set(band.layerId, i)
    const slots = band.coreModuleIds.length + (band.hiddenCount > 0 ? 1 : 0)
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
    if (band.hiddenCount > 0) nodes.set(moreChipId(band.layerId), chipBox(band.coreModuleIds.length))
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
      edges.set(e.id, { points: [{ x, y: y1 }, { x, y: y2 }], label: { x, y: (y1 + y2) / 2 } })
    } else {
      const x = width + 28 + lane * BAND.lane
      lane++
      const y1 = a.y + a.h / 2 + (lane % 3) * 8 - 8
      const y2 = b.y + b.h / 2 + (lane % 3) * 8 - 8
      edges.set(e.id, {
        points: [{ x: a.x + a.w, y: y1 }, { x, y: y1 }, { x, y: y2 }, { x: b.x + b.w, y: y2 }],
        label: { x, y: (y1 + y2) / 2 },
      })
    }
  }

  const coreEdges = new Map<string, EdgeRoute>()
  for (const e of view.coreEdges ?? []) {
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    if (!a || !b) continue
    const down = a.y < b.y
    const p1 = { x: a.x + a.w / 2, y: down ? a.y + a.h : a.y }
    const p2 = { x: b.x + b.w / 2, y: down ? b.y : b.y + b.h }
    coreEdges.set(e.id, { points: [p1, p2], curve: true, label: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } })
  }

  return { view, nodes, edges, coreEdges }
}

/** 节点与走线的总外框，用于适应画布 */
export function contentBounds(pv: PositionedView): Box | null {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  const add = (x: number, y: number) => {
    x1 = Math.min(x1, x)
    y1 = Math.min(y1, y)
    x2 = Math.max(x2, x)
    y2 = Math.max(y2, y)
  }
  for (const b of pv.nodes.values()) {
    add(b.x, b.y)
    add(b.x + b.w, b.y + b.h)
  }
  for (const r of pv.edges.values()) for (const p of r.points) add(p.x, p.y)
  if (x1 === Infinity) return null
  return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) }
}

// ── 普通层次 ─────────────────────────────────────────────────

export function sizeOf(n: ViewNode): { w: number; h: number } {
  return n.role === 'boundary' ? NODE_SIZE.boundary : NODE_SIZE.module
}

export function edgeLabel(e: ViewEdge): string {
  return e.relationIds.length > 1 ? `${e.type} ×${e.relationIds.length}` : e.type
}

export function toElkGraph(view: LevelView): ElkNode {
  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '72',
      'elk.spacing.nodeNode': '44',
      'elk.spacing.edgeNode': '24',
      'elk.spacing.edgeEdge': '14',
      'elk.layered.spacing.edgeNodeBetweenLayers': '24',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.edgeLabels.inline': 'true',
    },
    children: view.nodes.map(n => ({ id: n.id, width: sizeOf(n).w, height: sizeOf(n).h })),
    edges: view.edges.map<ElkExtendedEdge>(e => {
      const text = edgeLabel(e)
      return {
        id: e.id,
        sources: [e.from],
        targets: [e.to],
        labels: [{ id: `${e.id}#label`, text, width: text.length * 7 + 14, height: 18 }],
      }
    }),
  }
}

export function fromElkGraph(view: LevelView, graph: ElkNode): PositionedView {
  const nodes = new Map<string, Box>()
  for (const c of graph.children ?? []) nodes.set(c.id, { x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? 0, h: c.height ?? 0 })
  const edges = new Map<string, EdgeRoute>()
  for (const e of (graph.edges ?? []) as ElkExtendedEdge[]) {
    const s = e.sections?.[0]
    if (!s) continue
    const lbl = e.labels?.[0]
    edges.set(e.id, {
      points: [s.startPoint, ...(s.bendPoints ?? []), s.endPoint],
      label: lbl && lbl.x !== undefined ? { x: lbl.x + (lbl.width ?? 0) / 2, y: (lbl.y ?? 0) + (lbl.height ?? 0) / 2 } : undefined,
    })
  }
  return { view, nodes, edges, coreEdges: new Map() }
}

let elkPromise: Promise<ELK> | undefined

/** 浏览器里用 Worker 跑 elk，测试等无 Worker 环境用同步打包版 */
function getElk(): Promise<ELK> {
  elkPromise ??= (async () => {
    if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
      const [{ default: ElkApi }, { default: ElkWorker }] = await Promise.all([
        import('elkjs/lib/elk-api.js'),
        import('elkjs/lib/elk-worker.min.js?worker'),
      ])
      return new ElkApi({ workerFactory: () => new ElkWorker() })
    }
    const { default: ElkBundled } = await import('elkjs/lib/elk.bundled.js')
    return new ElkBundled()
  })()
  return elkPromise
}

const cache = new Map<string, PositionedView>()
const CACHE_LIMIT = 64

export function cacheKey(view: LevelView): string {
  return JSON.stringify([view.mode, view.parentId, view.nodes.map(n => n.id), view.edges.map(e => [e.id, e.relationIds.length])])
}

export async function layoutView(view: LevelView): Promise<PositionedView> {
  const key = cacheKey(view)
  const hit = cache.get(key)
  if (hit) return { ...hit, view }
  let result: PositionedView
  if (view.mode === 'layered') result = layoutLayered(view)
  else if (view.nodes.length === 0) result = { view, nodes: new Map(), edges: new Map(), coreEdges: new Map() }
  else result = fromElkGraph(view, await (await getElk()).layout(toElkGraph(view)))
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  cache.set(key, result)
  return result
}
