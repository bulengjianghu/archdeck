/**
 * 人确认层的数据类型（Z1–Z6，docs/architecture/governance.md §4.3）：架构师确认过的模块、确认时的摘要与指纹，以及现在相对确认时的状态与差异。
 * 属于模型层的契约，呈现层、命令行与草图归档直接引用。
 */
import type { ReviewedEntry, ReviewSummaryDef } from '../types'

/** Z3：已确认 / 需复核 / 未确认 */
export type ReviewStatus = 'reviewed' | 'stale' | 'unreviewed'
export const REVIEW_STATUSES: readonly ReviewStatus[] = ['reviewed', 'stale', 'unreviewed']

/** Z2：指纹覆盖的内容，规整后的形状（字段都有值，接口按 ID 排序，子模块与可依赖的层排序）；系统（Z7）只有 description */
export interface ReviewSummary {
  /** 按行去首尾空白、去空行 */
  responsibility: string
  /** 原则（层与模块，ADR-0042），按行规整；没写为空串 */
  abstraction: string
  includes: string[]
  excludes: string[]
  mayDependOn: string[]
  provides: { id: string; signature: string }[]
  children: string[]
  /** Z2（ADR-0052）：对子模块的分层声明，一层一行（层序、ID、名称、问题、判定问、原则、可依赖的层、成员）；没声明为空 */
  strata: string[]
  /** 系统简介（Z7），按行规整；模块为空串 */
  description: string
}

/** 摘要的字段名，按呈现顺序 */
export type ReviewField = keyof ReviewSummary
export const REVIEW_FIELDS: readonly ReviewField[] = ['description', 'responsibility', 'abstraction', 'includes', 'excludes', 'mayDependOn', 'provides', 'children', 'strata']

/** Z3：一项差异；接口「改」时带前后签名 */
export interface ReviewChange {
  kind: 'added' | 'removed' | 'changed'
  /** 职责的一行、包含 / 不包含的一项、接口或子模块的 ID */
  text: string
  before?: string
  after?: string
}

/** Z3：上次确认时与现在的差异，按字段分组；没有变化的字段为空列表 */
export type ReviewDiff = Record<ReviewField, ReviewChange[]> & { count: number }

/** 一个模块的确认状态；有记录时带记录，需复核且记录有摘要时带差异 */
export interface ReviewState {
  status: ReviewStatus
  entry?: ReviewedEntry
  diff?: ReviewDiff
}

/** Z5：确认范围内的计数 */
export interface ReviewCounts {
  /** 范围内的模块数（核心模块与第二级模块，Z4；不含系统，Z7） */
  scope: number
  reviewed: number
  stale: number
}

/** Z6：来源写法 */
export const REVIEW_SOURCE_MANUAL = 'manual'
export const isReviewSource = (s: unknown): s is string => typeof s === 'string' && /^(manual|sketch:[A-Za-z0-9][A-Za-z0-9._:-]*)$/.test(s)

/** 写入端点与 appendReviewed 接受的一条记录（Z6）：字段同文件里的写法 */
export interface ReviewedInput {
  module: string
  at: string
  hash: string
  summary: ReviewSummaryDef
  source: string
  note?: string
}

/** 状态与字段的名称：命令行与页面共用 */
export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = { reviewed: '已确认', stale: '需复核', unreviewed: '未确认' }
export const REVIEW_FIELD_LABELS: Record<ReviewField, string> = {
  description: '简介',
  responsibility: '职责',
  abstraction: '原则',
  includes: '应该包含',
  excludes: '不应该包含',
  mayDependOn: '可依赖的层',
  provides: '对外接口',
  children: '子模块',
  strata: '分层',
}
