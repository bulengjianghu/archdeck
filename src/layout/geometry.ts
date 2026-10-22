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
  /** 系统框：有边界节点或参与者时给出，包住父模块框与边界节点行；参与者在它之外（A7、L4） */
  frame?: Box
}

export const NODE_SIZE = { module: { w: 208, h: 76 }, boundary: { w: 176, h: 48 }, actor: { w: 160, h: 52 } }

export interface LayoutOptions {
  /** O7：分层总览的带内列数（bandColumnsFor 由画布宽度得出） */
  bandColumns?: number
}

export function sizeOf(n: ViewNode): { w: number; h: number } {
  return n.role === 'boundary' ? NODE_SIZE.boundary : n.role === 'actor' ? NODE_SIZE.actor : NODE_SIZE.module
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
