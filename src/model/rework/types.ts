/**
 * 返工清单的数据类型（Q7–Q10，docs/architecture/governance.md §4.2）：属于模型层的契约，呈现层、命令行与 MCP 直接引用。
 * 一条返工项对应一个根因：同一对 codeRefs 重叠导致的冲突文件、同一目录下的未归属文件、同一对端点之间未建模的步骤各合并为一条。
 */
import type { IssueSeverity } from '../types'
import type { ViolationStatus } from '../governance/types'

/** 返工项的类别，按呈现顺序 */
export type ReworkCategory = 'description' | 'violation' | 'cycle' | 'ownership' | 'unconfirmed' | 'undescribed' | 'unmodeled' | 'review'
export const REWORK_CATEGORIES: readonly ReworkCategory[] = ['description', 'violation', 'cycle', 'ownership', 'unconfirmed', 'undescribed', 'unmodeled', 'review']

/** 严重度：error 卡门禁或剔除了实体；warning 描述与代码不一致；info 只提示（未描述依赖、已豁免） */
export type ReworkSeverity = IssueSeverity | 'info'
export const REWORK_SEVERITIES: readonly ReworkSeverity[] = ['error', 'warning', 'info']

/** 建议动作（Q8） */
export type ReworkActionKind =
  | 'fix-description' // 改正描述
  | 'add-code-refs' // 补 / 收窄 codeRefs
  | 'add-ignore' // 加忽略（source-ignore.yaml）
  | 'add-relation' // 补关系
  | 'fix-relation' // 改正或删除关系
  | 'to-depends' // implements 证据像 depends：改为 depends（K5）
  | 'add-implements' // 结构性实现：在类上写明 implements <接口>（K5）
  | 'add-exception' // 加例外（rules.yaml allow）
  | 'fix-code' // 改代码
  | 'add-step-relation' // 补步骤的 relation
  | 'rebaseline' // 评审后重新生成基线
  | 'review' // Z3：在面板上复核并确认（人的动作，不交给 agent）

export interface ReworkAction {
  kind: ReworkActionKind
  /** 一句话说明 */
  text: string
  /** 要写进的文件（相对模型目录，如 `rules.yaml`）；改代码时不给 */
  file?: string
  /** 可直接粘贴的 YAML 片段 */
  snippet?: string
}

/** 出处：description 为相对模型目录的描述文件，source 为相对源码根目录的源码文件 */
export interface ReworkLoc {
  in: 'description' | 'source'
  file: string
  line?: number
  /** 补充说明，如场景与步骤路径、经由文件 */
  note?: string
}

/** 返工项指向的对象，供页面定位（模块、关系、代码依赖、文件） */
export interface ReworkTarget {
  modules?: string[]
  relation?: string
  /** 代码依赖 `<A>-><B>`（K10） */
  dep?: string
  file?: string
  scenario?: string
}

export interface ReworkItem {
  /** 稳定键：`<类别>:<根因键>`，同一根因重新计算后不变 */
  id: string
  category: ReworkCategory
  severity: ReworkSeverity
  /** 规则编号（02 §2） */
  rules: string[]
  /** 问题代码（与 lint:model 的 [code] 一致） */
  code: string
  title: string
  detail?: string
  /** 违规的基线状态（U8） */
  status?: ViolationStatus
  /** 根因所在：该改的描述位置 */
  at?: ReworkLoc
  /** 受影响的文件或步骤（全部，呈现时可截断） */
  affected: ReworkLoc[]
  actions: ReworkAction[]
  target: ReworkTarget
}

export interface ReworkList {
  items: ReworkItem[]
  counts: Record<ReworkSeverity, number>
  byCategory: Record<ReworkCategory, number>
  /** 有没有代码事实（没有时不含归属以外的事实类返工项，K8） */
  facts: boolean
}

/** 类别与严重度的名称：命令行、MCP 与页面共用 */
export const REWORK_CATEGORY_LABELS: Record<ReworkCategory, string> = {
  description: '描述错误与提醒',
  violation: '违规',
  cycle: '环度与基线',
  ownership: '源码归属',
  unconfirmed: '未证实的关系',
  undescribed: '未描述依赖',
  unmodeled: '结构中未建模的步骤',
  review: '需复核',
}

export const REWORK_SEVERITY_LABELS: Record<ReworkSeverity, string> = { error: '错误', warning: '提醒', info: '提示' }
