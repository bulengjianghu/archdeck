/**
 * 意图的数据类型与小谓词（X1–X6，docs/architecture/governance.md §4.3）：属于模型层的契约，呈现层、命令行与 MCP 直接引用。
 * 草图定义本身（SketchDef、SketchEntity）在 ../types.ts，与描述文件的形状放在一起。
 */
import type { IssueSeverity, SourceLoc } from '../types'

/** X1：草图文件——持久草图 intent/**\/*.yaml 与设计的 sketch.yaml；它们先于其他文件进入 Loader */
export const isSketchFile = (path: string): boolean => /(^|\/)intent\/[^/]+\.ya?ml$/.test(path) || /(^|\/)sketch\.ya?ml$/.test(path)

/**
 * X6：人拥有的文件（04 §1 的拥有者表）——草图、架构规则、忽略清单、设计元信息、确认层。
 * 路径相对项目描述目录（含 designs/<设计>/…）。
 */
export const isOwnedFile = (path: string): boolean =>
  /^intent\/[^/]+\.ya?ml$/.test(path) || /^designs\/[^/]+\/(sketch|design)\.ya?ml$/.test(path) || /^(rules|source-ignore|reviewed)\.ya?ml$/.test(path)

/** 核验的偏差种类（X4） */
export type SketchDeviationCode =
  | 'sketch.contradiction'
  | 'sketch.missing-module'
  | 'sketch.extra-child'
  | 'sketch.field'
  | 'sketch.missing-relation'
  | 'sketch.missing-interface'
  | 'sketch.interface-owner'

export type SketchSeverity = IssueSeverity | 'info'

/** 一条偏差（X4）：稳定键 `<种类>:<实体 ID>`，重新核验后不变 */
export interface SketchDeviation {
  key: string
  code: SketchDeviationCode
  severity: SketchSeverity
  /** 规则编号（02 §2.19） */
  rules: string[]
  message: string
  detail?: string
  /** 所在实体，供页面定位 */
  target: { modules?: string[]; relation?: string; interface?: string }
  /** 草图里的位置 */
  at?: SourceLoc
  /** 已认可（design.yaml 的 accepted）：提醒降为 info，不计入偏差数 */
  accepted?: { reason: string; at?: string }
}

/** 认可的偏差（X4）：记在 design.yaml 的 accepted */
export interface AcceptedDeviation {
  deviation: string
  reason: string
  at?: string
}

/** 一张草图对一个版本的核验结果（X4） */
export interface SketchCheck {
  /** 草图 ID */
  sketch: string
  /** 设计的草图：所属设计 */
  design?: string
  lifetime: 'persistent' | 'until-implemented'
  supersedes?: string
  deviations: SketchDeviation[]
  /** 未认可的偏差按严重度计数；info 为已认可或本就只提示的 */
  counts: { error: number; warning: number; info: number }
  /** 一致：零 error 且提醒都已认可——归档与晋升的前提（X3） */
  consistent: boolean
}

/** X3：归档判定 */
export interface ArchiveVerdict {
  /** 能否归档；不能时 reason 说明 */
  ok: boolean
  /** 结局：归档（until-implemented）或晋升（supersedes） */
  outcome: 'archive' | 'promote'
  reason?: string
  check: SketchCheck
}

/**
 * X3：归档时交给确认层写入的一条确认记录（reviewed.yaml 的写入端点 appendReviewed 由确认层实现）。
 * 指纹（hash）由确认层按自己的口径计算，归档方不填。
 */
export interface ReviewedEntry {
  module: string
  at: string
  summary: string
  /** 来源：`sketch:<设计 ID>` */
  source: string
}

/** X6：人拥有文件的指纹记录 governance/owned.json */
export interface OwnedRecord {
  updatedAt: string
  /** 路径（相对项目描述目录）→ SHA-1 */
  files: Record<string, string>
}

export const SKETCH_DEVIATION_LABELS: Record<SketchDeviationCode, string> = {
  'sketch.contradiction': '与持久草图矛盾',
  'sketch.missing-module': '草图的模块不存在',
  'sketch.extra-child': '封闭子树多出子模块',
  'sketch.field': '字段与草图不一致',
  'sketch.missing-relation': '草图的关系没有对应',
  'sketch.missing-interface': '草图的接口不存在',
  'sketch.interface-owner': '接口的提供方与草图不同',
}
