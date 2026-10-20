/** 项目列表页展示的项目摘要（由接入层在 Node 侧算好，页面只展示） */
import type { SourceDef } from './types'
import type { DesignInfo } from './design'

export interface ProjectSummary {
  /** 项目 ID，即模型根目录下的子目录名 */
  id: string
  name: string
  description?: string
  source?: SourceDef
  /** 描述目录，相对项目根 */
  dir: string
  /** 根下是否按层组织 */
  layered: boolean
  /** 根下的顶层模块（分层时即各层） */
  top: { id: string; name: string; abstraction?: string }[]
  counts: { modules: number; relations: number; interfaces: number; dataStructures: number; actors: number; scenarios: number }
  errors: number
  warnings: number
  /** 设计版本（ADR-0002） */
  designs: DesignInfo[]
}
