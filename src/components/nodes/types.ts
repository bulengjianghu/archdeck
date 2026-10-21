import type { ActorEntity, ActorKind, ModuleEntity } from '@/model'

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
  /** 设计版本：本模块相对对比基线新增或修改 */
  change?: 'added' | 'changed'
  /** 修改了哪些字段（显示用） */
  changedFields?: string
  /** 设计版本：涉及其子树或相关关系的变更条数 */
  touched?: number
  /** 外部参与者节点 */
  actor?: ActorEntity
  actorKind?: ActorKind
  /** 运行视角：步骤序号（结构图上的序号标记） */
  steps?: { n: number; frameId: string; current: boolean; muted?: boolean }[]
  /** 运行视角：分支点某个选项的预览 */
  preview?: { pointId: string; option: number; label: string }
}
