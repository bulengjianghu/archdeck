/**
 * 意图的数据类型与小谓词（X1–X6，docs/architecture/governance.md §4.4）：属于模型层的契约，呈现层、命令行与 MCP 直接引用。
 * 草图定义本身（SketchDef、SketchEntity）在 ../types.ts，与描述文件的形状放在一起。
 */
import type { IssueSeverity, ModuleDef, RelationType, SketchDef, SketchEntity, SketchLifetime, SourceLoc } from '../types'

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
  /** 规则编号（02 §2.21） */
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

// ── 草图的编辑与校验（X7、X7a–X7i，ADR-0024）──

/** 编辑目标：设计的草图或持久草图（X7a） */
export type SketchTarget = { kind: 'design'; design: string } | { kind: 'persistent'; id: string }

/** 模块可改的字段（X7、P-1、P-2）；值为 undefined 表示删掉该字段 */
export type ModulePatch = Partial<Pick<ModuleDef, 'name' | 'responsibility' | 'kind' | 'codeRefs' | 'abstraction' | 'includes' | 'excludes' | 'core'>>

/** 一个编辑操作 = 一次用户意图 = 撤销的一步（X7b、X7g）；可序列化，保存冲突后可重放（X7i） */
export type EditOp =
  | { op: 'addLayer'; name: string; id?: string; at: number }
  | { op: 'reorderLayer'; id: string; to: number }
  | { op: 'setMayDependOn'; id: string; layers: string[] }
  | { op: 'addModule'; parent: string; name: string; id?: string; kind?: string }
  | { op: 'updateModule'; id: string; patch: ModulePatch }
  | { op: 'setClosed'; id: string; closed: boolean }
  | { op: 'moveModule'; id: string; parent: string; newId?: string }
  /** 父不变的移动：只改短名（X7d） */
  | { op: 'renameModule'; id: string; newId: string }
  | { op: 'removeModule'; id: string }
  | { op: 'connect'; from: string; to: string; type: RelationType; description?: string; interface?: string }
  | { op: 'updateRelation'; id: string; patch: { type?: RelationType; description?: string; interface?: string } }
  | { op: 'removeRelation'; id: string }
  | { op: 'addInterface'; owner: string; name: string; signature?: string }
  | { op: 'updateInterface'; id: string; patch: { name?: string; signature?: string } }
  | { op: 'removeInterface'; id: string }
  | { op: 'setMeta'; patch: { lifetime?: SketchLifetime; supersedes?: string | null } }

/** 编辑的影响：供选中跟随（X7h）与二次确认的提示（X7d、X7e） */
export interface EditEffects {
  created: string[]
  renamed: [from: string, to: string][]
  removed: string[]
}

export type EditRejectCode = 'not-found' | 'id-taken' | 'id-prefix' | 'id-format' | 'duplicate-relation' | 'ancestor' | 'persistent' | 'invalid'

export type EditResult = { ok: true; sketch: SketchDef; effects: EditEffects } | { ok: false; code: EditRejectCode; reason: string }

/** 编辑的上下文：持久草图（引用范围与「设计草图不能动持久草图的实体」） */
export interface EditContext {
  persistent: readonly SketchEntity[]
  /** 编辑的是设计的草图（false：编辑的是持久草图本身） */
  designSketch: boolean
}

/** 移动前的影响预览（X7d） */
export interface IdImpact {
  renamed: [from: string, to: string][]
  /** 草图内改写的引用条数（关系两端、接口 owner、closed、mayDependOn） */
  references: number
  /** 当前版本里仍引用旧 ID 的实体（AI 生成） */
  outside: { modules: number; relations: number; interfaces: number; messages: number }
  rejected?: string
}

export type SketchValidationCode =
  | 'sketch.schema'
  | 'sketch.id'
  | 'sketch.id-dup'
  | 'sketch.id-prefix'
  | 'sketch.ref'
  | 'sketch.ancestor'
  | 'sketch.layer-cycle'
  | 'sketch.contradiction'
  | 'sketch.empty'

export interface SketchValidationIssue {
  severity: 'error' | 'warning'
  code: SketchValidationCode
  message: string
  /** 定位到实体（P-6） */
  target: { module?: string; relation?: string; interface?: string }
  /** 草图里的位置，如 sketch.modules.2.children.0 */
  path?: string
}

/** 草图本身的校验结果（X7f）：ok = 没有 error，能保存 */
export interface SketchValidation {
  ok: boolean
  issues: SketchValidationIssue[]
}
