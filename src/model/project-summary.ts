/** 项目列表页展示的项目摘要（由接入层在 Node 侧算好，页面只展示） */
import type { SourceDef } from './types'
import type { DesignInfo } from './design'
import type { ReviewCounts } from './review'

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
  /** 描述的错误与提醒（加载与校验，M、S、U1） */
  errors: number
  warnings: number
  /** 健康度（Q10）：卡片以它为主、规模为次 */
  health?: ProjectHealth
  /** 设计版本（ADR-0002） */
  designs: DesignInfo[]
}

/** 项目健康度（Q10）：源码归属与代码事实的摘要；读不到事实时只有 note */
export interface ProjectHealth {
  /** 读不到代码事实的原因（如提取失败）；有事实时不给 */
  note?: string
  /** 未归属文件数（G7）、归属冲突文件数（G6） */
  unowned?: number
  conflicts?: number
  /** 违规（U6、U8）：count 为计入门禁的条数（不含已豁免）；有基线时 delta = 新增 − 已消除，没有基线时为 null */
  violations?: { count: number; new: number; resolved: number; allowed: number; delta: number | null }
  /** 模块环（Y1–Y3，不含容忍的环）：个数、最大规模、环度与基线中的环度 */
  cycles?: { count: number; maxSize: number; cyclicity: number; baseline: number | null }
  /** 报警的未证实关系（K6）：编译期关系，以及两端之间没有任何依赖的运行时关系 */
  unconfirmed?: number
  /** 人确认层（Z5）：确认范围内的已确认与需复核；只读描述即可算出，读不到代码事实时也有 */
  reviewed?: ReviewCounts
}
