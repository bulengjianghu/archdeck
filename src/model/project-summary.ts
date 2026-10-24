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
  /** Q13：共用件的两条提醒（ADR-0027） */
  shared?: SharedHealth
}

/** Q13：共用件反向依赖条数（U12）与共用件体量——行数占比（G19）、近窗口修改次数占比（J2）；超阈值时 over */
export interface SharedHealth {
  /** 共用件个数（role: shared / bus，不含共用件内的子模块） */
  modules: number
  reverse: number
  /** 共用件子树行数 / 已归属行数；没有行数时为 null */
  lineRatio: number | null
  /** 近 J1 窗口内触及共用件的提交 / 全部提交；没有 git 历史时为 null */
  changeRatio: number | null
  /** 阈值：行数占比（sourceLimits.sharedRatio，缺省 0.2）与修改占比（0.3） */
  limits: { lines: number; changes: number }
  /** 体量异常增长：任一占比超过阈值 */
  over: boolean
  /** Q15：扇入 Ca（K16）最大的共用件、它的 Ca 与 Ca 占系统模块数（不含系统根）的比例；没有代码事实或共用件都无人依赖时不给 */
  topFanIn?: { module: string; ca: number; ratio: number }
}
