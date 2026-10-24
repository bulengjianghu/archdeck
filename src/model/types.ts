/**
 * 架构描述的数据类型。
 *
 * 分两组：
 * - `*Def`：YAML 文件里写的形状（与 schema/arch-file.schema.json 对应）；
 * - 其余：Loader 合并、规整后的模型，以及 Indexer / Projector 的产物。
 */

// ── YAML 文件形状 ─────────────────────────────────────────────

/** 关系类型（§1.1、ADR-0022、ADR-0026）：关系是交互——运行时关系的箭头一律是控制流方向；「谁知道谁」是代码事实，不是关系 */
export type RelationType = 'calls' | 'notifies' | 'streams' | 'implements'
export const RELATION_TYPES: readonly RelationType[] = ['calls', 'notifies', 'streams', 'implements']
/** M15：已不是关系类型的旧类型（ADR-0026），读取时丢弃并提醒 */
export const REMOVED_RELATION_TYPE = 'depends'
/** 旧名（M12）：加载时映射，event 同时翻转两端；一轮后删除 */
export type LegacyRelationType = 'event' | 'dataflow'
export const LEGACY_RELATION_TYPES: Readonly<Record<LegacyRelationType, { to: RelationType; flip: boolean }>> = {
  event: { to: 'notifies', flip: true },
  dataflow: { to: 'streams', flip: false },
}
/** 关系经由什么传递、静态导入在原理上证实不了（K5b） */
export type RelationVia = 'http' | 'hmr' | 'inject' | 'router' | 'callback' | 'port' | 'bus'
export const RELATION_VIAS: readonly RelationVia[] = ['http', 'hmr', 'inject', 'router', 'callback', 'port', 'bus']

/** 运行时关系（§1.1）：命令、通知、流；步骤只对应这三类（S12）；画布上饱和、编译期的 implements 降权（L10） */
export const RUNTIME_RELATION_TYPES: readonly RelationType[] = ['calls', 'notifies', 'streams']

export type ModuleStatus = 'current' | 'target' | 'deprecated'
export type ModuleRole = 'core' | 'shared' | 'bus'
export const MODULE_ROLES: readonly ModuleRole[] = ['core', 'shared', 'bus']
/** O9、P18、U12：共用件——`shared` 与 `bus` 同样收进共用件架 */
export const isSharedRole = (role: ModuleRole | undefined): boolean => role === 'shared' || role === 'bus'
/** M16、U11：模块角色的约定文件（人拥有） */
export const ROLES_FILE = 'intent/roles.yaml'

export interface SourceDef {
  repo?: string
  commit?: string
  generatedAt?: string
  /** E9：ADR 文件所在目录（相对源码根目录），缺省 docs/adr */
  adrDir?: string
  /** J1、J4：git 历史的窗口、补充的缺陷匹配与耦合阈值（都可选） */
  history?: HistoryDef
}

/** J1、J4：`system.source.history` 的写法（04 §3.7） */
export interface HistoryDef {
  /** 窗口天数，缺省 180 */
  days?: number
  /** 补充的缺陷匹配正则（不分大小写），与缺省规则取并集 */
  fixPatterns?: string[]
  /** 时间耦合阈值：同提交次数（缺省 5）、占两端修改次数的比例（缺省 0.3） */
  coupling?: { min?: number; ratio?: number }
}

export interface SystemDef {
  id: string
  name: string
  description?: string
  source?: SourceDef
}

export interface ModuleDef {
  id: string
  name: string
  /** 只在文件顶层的 `module` 上有意义：挂到哪个父模块下，缺省为系统根 */
  parent?: string
  kind?: string
  status?: ModuleStatus
  /** 角色（§1.1、ADR-0027）：core 核心 / shared 共用件 / bus 事件总线（不作 notifies 的端点，M14）；不写为普通。旧写法 `core: true` 由 Loader 映射（M16） */
  role?: ModuleRole
  responsibility?: string
  principle?: string
  dataStructures?: string[]
  provides?: string[]
  /** 源码路径或 glob，相对源码根目录（G3） */
  codeRefs?: string[]
  /** 对外入口文件，相对源码根目录；不写时按约定推出（G10） */
  entry?: string
  docRefs?: string[]
  /** E9：相关架构决策的编号（整数，显示为 ADR-0025）；面板「相关决策」列出，不继承 */
  adrs?: number[]
  owner?: string
  tags?: string[]
  // 以下仅 kind: layer（abstraction 例外：非层模块的对内原则由挂在它身上的草图写入，X10）
  order?: number
  /** 层的抽象；非层模块为对内的原则（来自挂在它身上的草图的 abstraction，X10） */
  abstraction?: string
  includes?: string[]
  excludes?: string[]
  mayDependOn?: string[]
  children?: ModuleDef[]
  /** 设计版本专用：为什么这样设计 / 调整（Markdown） */
  designNote?: string
  /** 只在草图里：血缘——这个模块由哪些基线模块而来，一律指向基线 ID（X11）；不进模型索引 */
  from?: string[]
}

export interface RelationDef {
  id: string
  from: string
  to: string
  /** 文件里也可能写旧名（M12），Loader 映射后只剩 RelationType */
  type: RelationType | LegacyRelationType
  mode?: 'sync' | 'async'
  /** 只用于 streams：拉取型流，箭头仍指数据去向（M13） */
  pull?: boolean
  /** K5b：经此传递，静态导入在原理上证实不了；有它的关系不判定 */
  via?: RelationVia
  interface?: string
  payload?: string | string[]
  description?: string
  designNote?: string
}

export interface InterfaceDef {
  id: string
  name: string
  owner?: string
  signature?: string
  description?: string
  semantics?: string
  designNote?: string
}

export interface DataStructureDef {
  id: string
  name: string
  definition?: string
  description?: string
  invariants?: string
  designNote?: string
}

export type ActorKind = 'user' | 'system' | 'time'

/** 外部参与者：系统之外主动发起交互的实体，不进模块树（A1–A5） */
export interface ActorDef {
  id: string
  name: string
  kind: ActorKind
  description?: string
  designNote?: string
}

/** 消息步骤的内容（S2） */
export interface MessageDef {
  /** 场景内唯一；写了则帧 ID 稳定（F2、S11） */
  id?: string
  from: string
  to: string
  label?: string
  relation?: string
  interface?: string
  payload?: string | string[]
  note?: string
}

export type StepDef =
  | { call: MessageDef }
  | { async: MessageDef }
  | { return: MessageDef }
  | { alt: { when: string; steps: StepDef[] }[] }
  | { loop: { while: string; steps: StepDef[] } }
  | { par: { steps: StepDef[] }[] }
  | { ref: string }

export interface ScenarioDef {
  id: string
  name: string
  description?: string
  /** 触发原因（文字）；触发者由第一条消息的发送方推出（A6） */
  cause?: string
  /** S15：证据文件——验证这条链路的测试、E2E 等源码文件（相对源码根目录）；只校验在源码清单里存在 */
  evidence?: string[]
  steps: StepDef[]
  designNote?: string
}

/** 一个描述文件的顶层形状；各键均可选，可任意组合 */
export interface ArchFileDef {
  system?: SystemDef
  module?: ModuleDef
  modules?: ModuleDef[]
  relations?: RelationDef[]
  interfaces?: InterfaceDef[]
  dataStructures?: DataStructureDef[]
  actors?: ActorDef[]
  scenario?: ScenarioDef
  scenarios?: ScenarioDef[]
  /** 忽略清单（G8）：不属于任何模块的源码文件 */
  sourceIgnore?: string[]
  /** G20：源码文件的超长阈值 */
  sourceLimits?: SourceLimits
  /** U1：架构规则（约定文件 rules.yaml），只能声明一次 */
  rules?: RulesDef
  /** Z1：确认记录（约定文件 reviewed.yaml），人拥有，由页面与草图归档写入 */
  reviewed?: ReviewedEntryDef[]
  /** X1：草图（只在 intent/*.yaml 与 designs/<设计>/sketches/<mount>.yaml 里用） */
  sketch?: SketchDef
  /** M16、U11：模块角色（约定文件 intent/roles.yaml，人拥有）：模块 ID → role；草图里写了的以草图为准 */
  roles?: Record<string, ModuleRole>
}

/** X3：草图的生命周期 */
export type SketchLifetime = 'persistent' | 'until-implemented'
export const SKETCH_LIFETIMES: readonly SketchLifetime[] = ['persistent', 'until-implemented']

/** X9：根挂载——层与层的直接子模块（骨架即根挂载的持久草图） */
export const ROOT_MOUNT = 'root'

/** X15：草图里的一个位置 */
export interface SketchPoint {
  x: number
  y: number
}

/** X15：布局里记的模块位置——根草图的第二级模块的 y 相对所在层带的顶（X21；旧草图只记 x 时取带内第一行），其余草图记 x、y */
export interface SketchSpot {
  x: number
  y?: number
}

/** X15：草图的布局——模块坐标（引用节点按它显示的模块 ID 记，X19）与关系标签位置；人拥有，随草图归档，不进模型索引 */
export interface SketchLayout {
  modules?: Record<string, SketchSpot>
  relations?: Record<string, { label?: SketchPoint }>
}

/**
 * X1、X2、X9：草图（格式 v2，ADR-0025）——人拥有的局部描述：一张草图挂在一个模块下、只画一个层次；
 * 内容与普通描述同形，没写的字段不约束。
 */
export interface SketchDef {
  /** 持久草图有固定 ID（骨架为 skeleton）；设计的草图 ID 即设计 ID */
  id: string
  /** X9：挂载点——模块 ID 或 root；不能是层。非根草图的模块是挂载点的直接子节点，根挂载为层与层的直接子模块 */
  mount: string
  /** intent/ 下缺省 persistent，设计的草图缺省 until-implemented（X3） */
  lifetime?: SketchLifetime
  /** 封闭的子树：这些模块（挂载点或本草图的模块）的直接子模块集合必须与草图相等（X2） */
  closed?: string[]
  /** 定稿实现后替换的持久草图 ID（晋升，X3）；同挂载点已有持久草图时必须声明（X4） */
  supersedes?: string
  /** X10：挂载点模块对内的原则（加载为挂载点模块的 abstraction）；根挂载不用，改用各层的 abstraction 等字段 */
  abstraction?: string
  modules?: ModuleDef[]
  relations?: RelationDef[]
  interfaces?: InterfaceDef[]
  dataStructures?: DataStructureDef[]
  /** X15：人摆放的位置 */
  layout?: SketchLayout
}

/** G20：源码文件的限制；maxLines 缺省 500 */
export interface SourceLimits {
  maxLines?: number
  /** Q13：共用件子树行数占已归属行数的提醒阈值，缺省 0.2 */
  sharedRatio?: number
}

/** 架构规则的种类：层规则（U2）、依赖白名单（U3）、访问面（U4） */
export type RuleKind = 'layer' | 'deps' | 'exposes'
export const RULE_KINDS: readonly RuleKind[] = ['layer', 'deps', 'exposes']

/** 一个模块上的规则（U3、U4） */
export interface ModuleRuleDef {
  module: string
  /** 子树之外只许依赖这些模块的子树；写了即默认拒绝 */
  mayDependOn?: string[]
  /** 子树之外只许经这些文件访问：glob，或 `entry`（模块入口，G10） */
  exposes?: string[]
  reason?: string
}

/** 例外（U5） */
export interface AllowDef {
  from: string
  to: string
  rule?: RuleKind
  reason: string
}

/** 架构规则（U1–U5、Y3）：架构师的意图，AI 重新生成当前版本时不改动 */
export interface RulesDef {
  /** 层规则开关，缺省 true（U2） */
  layers?: boolean
  modules?: ModuleRuleDef[]
  allow?: AllowDef[]
  cycles?: { tolerated?: string[] }
}

/** Z2、Z3：确认时的摘要——指纹覆盖的内容的一份副本，需复核时据此显示差异 */
export interface ReviewSummaryDef {
  responsibility?: string
  includes?: string[]
  excludes?: string[]
  mayDependOn?: string[]
  provides?: { id: string; signature?: string }[]
  children?: string[]
}

/** Z1、Z6：一条确认记录；source 为 `manual` 或 `sketch:<设计 ID>` */
export interface ReviewedEntryDef {
  module: string
  /** 确认日期 YYYY-MM-DD */
  at: string
  /** 指纹（Z2） */
  hash: string
  source?: string
  note?: string
  summary?: ReviewSummaryDef
}

// ── 加载产物 ─────────────────────────────────────────────────

export interface RawFile {
  /** 相对模型目录的路径，如 `modules/domain.yaml` */
  path: string
  text: string
}

/** 实体在描述文件中的出处，用于报错定位 */
export interface SourceLoc {
  file: string
  /** YAML 内的路径，如 `module.children.2.id` */
  path: string
  line?: number
}

export interface ModuleEntity extends Omit<ModuleDef, 'children' | 'parent'> {
  /** 父模块 ID；直接挂在系统下时为 system.id */
  parentId: string
  /** M16：role 取自 intent/roles.yaml（不是草图或模块文件写的）；核验不把它当草图偏差（X4） */
  roleFrom?: 'roles'
  /** 声明顺序，用于稳定排序 */
  seq: number
  src: SourceLoc
}

export interface RelationEntity extends Omit<RelationDef, 'payload' | 'type'> {
  type: RelationType
  payload: string[]
  seq: number
  src: SourceLoc
}

export interface InterfaceEntity extends InterfaceDef {
  src: SourceLoc
}

export interface DataStructureEntity extends DataStructureDef {
  src: SourceLoc
}

export interface ActorEntity extends ActorDef {
  seq: number
  src: SourceLoc
}

export interface ReviewedEntry extends ReviewedEntryDef {
  src: SourceLoc
}

export type MessageKind = 'call' | 'async' | 'return'

export interface Message extends Omit<MessageDef, 'payload'> {
  payload: string[]
}

/**
 * 规整后的步骤。path 是步骤在本场景步骤树中的路径（F2）：列表下标以 `.` 连接，
 * 组合步骤的子列表记为 `alt<k>` / `loop` / `par<k>`，如 `4.alt0.1`。
 */
export type Step = { path: string; src: SourceLoc } & (
  | { kind: MessageKind; msg: Message }
  | { kind: 'alt'; branches: { when: string; steps: Step[] }[] }
  | { kind: 'loop'; while: string; steps: Step[] }
  | { kind: 'par'; branches: { steps: Step[] }[] }
  | { kind: 'ref'; scenario: string }
)

export type MessageStep = Extract<Step, { msg: Message }>

export interface ScenarioEntity extends Omit<ScenarioDef, 'steps'> {
  steps: Step[]
  seq: number
  src: SourceLoc
}

export interface ArchModel {
  system: SystemDef
  modules: ModuleEntity[]
  relations: RelationEntity[]
  interfaces: InterfaceEntity[]
  dataStructures: DataStructureEntity[]
  actors: ActorEntity[]
  scenarios: ScenarioEntity[]
  /** 各文件 sourceIgnore 的合并（G8），不参与版本对比 */
  sourceIgnore: string[]
  /** G20：只取第一处声明，不参与版本对比 */
  sourceLimits?: SourceLimits
  /** U1：只取第一处声明，去掉坏引用后的架构规则；不参与版本对比 */
  rules?: RulesDef
  /** U1：rules 的出处 */
  rulesSrc?: SourceLoc
  /** Z1：各文件 reviewed 的合并（Validator 去掉坏引用、按模块去重），不参与版本对比 */
  reviewed: ReviewedEntry[]
  /** X1：本次加载的草图文件（整份定义，供核验），不参与版本对比 */
  sketches: SketchEntity[]
}

/** 一份已加载的草图（X1）：定义、所在文件与出处；设计的草图另记所属设计 */
export interface SketchEntity {
  def: SketchDef
  file: string
  src: SourceLoc
  /** X9：挂载点（即 def.mount） */
  mount?: string
  /** X15：没有 layout——打开时自动布局一次，不因此写回 */
  needsLayout?: boolean
  /** 设计的草图：所属设计 ID（由接入层按路径或载荷给出，模型层只透传） */
  design?: string
}

export type IssueSeverity = 'error' | 'warning'

export interface Issue {
  severity: IssueSeverity
  code: string
  message: string
  file?: string
  path?: string
  line?: number
}

// ── 索引 ─────────────────────────────────────────────────────

export interface ModelIndex {
  model: ArchModel
  rootId: string
  modules: Map<string, ModuleEntity>
  relations: Map<string, RelationEntity>
  interfaces: Map<string, InterfaceEntity>
  dataStructures: Map<string, DataStructureEntity>
  /** 父 ID → 子模块 ID（按声明顺序；层按 order） */
  childrenOf: Map<string, string[]>
  /** 模块 ID → 从根到它的路径（含根、含自身） */
  pathOf: Map<string, string[]>
  /** 模块或参与者 ID → 以它为一端的关系 ID */
  outRelations: Map<string, string[]>
  inRelations: Map<string, string[]>
  actors: Map<string, ActorEntity>
  scenarios: Map<string, ScenarioEntity>
  /** 模块 ID → 有帧端点在其子树内的场景（根含全部场景，R4） */
  scenariosOf: Map<string, string[]>
  /** 参与者 ID → 由它触发（第一条消息由它发出）的场景（A6） */
  triggeredBy: Map<string, string[]>
}

// ── 层次投影 ─────────────────────────────────────────────────

export type ViewMode = 'graph' | 'layered'

/** layer / core 只在分层总览；shared 为共用件架上的共用件（O9）；more 为普通层次的「+N」占位（O8） */
export type ViewNodeRole = 'module' | 'boundary' | 'layer' | 'core' | 'actor' | 'shared' | 'more'

export interface ViewNode {
  /** 视图内唯一 ID；module / layer / core 用模块 ID，boundary 用 `boundary:<模块ID>`，actor 用参与者 ID */
  id: string
  /** 对应的模块 ID；actor 节点为参与者 ID */
  moduleId: string
  role: ViewNodeRole
  hasChildren: boolean
  /** core 节点（与分层总览中 shared 节点）所在的层 ID */
  layerId?: string
  /** actor 节点的类别，决定排布位置（A7） */
  actorKind?: ActorKind
  /** 普通层次的核心模块（role: core）：大块常显（ADR-0027） */
  core?: true
  /** O10：「共用 ×N」——它连到的共用件个数（共用件架上的节点不带） */
  sharedCount?: number
  /** O8：more 节点折叠的普通模块数（展开时为 0） */
  hiddenCount?: number
  /** O8：more 节点临时展开出来的模块数（占位变为「收起 N 个」） */
  expanded?: number
}

export type ViewEdgeKind = 'direct' | 'aggregate'

export interface ViewEdge {
  /** `<from>-><to>:<type>`（L5：同一对节点按类型各一条），同一视图内唯一且在重新加载后保持不变 */
  id: string
  kind: ViewEdgeKind
  from: string
  to: string
  type: RelationType
  /** 原始关系；条数即其长度 */
  relationIds: string[]
  /** 原始关系的同步/异步汇总：全同步、全异步，或混合 */
  mode: 'sync' | 'async' | 'mixed'
}

export interface Band {
  layerId: string
  order: number
  coreModuleIds: string[]
  hiddenCount: number
  /** O6：临时展开时，展开出来的非核心模块数（已并入 coreModuleIds，hiddenCount 为 0） */
  expanded?: number
  /** O9：该层的共用件（role: shared / bus），收进带底的共用件架 */
  shelf: string[]
}

export interface LevelView {
  mode: ViewMode
  parentId: string
  nodes: ViewNode[]
  edges: ViewEdge[]
  /** 仅 layered：每层一条带，按 order 升序 */
  bands?: Band[]
  /** 仅 layered：核心模块的跨层关系，默认不画，悬停/选中时显示 */
  coreEdges?: ViewEdge[]
  /** O9：仅普通层次——本层的共用件（视图节点 ID，节点 role 为 shared），收进父模块框底部的共用件架；分层总览的在各带的 shelf */
  shelf?: string[]
  /** O10：共用件与本层其他节点之间的边（任一方向、任一类型），默认不画，悬停 / 选中一端时画 */
  shelfEdges?: ViewEdge[]
  /** O8：仅普通层次——普通模块的「+N」占位：节点 ID、折叠的模块（展开时为空）、是否临时展开 */
  fold?: { id: string; members: string[]; expanded: boolean }
  /** O8：本层没有核心模块、普通模块超过七个时不折叠，只提示这个数（「N 个模块，考虑标出核心」） */
  foldHint?: number
  /** O8：折叠进占位的模块 → 占位节点 ID（端点映射到本层后再经它换成视图节点，viewNodeOf） */
  alias?: Record<string, string>
}

export interface ProjectOptions {
  showBoundaries: boolean
  /** 为空表示不过滤 */
  relationTypes?: readonly RelationType[]
  /** true 时隐藏 status: target 的模块及其关系 */
  currentOnly?: boolean
  /** 运行视角的舞台：场景中全部帧的端点，用于补齐结构上没有关系的边界节点与参与者 */
  scenarioEnds?: readonly { from: string; to: string }[]
  /** O6：分层总览中临时展开的层：非核心模块与核心模块一样露出，不改层次 */
  expandedBands?: readonly string[]
}

// ── 版本对比（E1、E2）：计算在 diff.ts ──

/** 变更种类：按 ID 的新增 / 修改 / 删除，与按血缘的合并 / 拆分 / 改 ID / 移动（X11、X17） */
export type ChangeKind = 'added' | 'changed' | 'removed' | 'merged' | 'split' | 'renamed' | 'moved'
export const CHANGE_KINDS: readonly ChangeKind[] = ['added', 'changed', 'merged', 'split', 'renamed', 'moved', 'removed']
export const CHANGE_KIND_LABELS: Readonly<Record<ChangeKind, string>> = {
  added: '新增',
  changed: '修改',
  merged: '合并',
  split: '拆分',
  renamed: '改 ID',
  moved: '移动',
  removed: '删除',
}
export type EntityKind = 'module' | 'relation' | 'interface' | 'dataStructure'

export interface Change {
  entity: EntityKind
  id: string
  kind: ChangeKind
  /** 显示名；关系为「from → to」 */
  name: string
  /** 修改了哪些字段（字段名；显示名在呈现层） */
  fields?: string[]
  /** 合并 / 改 ID / 移动：来源的基线 ID（X11）；拆分时 id 为被拆的基线 ID */
  from?: string[]
  /** 拆分的结果 ID */
  to?: string[]
}

export interface ModelDiff {
  /** 全部变更，按实体类别、变更类别、声明顺序排列 */
  changes: Change[]
  /** 目标模型中存在的实体（新增 / 修改）按 ID 查询 */
  module: Map<string, Change>
  relation: Map<string, Change>
  interface: Map<string, Change>
  dataStructure: Map<string, Change>
  /** 目标模型中的模块 ID → 涉及它（及其子树）的变更条数，不含模块自身的增改 */
  touched: Map<string, number>
  counts: Record<ChangeKind, number>
}
