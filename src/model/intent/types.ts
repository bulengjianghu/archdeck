/**
 * 意图的数据类型与小谓词（X1–X6，docs/architecture/governance.md §4.4）：属于模型层的契约，呈现层、命令行与 MCP 直接引用。
 * 草图定义本身（SketchDef、SketchEntity）在 ../types.ts，与描述文件的形状放在一起。
 */
import type { IssueSeverity, ModelIndex, ModuleDef, RelationType, SketchDef, SketchEntity, SketchLifetime, SketchPoint, SourceLoc } from '../types'

/** X9：设计的草图目录 designs/<设计>/sketches/ */
export const SKETCHES_DIR = 'sketches'

/** X1：草图文件——持久草图 intent/*.yaml 与设计的 sketches/<mount>.yaml；它们先于其他文件进入 Loader */
export const isSketchFile = (path: string): boolean => /(^|\/)intent\/[^/]+\.ya?ml$/.test(path) || /(^|\/)sketches\/[^/]+\.ya?ml$/.test(path)

/** X9：设计草图的文件名 = 挂载点 ID（根挂载为 root.yaml） */
export const sketchFileName = (mount: string): string => `${mount}.yaml`

/** X9：设计草图相对项目描述目录的路径 */
export const designSketchPath = (design: string, mount: string): string => `designs/${design}/${SKETCHES_DIR}/${sketchFileName(mount)}`

/** X9：设计草图文件名推出的挂载点（不是 sketches/<mount>.yaml 时为 undefined） */
export const mountOfSketchFile = (path: string): string | undefined => /(?:^|\/)sketches\/([^/]+)\.ya?ml$/.exec(path)?.[1]

/**
 * X6：人拥有的文件（04 §1 的拥有者表）——草图、架构规则、忽略清单、设计元信息、确认层。
 * 路径相对项目描述目录（含 designs/<设计>/…）。
 */
export const isOwnedFile = (path: string): boolean =>
  /^intent\/[^/]+\.ya?ml$/.test(path) ||
  /^designs\/[^/]+\/design\.ya?ml$/.test(path) ||
  /^designs\/[^/]+\/sketches\/[^/]+\.ya?ml$/.test(path) ||
  /^(rules|source-ignore|reviewed)\.ya?ml$/.test(path)

/** 核验的偏差种类（X4） */
export type SketchDeviationCode =
  | 'sketch.contradiction'
  | 'sketch.missing-module'
  | 'sketch.extra-child'
  | 'sketch.field'
  | 'sketch.missing-relation'
  | 'sketch.missing-interface'
  | 'sketch.interface-owner'
  | 'sketch.not-applied'
  | 'sketch.not-removed'

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
  /** X9：挂载点 */
  mount?: string
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
  'sketch.not-applied': '血缘的来源仍在原处',
  'sketch.not-removed': '草图删掉的仍在',
}

// ── 草图的编辑与校验（X7、X7a–X7i，ADR-0024）──

/** 编辑目标：设计的草图或持久草图（X7a） */
export type SketchTarget = { kind: 'design'; design: string } | { kind: 'persistent'; id: string }

/** 模块可改的字段（X7、P-1、P-2）；值为 undefined 表示删掉该字段 */
export type ModulePatch = Partial<Pick<ModuleDef, 'name' | 'responsibility' | 'kind' | 'codeRefs' | 'abstraction' | 'includes' | 'excludes' | 'core'>>

/** X7b：一个设计的全部草图（文件里的与会话里推出的），按挂载点 */
export type SketchSet = Readonly<Record<string, SketchDef>>

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
  /** X10：挂载点模块对内的原则（根挂载不用） */
  | { op: 'setAbstraction'; text: string }
  /** X15：拖动节点（多选一起拖是一步） */
  | { op: 'moveNode'; positions: Record<string, SketchPoint> }
  /** X15：拖动关系标签；null 清掉 */
  | { op: 'relabel'; id: string; label: SketchPoint | null }
  /** X15、X22：重新排列——网格布局覆盖本张 layout；area 为中心区的可用区域（缺省取近似方阵） */
  | { op: 'autoArrange'; area?: { w: number; h?: number } }
  /** X19、X22：把外部模块放上画布作为待连端点（会话里的占位，位置按所属层排布；保存时去掉，没有关系的提示丢弃） */
  | { op: 'addReference'; id: string }
  /** X19：删引用节点 = 删以它为端点的关系与它的位置 */
  | { op: 'removeReference'; id: string }

/**
 * X7b、X7d、X7j、X7k：设计级的编辑操作——输入输出为一个设计的全部草图，一个操作可以改多张（ADR-0025）。
 * 单张草图上的操作带 sketch（挂载点）；合并 / 拆分 / 降级 / 升级 / 移入 / 改 ID / 删除带跨草图的级联（X12、X7e）。
 * ID 可给完整 ID 或短名（短名时补挂载点前缀，X7c）。
 */
export type DesignEditOp =
  | { op: 'edit'; sketch: string; edit: EditOp }
  | { op: 'merge'; sketch: string; ids: string[]; name: string; id: string; kind?: string }
  | { op: 'split'; sketch: string; id: string; parts: { name: string; id: string }[] }
  | { op: 'demote'; sketch: string; id: string; target: string }
  | { op: 'promote'; sketch: string; id: string }
  | { op: 'moveIn'; id: string; layer: string }
  | { op: 'rename'; sketch: string; id: string; newId: string }
  | { op: 'remove'; sketch: string; id: string }

/** 设计级编辑的影响：涉及哪几张草图（设计级撤销的一步记它们，X7g）、改了挂载点的草图（写回层据此改文件名，X12）、删掉的草图 */
export interface DesignEditEffects extends EditEffects {
  /** 改动过的草图（操作后的挂载点） */
  sketches: string[]
  /** 挂载点改了的草图：旧挂载点 → 新挂载点 */
  renamedSketches: [from: string, to: string][]
  /** 删掉的草图（挂载点） */
  removedSketches: string[]
  /** 新出现的草图（推出的或新建的） */
  createdSketches: string[]
}

export type DesignEditResult =
  | { ok: true; design: SketchSet; effects: DesignEditEffects }
  | { ok: false; code: EditRejectCode; reason: string }

/** 设计级编辑的上下文 */
export interface DesignEditContext {
  /** 设计 ID（新出现的草图的 ID） */
  design: string
  /** 持久草图 */
  persistent: readonly SketchEntity[]
  /** 设计的基线：血缘闭包（模块是否基线 ID）与推出下一层草图用；没有时把没写 from 的模块都当作基线模块 */
  baseline?: ModelIndex | null
}

/** 编辑的影响：供选中跟随（X7h）与二次确认的提示（X7d、X7e） */
export interface EditEffects {
  created: string[]
  renamed: [from: string, to: string][]
  removed: string[]
}

export type EditRejectCode = 'not-found' | 'id-taken' | 'id-prefix' | 'id-format' | 'duplicate-relation' | 'ancestor' | 'persistent' | 'invalid' | 'root-only' | 'too-few'

export type EditResult = { ok: true; sketch: SketchDef; effects: EditEffects } | { ok: false; code: EditRejectCode; reason: string }

/** 编辑的上下文：持久草图（引用范围与「设计草图不能动持久草图的实体」） */
export interface EditContext {
  persistent: readonly SketchEntity[]
  /** 编辑的是设计的草图（false：编辑的是持久草图本身） */
  designSketch: boolean
  /** X19：范围外可引用的模块（基线、当前版本或设计的其他草图里有的）；不给时只认本草图与持久草图 */
  known?: (id: string) => boolean
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
  | 'sketch.mount'
  | 'sketch.file'
  | 'sketch.nested'
  | 'sketch.parent'
  | 'sketch.scope'
  | 'sketch.name'
  | 'sketch.ref'
  | 'sketch.ancestor'
  | 'sketch.layer-cycle'
  | 'sketch.contradiction'
  | 'sketch.pending'
  | 'sketch.over-seven'
  | 'sketch.empty'

/**
 * X14 两级：error 为格式错误（拦保存）；warning 为语义提示（不拦保存，拦「保存并交给 AI」与定稿）；
 * hint 只提示、不进两级（超七 X13、没写职责）。
 */
export type SketchValidationSeverity = 'error' | 'warning' | 'hint'

export interface SketchValidationIssue {
  severity: SketchValidationSeverity
  code: SketchValidationCode
  message: string
  /** 定位到实体（P-6） */
  target: { module?: string; relation?: string; interface?: string }
  /** 草图里的位置，如 sketch.modules.2.children.0 */
  path?: string
}

/** 草图本身的校验结果（X7f、X14）：ok = 没有 error，能保存；ready = 也没有 warning，能交给 AI 与定稿 */
export interface SketchValidation {
  ok: boolean
  ready: boolean
  errors: SketchValidationIssue[]
  warnings: SketchValidationIssue[]
  hints: SketchValidationIssue[]
  /** 三者合在一起（error、warning、hint 的顺序） */
  issues: SketchValidationIssue[]
  /** X16：待重连的关系 */
  pending: string[]
}
