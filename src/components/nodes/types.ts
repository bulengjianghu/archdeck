import type { ModuleEntity } from '@/model'

/** 画布节点的公共数据 */
export interface NodeData {
  moduleId: string
  name: string
  module?: ModuleEntity
  childCount: number
  selected: boolean
  /** 有焦点（悬停/选中）时，与焦点无关的节点变淡 */
  dim: boolean
  /** 边界节点：外部模块所在路径 */
  path?: string
  /** 带（层）专用 */
  band?: { abstraction?: string; mayDependOn: string[]; hiddenCount: number }
  /** +N 占位块 */
  hiddenCount?: number
}
