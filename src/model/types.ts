/**
 * 架构描述的数据类型。
 *
 * 分两组：
 * - `*Def`：YAML 文件里写的形状（与 schema/arch-file.schema.json 对应）；
 * - 其余：Loader 合并、规整后的模型，以及 Indexer / Projector 的产物。
 */

// ── YAML 文件形状 ─────────────────────────────────────────────

export type RelationType = 'depends' | 'calls' | 'dataflow' | 'event' | 'implements'
export const RELATION_TYPES: readonly RelationType[] = ['depends', 'calls', 'dataflow', 'event', 'implements']
/** 运行时关系（§1.1）：步骤只对应这三类（S12）；画布上饱和、编译期两类降权（L10） */
/** 关系经由什么传递、静态导入在原理上证实不了（K5b） */
export type RelationVia = 'http' | 'hmr' | 'inject' | 'router' | 'callback'
export const RELATION_VIAS: readonly RelationVia[] = ['http', 'hmr', 'inject', 'router', 'callback']

export const RUNTIME_RELATION_TYPES: readonly RelationType[] = ['calls', 'dataflow', 'event']

export type ModuleStatus = 'current' | 'target' | 'deprecated'

export interface SourceDef {
  repo?: string
  commit?: string
  generatedAt?: string
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
  core?: boolean
  responsibility?: string
  principle?: string
  dataStructures?: string[]
  provides?: string[]
  /** 源码路径或 glob，相对源码根目录（G3） */
  codeRefs?: string[]
  /** 对外入口文件，相对源码根目录；不写时按约定推出（G10） */
  entry?: string
  docRefs?: string[]
  owner?: string
  tags?: string[]
  // 以下仅 kind: layer
  order?: number
  abstraction?: string
  includes?: string[]
  excludes?: string[]
  mayDependOn?: string[]
  children?: ModuleDef[]
  /** 设计版本专用：为什么这样设计 / 调整（Markdown） */
  designNote?: string
}

export interface RelationDef {
  id: string
  from: string
  to: string
  type: RelationType
  mode?: 'sync' | 'async'
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
}

/** G20：源码文件的限制；maxLines 缺省 500 */
export interface SourceLimits {
  maxLines?: number
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
  /** 声明顺序，用于稳定排序 */
  seq: number
  src: SourceLoc
}

export interface RelationEntity extends Omit<RelationDef, 'payload'> {
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

export type ViewNodeRole = 'module' | 'boundary' | 'layer' | 'core' | 'actor'

export interface ViewNode {
  /** 视图内唯一 ID；module / layer / core 用模块 ID，boundary 用 `boundary:<模块ID>`，actor 用参与者 ID */
  id: string
  /** 对应的模块 ID；actor 节点为参与者 ID */
  moduleId: string
  role: ViewNodeRole
  hasChildren: boolean
  /** core 节点所在的层 ID */
  layerId?: string
  /** actor 节点的类别，决定排布位置（A7） */
  actorKind?: ActorKind
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

export type ChangeKind = 'added' | 'changed' | 'removed'
export type EntityKind = 'module' | 'relation' | 'interface' | 'dataStructure'

export interface Change {
  entity: EntityKind
  id: string
  kind: ChangeKind
  /** 显示名；关系为「from → to」 */
  name: string
  /** 修改了哪些字段（字段名；显示名在呈现层） */
  fields?: string[]
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
