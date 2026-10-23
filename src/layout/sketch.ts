/**
 * 草图布局（state.layout.sketch，X15、X19，ADR-0025）：草图画布要画的节点与边——不走 elk、不走分层投影。
 * 位置取草图的 layout；没有 layout 时用一次网格布局（gridLayout，只用于显示、不写回，「需初始布局」），
 * 只缺几个位置的（新建、推出的模块）放到网格里不与已有节点重叠的空位。边是两端中心之间的直线，同一对节点的多条线平移错开；
 * 标签位置取 layout.relations，没写时在中点。纯函数，草图画布只把结果写入 Vue Flow。
 */
import { gridLayout, locateAll, referenceNodes, ROOT_MOUNT, type ChangeKind, type SketchDef, type SketchPoint } from '@/model'

export const SKETCH_NODE = { w: 168, h: 56 } as const
export const SKETCH_LAYER = { w: 168, h: 56 } as const
/** 同一对节点的多条线之间的间距 */
export const SKETCH_PARALLEL_GAP = 16

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
  w: number
  h: number
}

export interface SketchNode {
  id: string
  position: SketchPoint
  data: SketchNodeData
}

export interface SketchEdgeData {
  relationId: string
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

export interface SketchScene {
  nodes: SketchNode[]
  edges: SketchEdge[]
  /** 草图没有 layout：显示的是一次网格布局，不写回（X15） */
  needsLayout: boolean
  /** 本层模块数（根草图为第二级模块数之和不计层） */
  count: number
}

/** 显示用的位置：layout 里有的照用；缺的放到网格位置，与已有节点重叠时往下找空位 */
export function sketchPositions(def: SketchDef, ids: readonly string[]): Record<string, SketchPoint> {
  const grid = gridLayout(def).modules ?? {}
  const given = def.layout?.modules ?? {}
  const out: Record<string, SketchPoint> = {}
  const taken: SketchPoint[] = []
  for (const id of ids)
    if (given[id]) {
      out[id] = given[id]
      taken.push(given[id])
    }
  const clash = (p: SketchPoint) => taken.some(q => Math.abs(q.x - p.x) < SKETCH_NODE.w && Math.abs(q.y - p.y) < SKETCH_NODE.h + 8)
  for (const id of ids) {
    if (out[id]) continue
    let p = grid[id] ?? { x: 40, y: 40 }
    for (let i = 0; i < 200 && clash(p); i++) p = { x: p.x, y: p.y + SKETCH_NODE.h + 24 }
    out[id] = p
    taken.push(p)
  }
  return out
}

export function sketchScene(input: SketchSceneInput): SketchScene {
  const { def } = input
  const own = locateAll(def)
  const refs = referenceNodes(def)
  const ids = [...own.map(m => m.id), ...refs]
  const pos = sketchPositions(def, ids)
  const sel = input.selected ?? new Set<string>()
  const nodes: SketchNode[] = [
    ...own.map(m => {
      const layer = def.mount === ROOT_MOUNT && m.parentId === undefined && m.node.kind === 'layer'
      const size = layer ? SKETCH_LAYER : SKETCH_NODE
      return {
        id: m.id,
        position: pos[m.id],
        data: {
          id: m.id,
          kind: (layer ? 'layer' : 'module') as SketchNodeKind,
          name: m.node.name || m.id,
          ...(m.node.core ? { core: true } : {}),
          ...(!layer && input.deeper?.(m.id) ? { deeper: true } : {}),
          ...(input.changes?.get(m.id) ? { change: input.changes.get(m.id) } : {}),
          ...(sel.has(m.id) ? { selected: true } : {}),
          w: size.w,
          h: size.h,
        },
      }
    }),
    ...refs.map(id => ({
      id,
      position: pos[id],
      data: { id, kind: 'reference' as const, name: input.nameOf(id) ?? id, ...(sel.has(id) ? { selected: true } : {}), w: SKETCH_NODE.w, h: SKETCH_NODE.h },
    })),
  ]
  const shown = new Set(ids)
  const rels = (def.relations ?? []).filter(r => shown.has(r.from) && shown.has(r.to))
  const pairKey = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`)
  const pairs = new Map<string, string[]>()
  for (const r of rels) pairs.set(pairKey(r.from, r.to), [...(pairs.get(pairKey(r.from, r.to)) ?? []), r.id])
  const pending = new Set(input.pending ?? [])
  const edges: SketchEdge[] = rels.map(r => {
    const group = pairs.get(pairKey(r.from, r.to))!
    const i = group.indexOf(r.id)
    // 方向统一按字典序较小的一端为起点算平移，反向的线取负号，同一对的线才真正错开
    const sign = r.from < r.to ? 1 : -1
    const offset = (i - (group.length - 1) / 2) * SKETCH_PARALLEL_GAP * sign
    return {
      id: r.id,
      source: r.from,
      target: r.to,
      data: {
        relationId: r.id,
        type: r.type,
        ...(r.description ? { description: r.description } : {}),
        offset,
        label: def.layout?.relations?.[r.id]?.label ?? null,
        ...(pending.has(r.id) ? { pending: true } : {}),
        ...(input.changes?.get(r.id) ? { change: input.changes.get(r.id) } : {}),
        ...(sel.has(r.id) ? { selected: true } : {}),
      },
    }
  })
  const count = def.mount === ROOT_MOUNT ? own.filter(m => m.parentId !== undefined).length : own.length
  return { nodes, edges, needsLayout: !def.layout?.modules, count }
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
