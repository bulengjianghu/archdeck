/**
 * 草图布局（state.layout.sketch，X15、X19、X21，ADR-0025）：草图画布要画的节点与边——不走 elk、不走分层投影。
 * 位置取草图的 layout；没有 layout 时用一次初始布局（gridLayout：本层居中网格，入边引用在左、出边在右，只用于显示、不写回，「需初始布局」），
 * 只缺几个位置的（新建、推出的模块）放到不与已有节点重叠的空位。
 * 引用节点按「与挂载点同深度的祖先」折叠（05 裁决 4）：同一对（本层模块、折叠节点）同方向的多条关系合成一条显示边并标条数。
 * 根草图（X21）：层画成横向带（按 order），第二级模块在所属带内，x 取 layout、y 由带算。
 * 边是两端中心之间的直线，同一对节点的多条线平移错开；标签位置取 layout.relations，没写时在中点。纯函数，草图画布只把结果写入 Vue Flow。
 */
import {
  foldReference,
  gridLayout,
  locateAll,
  referenceNodes,
  referenceRelations,
  ROOT_BAND_GAP,
  ROOT_BAND_X0,
  ROOT_MOUNT,
  SKETCH_SOFT_LIMIT,
  type ChangeKind,
  type ModuleDef,
  type SketchDef,
  type SketchPoint,
} from '@/model'

export const SKETCH_NODE = { w: 168, h: 56 } as const
/** X21：层带的高度、带间距与带头宽度 */
export const SKETCH_BAND = { h: 112, gap: 14, head: 200, minW: 1100 } as const
/** 兼容：层在非带布局下的尺寸 */
export const SKETCH_LAYER = { w: 168, h: 56 } as const
/** 同一对节点的多条线之间的间距 */
export const SKETCH_PARALLEL_GAP = 16
const ORIGIN = 40

export type SketchNodeKind = 'module' | 'reference' | 'layer'

export interface SketchNodeData {
  id: string
  kind: SketchNodeKind
  name: string
  core?: boolean
  /** 有下一层（设计里有挂在它身上的草图，或基线里有子模块）：双击下钻有内容 */
  deeper?: boolean
  /** 图上标出变更时的角标 */
  change?: ChangeKind
  selected?: boolean
  /** 引用节点：折叠进来的关系条数（精确端点仍在数据里） */
  relations?: number
  /** 引用节点：折叠进来的精确端点（不止它自己时） */
  members?: string[]
  /** 层带（X21）：抽象原则、带内模块数、超七 */
  abstraction?: string
  count?: number
  over?: boolean
  w: number
  h: number
}

export interface SketchNode {
  id: string
  position: SketchPoint
  data: SketchNodeData
}

export interface SketchEdgeData {
  /** 显示边对应的关系（聚合边为第一条） */
  relationId: string
  /** 聚合边（05 裁决 4）：合进来的全部关系；单条关系时不给 */
  relationIds?: string[]
  /** 聚合边的引用端（显示 ID） */
  reference?: string
  type: string
  description?: string
  /** 平移量（px，垂直于连线）：同一对节点的第 i 条 */
  offset: number
  /** 标签位置：人拖过的为 layout 里的位置，否则 null（在中点） */
  label: SketchPoint | null
  /** 端点之一已不在本层（待重连，X16） */
  pending?: boolean
  change?: ChangeKind
  selected?: boolean
}

export interface SketchEdge {
  id: string
  source: string
  target: string
  data: SketchEdgeData
}

export interface SketchSceneInput {
  def: SketchDef
  /** 引用节点的名称（取自当前版本或设计的其他草图） */
  nameOf: (id: string) => string | undefined
  /** 模块是否有下一层 */
  deeper?: (id: string) => boolean
  /** 变更角标（图上标出变更时给出） */
  changes?: ReadonlyMap<string, ChangeKind> | null
  selected?: ReadonlySet<string>
  /** 待重连的关系 */
  pending?: readonly string[]
}

/** X21：根草图的一条层带 */
export interface SketchBand {
  id: string
  y: number
  h: number
}

export interface SketchScene {
  nodes: SketchNode[]
  edges: SketchEdge[]
  /** X21：根草图的层带（按 order，自上而下）；非根草图为空 */
  bands: SketchBand[]
  /** 草图没有 layout：显示的是一次初始布局，不写回（X15） */
  needsLayout: boolean
  /** 本层模块数（根草图为第二级模块数之和不计层） */
  count: number
}

/** 聚合边的 ID（05 裁决 4） */
export const aggregateEdgeId = (source: string, target: string): string => `agg:${source}>${target}`

/** X21：根草图的层，按 order（没写的按出现顺序排在后面） */
export function rootLayers(def: SketchDef): ModuleDef[] {
  const layers = (def.modules ?? []).map((m, i) => ({ m, i }))
  return layers.sort((a, b) => (a.m.order ?? 1e6 + a.i) - (b.m.order ?? 1e6 + b.i)).map(x => x.m)
}

/** X21：根草图的层带几何与带内模块位置（x 取 layout，缺的往右找空位；y 由带算） */
function bandLayout(def: SketchDef): { bands: SketchBand[]; pos: Record<string, SketchPoint>; width: number } {
  const given = def.layout?.modules ?? {}
  const pos: Record<string, SketchPoint> = {}
  const bands: SketchBand[] = []
  let right: number = SKETCH_BAND.minW
  rootLayers(def).forEach((layer, i) => {
    const y = ORIGIN + i * (SKETCH_BAND.h + SKETCH_BAND.gap)
    bands.push({ id: layer.id, y, h: SKETCH_BAND.h })
    const top = y + (SKETCH_BAND.h - SKETCH_NODE.h) / 2
    const taken: number[] = []
    const kids = layer.children ?? []
    for (const k of kids)
      if (given[k.id]) {
        pos[k.id] = { x: given[k.id].x, y: top }
        taken.push(given[k.id].x)
      }
    let next = ROOT_BAND_X0
    for (const k of kids) {
      if (pos[k.id]) continue
      while (taken.some(x => Math.abs(x - next) < SKETCH_NODE.w + 8)) next += ROOT_BAND_GAP
      pos[k.id] = { x: next, y: top }
      taken.push(next)
    }
    for (const x of taken) right = Math.max(right, x + SKETCH_NODE.w + 60)
  })
  return { bands, pos, width: right }
}

/** 显示用的位置：layout 里有的照用；缺的放到初始布局的位置，与已有节点重叠时往下找空位。折叠的引用节点没记位置时取它某个精确端点记下的位置 */
export function sketchPositions(def: SketchDef, ids: readonly string[]): Record<string, SketchPoint> {
  if (def.mount === ROOT_MOUNT) return bandLayout(def).pos
  const grid = gridLayout(def).modules ?? {}
  const given = def.layout?.modules ?? {}
  const out: Record<string, SketchPoint> = {}
  const taken: SketchPoint[] = []
  const known = (id: string): SketchPoint | undefined => {
    const p = given[id]
    if (p && p.y !== undefined) return { x: p.x, y: p.y }
    for (const [k, q] of Object.entries(given)) if (k !== id && q.y !== undefined && foldReference(def.mount, k) === id) return { x: q.x, y: q.y }
    return undefined
  }
  for (const id of ids) {
    const p = known(id)
    if (p) {
      out[id] = p
      taken.push(p)
    }
  }
  const clash = (p: SketchPoint) => taken.some(q => Math.abs(q.x - p.x) < SKETCH_NODE.w && Math.abs(q.y - p.y) < SKETCH_NODE.h + 8)
  for (const id of ids) {
    if (out[id]) continue
    const g = grid[id]
    let p: SketchPoint = g && g.y !== undefined ? { x: g.x, y: g.y } : { x: ORIGIN, y: ORIGIN }
    for (let i = 0; i < 200 && clash(p); i++) p = { x: p.x, y: p.y + SKETCH_NODE.h + 24 }
    out[id] = p
    taken.push(p)
  }
  return out
}

export function sketchScene(input: SketchSceneInput): SketchScene {
  const { def } = input
  const root = def.mount === ROOT_MOUNT
  const own = locateAll(def)
  const ownIds = new Set(own.map(m => m.id))
  const refs = root ? [] : referenceNodes(def)
  const ids = [...own.filter(m => !(root && m.parentId === undefined)).map(m => m.id), ...refs]
  const band = root ? bandLayout(def) : null
  const pos = band ? band.pos : sketchPositions(def, ids)
  const sel = input.selected ?? new Set<string>()
  const layers: SketchNode[] = (band?.bands ?? []).map(b => {
    const layer = own.find(m => m.id === b.id)!.node
    const count = (layer.children ?? []).length
    return {
      id: b.id,
      position: { x: 0, y: b.y },
      data: {
        id: b.id,
        kind: 'layer' as const,
        name: layer.name || b.id,
        ...(layer.abstraction ? { abstraction: layer.abstraction } : {}),
        count,
        ...(count > SKETCH_SOFT_LIMIT ? { over: true } : {}),
        ...(input.changes?.get(b.id) ? { change: input.changes.get(b.id) } : {}),
        ...(sel.has(b.id) ? { selected: true } : {}),
        w: band!.width,
        h: b.h,
      },
    }
  })
  const modules: SketchNode[] = own
    .filter(m => !(root && m.parentId === undefined))
    .map(m => ({
      id: m.id,
      position: pos[m.id],
      data: {
        id: m.id,
        kind: 'module' as const,
        name: m.node.name || m.id,
        ...(m.node.core ? { core: true } : {}),
        ...(input.deeper?.(m.id) ? { deeper: true } : {}),
        ...(input.changes?.get(m.id) ? { change: input.changes.get(m.id) } : {}),
        ...(sel.has(m.id) ? { selected: true } : {}),
        w: SKETCH_NODE.w,
        h: SKETCH_NODE.h,
      },
    }))
  const references: SketchNode[] = refs.map(id => {
    const rels = referenceRelations(def, id)
    const members = [...new Set(rels.map(r => (ownIds.has(r.from) ? r.to : r.from)))]
    return {
      id,
      position: pos[id],
      data: {
        id,
        kind: 'reference' as const,
        name: input.nameOf(id) ?? id,
        ...(rels.length ? { relations: rels.length } : {}),
        ...(members.some(x => x !== id) ? { members } : {}),
        ...(sel.has(id) ? { selected: true } : {}),
        w: SKETCH_NODE.w,
        h: SKETCH_NODE.h,
      },
    }
  })
  const nodes = [...layers, ...modules, ...references]

  // 边：本层之间的关系一条一条画；一端是引用的按（显示起点、显示终点）聚合
  const shown = new Set(nodes.map(n => n.id))
  const display = (id: string) => (ownIds.has(id) ? id : foldReference(def.mount, id))
  const pending = new Set(input.pending ?? [])
  type Group = { source: string; target: string; rels: NonNullable<SketchDef['relations']> }
  const groups: Group[] = []
  const agg = new Map<string, Group>()
  for (const r of def.relations ?? []) {
    const [a, b] = [display(r.from), display(r.to)]
    if (!shown.has(a) || !shown.has(b) || a === b) continue
    const external = !ownIds.has(r.from) || !ownIds.has(r.to)
    if (!external) {
      groups.push({ source: a, target: b, rels: [r] })
      continue
    }
    const key = `${a}\0${b}`
    const hit = agg.get(key)
    if (hit) hit.rels.push(r)
    else {
      const g = { source: a, target: b, rels: [r] }
      agg.set(key, g)
      groups.push(g)
    }
  }
  const pairKey = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`)
  const edgeId = (g: Group) => (g.rels.length === 1 ? g.rels[0].id : aggregateEdgeId(g.source, g.target))
  const pairs = new Map<string, string[]>()
  for (const g of groups) pairs.set(pairKey(g.source, g.target), [...(pairs.get(pairKey(g.source, g.target)) ?? []), edgeId(g)])
  const edges: SketchEdge[] = groups.map(g => {
    const id = edgeId(g)
    const group = pairs.get(pairKey(g.source, g.target))!
    const i = group.indexOf(id)
    // 方向统一按字典序较小的一端为起点算平移，反向的线取负号，同一对的线才真正错开
    const sign = g.source < g.target ? 1 : -1
    const offset = (i - (group.length - 1) / 2) * SKETCH_PARALLEL_GAP * sign
    const r = g.rels[0]
    const many = g.rels.length > 1
    const types = [...new Set(g.rels.map(x => x.type))]
    const change = g.rels.map(x => input.changes?.get(x.id)).find(Boolean)
    return {
      id,
      source: g.source,
      target: g.target,
      data: {
        relationId: r.id,
        ...(many ? { relationIds: g.rels.map(x => x.id), reference: ownIds.has(g.source) ? g.target : g.source } : {}),
        type: types.length === 1 ? types[0] : 'mixed',
        ...(!many && r.description ? { description: r.description } : {}),
        offset,
        label: many ? null : (def.layout?.relations?.[r.id]?.label ?? null),
        ...(g.rels.some(x => pending.has(x.id)) ? { pending: true } : {}),
        ...(change ? { change } : {}),
        ...(sel.has(id) || (!many && sel.has(r.id)) ? { selected: true } : {}),
      },
    }
  })
  const count = root ? own.filter(m => m.parentId !== undefined).length : own.length
  return { nodes, edges, bands: band?.bands ?? [], needsLayout: !def.layout?.modules, count }
}

/** X21：根草图里一个点落在哪条层带（不在任何带上为 null） */
export function bandAt(bands: readonly SketchBand[], y: number): string | null {
  return bands.find(b => y >= b.y && y <= b.y + b.h)?.id ?? null
}

/** 直线边的几何：两中心连线平移 offset 后，裁到两端节点的边框；返回起点、终点与中点 */
export function straightEdge(
  a: SketchPoint,
  b: SketchPoint,
  sizeA: { w: number; h: number },
  sizeB: { w: number; h: number },
  offset = 0,
): { from: SketchPoint; to: SketchPoint; mid: SketchPoint } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const a2 = { x: a.x + nx * offset, y: a.y + ny * offset }
  const b2 = { x: b.x + nx * offset, y: b.y + ny * offset }
  /** 从中心 c 沿方向 (ux, uy) 到半宽 hw、半高 hh 的矩形边框的距离 */
  const reach = (hw: number, hh: number, ux: number, uy: number) => Math.min(ux ? hw / Math.abs(ux) : Infinity, uy ? hh / Math.abs(uy) : Infinity)
  const ux = dx / len
  const uy = dy / len
  const ra = Math.min(reach(sizeA.w / 2, sizeA.h / 2, ux, uy), len / 2)
  const rb = Math.min(reach(sizeB.w / 2, sizeB.h / 2, ux, uy), len / 2)
  const from = { x: a2.x + ux * ra, y: a2.y + uy * ra }
  const to = { x: b2.x - ux * rb, y: b2.y - uy * rb }
  return { from, to, mid: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } }
}
