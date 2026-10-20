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
  codeRefs?: string[]
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

/** 一个 YAML 文件的顶层形状；各键均可选，可任意组合 */
export interface ArchFileDef {
  system?: SystemDef
  module?: ModuleDef
  modules?: ModuleDef[]
  relations?: RelationDef[]
  interfaces?: InterfaceDef[]
  dataStructures?: DataStructureDef[]
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

export interface ArchModel {
  system: SystemDef
  modules: ModuleEntity[]
  relations: RelationEntity[]
  interfaces: InterfaceEntity[]
  dataStructures: DataStructureEntity[]
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
  /** 模块 ID → 以它为一端的关系 ID */
  outRelations: Map<string, string[]>
  inRelations: Map<string, string[]>
}

// ── 层次投影 ─────────────────────────────────────────────────

export type ViewMode = 'graph' | 'layered'

export type ViewNodeRole = 'module' | 'boundary' | 'layer' | 'core'

export interface ViewNode {
  /** 视图内唯一 ID；module / layer / core 用模块 ID，boundary 用 `boundary:<模块ID>` */
  id: string
  moduleId: string
  role: ViewNodeRole
  hasChildren: boolean
  /** core 节点所在的层 ID */
  layerId?: string
}

export type ViewEdgeKind = 'direct' | 'aggregate'

export interface ViewEdge {
  /** `<from>-><to>:<type>`（按类型分开）或 `<from>-><to>`（合并类型），同一视图内唯一且在重新加载后保持不变 */
  id: string
  kind: ViewEdgeKind
  from: string
  to: string
  /** 合并类型时为条数最多的类型 */
  type: RelationType
  /** 各类型条数，按条数降序 */
  types: { type: RelationType; count: number }[]
  relationIds: string[]
  /** 原始关系的同步/异步汇总：全同步、全异步，或混合 */
  mode: 'sync' | 'async' | 'mixed'
}

export interface Band {
  layerId: string
  order: number
  coreModuleIds: string[]
  hiddenCount: number
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
  /** 普通层次中同一对模块之间的关系合并成一条边，不按类型分开（分层总览不受影响） */
  mergeTypes?: boolean
}
