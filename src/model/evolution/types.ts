/**
 * 演化事实的数据类型（J1–J8，docs/architecture/evolution.md §3.1）：接入层产出的 git 历史，模型层产出的模块统计、时间耦合与本层投影。
 * 路径一律相对源码根目录、以 `/` 分隔。
 */

/** J1：一条提交涉及的一个源码清单内文件 */
export interface HistoryFile {
  path: string
  added: number
  deleted: number
}

/** J1：一条提交 */
export interface HistoryCommit {
  hash: string
  short: string
  /** YYYY-MM-DD */
  date: string
  subject: string
  /** 缺陷修复提交（按标题判定，J1） */
  fix: boolean
  files: HistoryFile[]
}

/** 接入层读到的 git 历史；读不到时为 error 并带原因（J1） */
export type SourceHistory =
  | { status: 'ok'; head: string; days: number; since: string; commits: HistoryCommit[] }
  | { status: 'error'; reason: string }

export type OkHistory = Extract<SourceHistory, { status: 'ok' }>

/** J1、J4：描述里的 `system.source.history` 规整后的选项 */
export interface HistoryOptions {
  days: number
  /** 补充的缺陷匹配正则（不分大小写），与缺省规则取并集 */
  fixPatterns: string[]
  coupling: CouplingThreshold
}

export interface CouplingThreshold {
  /** 同提交次数下限 */
  min: number
  /** 占两端各自修改次数的比例下限 */
  ratio: number
}

export const DEFAULT_HISTORY_DAYS = 180
export const DEFAULT_COUPLING: CouplingThreshold = { min: 5, ratio: 0.3 }

/** J2、J3：一个模块的统计 */
export interface ModuleHistory {
  id: string
  /** 有直接归属文件（不是纯容器，J8） */
  direct: boolean
  changes: number
  fixes: number
  /** 当前行数（模块文件的行数合计，G21） */
  lines: number
  heat: number
  fixHeat: number
  /** 触及的提交哈希，新的在前 */
  commits: string[]
}

/** J4：一对模块的时间耦合（a < b，按 ID 排序） */
export interface Coupling {
  /** `<a>~<b>` */
  id: string
  a: string
  b: string
  shared: number
  ratioA: number
  ratioB: number
  /** 两端子树之间有模块依赖（任一方向，K4） */
  dependency: boolean
  /** 两端子树之间有描述关系（任一方向，类型不限） */
  relation: boolean
  /** 共同的提交哈希，新的在前 */
  commits: string[]
}

export interface EvolutionStats {
  days: number
  since: string
  /** 窗口内触及源码清单的提交数与其中的缺陷修复数 */
  commits: number
  fixes: number
  modules: Map<string, ModuleHistory>
  /** 全部达到阈值的耦合对（含上级的对，本层投影用） */
  couplings: Coupling[]
  /** 最具体的耦合对的 ID：两端子树内已有更深的耦合对时，祖先对是同一现象的并集，清单不列（J4） */
  specific: Set<string>
}

export type HeatKind = 'changes' | 'fixes'
export const HEAT_KINDS: readonly HeatKind[] = ['changes', 'fixes']
export type HeatTier = 1 | 2 | 3

/** J3：一个视图节点的热度角标 */
export interface NodeHeat {
  tier: HeatTier
  value: number
  /** 修改次数或缺陷次数（随种类） */
  count: number
}

/** J4、J5：本层的一条耦合线 */
export interface LevelCoupling {
  /** `couple:<a>~<b>`，a、b 为视图节点 ID */
  id: string
  from: string
  to: string
  fromModule: string
  toModule: string
  shared: number
  /** 投到这对节点的耦合对都没有依赖也没有关系：代码事实看不见的耦合 */
  isolated: boolean
  /** 投到这对节点的耦合对 ID（按次数降序） */
  pairs: string[]
  /** 单击耦合线选中的那一对：两端恰为这对节点的模块时取它，否则取次数最多的一对（J7） */
  primary: string
}

export interface LevelEvolution {
  kind: HeatKind
  /** 视图节点 ID → 角标；热度为 0 的不在其中 */
  heat: Map<string, NodeHeat>
  couplings: LevelCoupling[]
}
