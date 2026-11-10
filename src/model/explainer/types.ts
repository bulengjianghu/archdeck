/**
 * 图解（ADR-0055，EX-1–EX-9）的数据类型与文件约定：图解是附在模块上的一份 HTML，存放在项目描述目录的 explainers/ 下。
 * 属于模型层的契约，加载、命令行与页面共用。
 */

export const EXPLAINERS_DIR = 'explainers'

/** EX-1：描述目录里的图解文件（只认 explainers/ 下一层的 .html） */
export const isExplainerFile = (rel: string): boolean => /^explainers\/[^/]+\.html$/i.test(rel)

/** EX-1：约定路径 explainers/<模块 ID>.html */
export const conventionalExplainer = (moduleId: string): string => `${EXPLAINERS_DIR}/${moduleId}.html`

/** EX-6：依据的版本号写在 arch-basis 的开头 */
export const BASIS_VERSION = 'v1'
export const BASIS_META = 'arch-basis'

/** EX-6：一份依据——每项的键与 8 位指纹，整体指纹 */
export interface ExplainerBasis {
  hash: string
  items: Record<string, string>
}

/** EX-7：依据的一处改动；label 是「谁的什么」 */
export interface BasisChange {
  key: string
  kind: 'added' | 'removed' | 'changed'
  label: string
}

/** EX-7：一份图解的依据状态 */
export interface ExplainerStatus {
  module: string
  path: string
  /** 图解里记录的依据；没有 arch-basis 或写坏了为 null */
  recorded: ExplainerBasis | null
  current: ExplainerBasis
  /** 相对记录的改动（没有记录时为空） */
  changes: BasisChange[]
  /** 记录与现在不一致，或没有记录 */
  stale: boolean
}

/** EX-4：图解导航 */
export interface ExplainerNav {
  /** 最近的有图解的祖先（含系统根） */
  up: string | null
  /** 子树里最近的有图解的后代，按模块树顺序 */
  down: string[]
}

/** EX-2：图解里引用到的一个模块要填入的原文 */
export interface ExplainerRef {
  name: string
  /** summaryOf 的取值；pending 为回退（M30） */
  summary: { text: string; pending: boolean } | null
  invariants: { text: string; adr?: number }[]
  /** 这个模块有没有自己的图解（EX-3 的「图解 ›」） */
  explainer: boolean
}

export const BASIS_CHANGE_LABELS: Record<BasisChange['kind'], string> = { added: '增', removed: '删', changed: '改' }
