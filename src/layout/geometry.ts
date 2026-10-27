/**
 * Layout 的几何类型与共用量：坐标、盒子、走线、带坐标的视图，节点尺寸，内容外框。
 */
import type { LevelView, ViewNode } from '@/model'

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
  /** 曲线（分层总览的核心跨层边与参与者的边、回放临时线、代码依赖叠加线）还是折线；'h' 为从侧边出发的横向曲线 */
  curve?: boolean | 'h'
  label?: Point
}

export interface PositionedView {
  view: LevelView
  nodes: Map<string, Box>
  edges: Map<string, EdgeRoute>
  /** layered：核心跨层边的走线 */
  coreEdges: Map<string, EdgeRoute>
  /** 普通层次：elk 的布局方向，内部节点的入口 / 出口侧随之而定 */
  direction?: 'DOWN' | 'RIGHT'
  /** 普通层次：elk 排出的端口位置（`<边 ID>#in` / `#out`，含框外边在内部节点上的占位端口，L11） */
  ports?: Map<string, Point>
  /** 父模块框：包住当前层的内部结构（分层总览为全部带与右侧通道）；根层就是系统框 */
  parentFrame?: Box
  /** O9：普通层次的共用件架（父模块框底部的一行）；没有共用件时不给 */
  shelf?: Box
  /** 系统框：有边界节点或参与者时给出，包住父模块框与边界节点行；参与者在它之外（A7、L4） */
  frame?: Box
  /** C6、L20a②：展开表面的节点 → 端口点（名字与位置，按入边一侧的顺序；dots.ts 在收起态的节点上排出）；没有展开时不给 */
  elements?: Map<string, { name: string; x: number; y: number }[]>
  /** C6：展开节点端口封顶后没画成端口的元素数（「+N 个元素」） */
  elementsMore?: Map<string, number>
  /** C6：本布局里被散开为元素级边的束（ID）；没有展开时不给 */
  spread?: ReadonlySet<string>
}

export const NODE_SIZE = {
  module: { w: 208, h: 76 },
  /** ADR-0027：普通层次的核心模块大块常显 */
  core: { w: 248, h: 96 },
  /** O8：普通层次的「+N 个其他模块」占位 */
  more: { w: 208, h: 48 },
  boundary: { w: 176, h: 48 },
  actor: { w: 160, h: 52 },
}

/** O9：共用件架——架上的紧凑块、块间距、架左侧「共用件」字样的宽度、与上方内容的间距 */
export const SHELF = { w: 140, h: 30, gap: 8, label: 60, top: 18 }

/** O13③：核心模块的跨层依赖按对合成一条（束）的 ID */
export const chipBundleId = (from: string, to: string) => `chip:bundle:${from}->${to}`

/** D7：交互视图边按表面散开到一个元素的那一段的 ID */
export const spreadEdgeId = (edge: string, element: string) => `${edge}#to:${element}`

/** C6：散开的束里没接到元素端口的元素级边（端口封顶外的元素、越过入口、整模块）合成的一条，接到节点本体 */
export const restEdgeId = (bundle: string) => `${bundle}#rest`

/** C6：布局里的表面展开——节点 → 端口点的元素（按序）；接到端口点的边 → [节点, 元素] */
export interface LayoutExpansion {
  nodes: Map<string, readonly string[]>
  targets: Map<string, { node: string; element: string }>
  /** 端口封顶后没画成端口的元素数 */
  more?: Map<string, number>
  /** L20b：各展开节点的元素所属的子模块组（与 nodes 的元素对齐，本体为 null）；不分组时不给 */
  groups?: Map<string, readonly (number | null)[]>
  /** L20a②：各展开节点的元素按优先次序（入边一侧放不下时从末尾截掉）；不给时按 nodes 的次序 */
  ranked?: Map<string, readonly string[]>
}

export interface LayoutOptions {
  /** O7：分层总览的带内列数（bandColumnsFor 由画布宽度得出） */
  bandColumns?: number
}

export function sizeOf(n: ViewNode): { w: number; h: number } {
  if (n.role === 'boundary') return NODE_SIZE.boundary
  if (n.role === 'actor') return NODE_SIZE.actor
  if (n.role === 'shared') return { w: SHELF.w, h: SHELF.h }
  if (n.role === 'more') return NODE_SIZE.more
  return n.core ? NODE_SIZE.core : NODE_SIZE.module
}

export function contentBounds(pv: PositionedView, only?: ReadonlySet<string>): Box | null {
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
  for (const [id, b] of pv.nodes) {
    if (only && !only.has(id)) continue
    add(b.x, b.y)
    add(b.x + b.w, b.y + b.h)
  }
  if (!only) for (const r of pv.edges.values()) for (const p of r.points) add(p.x, p.y)
  // 框也要完整露出（标题在框线上方）
  if (!only)
    for (const f of [pv.frame, pv.parentFrame])
      if (f) {
        add(f.x, f.y - 12)
        add(f.x + f.w, f.y + f.h)
      }
  if (x1 === Infinity) return null
  return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) }
}
