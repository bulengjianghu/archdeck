/**
 * 架构治理的数据类型（docs/architecture/governance.md §4.1）：接入层产出的文件依赖、基线与拦截记录，模型层产出的比对、违规与环。
 * 路径一律相对源码根目录、以 `/` 分隔。
 */
import type { Issue, ModuleRole, RelationType, RelationVia, RuleKind } from '../types'

export type DepKind = 'value' | 'type'

/**
 * K1：交互使用的种类——call 调用、渲染或把函数、类、组件作为值交出；extends 类的 extends（子类事实，K12）；
 * new、factory、register 为组装使用（组装事实，K13）。K7 只把 call 算作要由关系解释的交互。
 */
export type InvokeKind = 'call' | 'extends' | 'new' | 'factory' | 'register'
/** K13：组装使用的种类 */
export const ASSEMBLY_KINDS: readonly InvokeKind[] = ['new', 'factory', 'register']

/** 一条文件依赖（K1、K3） */
export interface FileDep {
  /** 依赖方文件 */
  from: string
  /** 目标：声明被引用符号的文件 */
  to: string
  /** 经由：直接导入的文件（如 barrel 入口）；没有再导出时与 to 相同 */
  via: string
  kind: DepKind
  line: number
  /** 落到这个目标的导入名（只有命名导入、再导出时有；K1） */
  names?: string[]
  /** 依赖方文件的类声明 implements / extends 引用了落到这个目标的名字（K1，K5 的 implements 证据） */
  heritage?: true
  /** 引用了 to 文件的实现：函数、类或变量（不是类型、枚举），或不按名称穿透的值导入；`export … from` 再导出不算（K1，K5 的 implements 证据分档、U11、U12 的值使用） */
  uses?: true
  /** 交互使用：引用了实现且不只是纯值读取——被调用、new、extends、渲染，或把函数、类、组件作为值交出；只读常量、只读成员不算（K1） */
  invokes?: true
  /** 交互使用的种类（K1）；没有时按 call（只调用）看待 */
  invokeKinds?: InvokeKind[]
  /** 继承子句引用的落到这个目标的名字、子句种类（implements / extends）与目标声明的种类（interface / type / class …；K5c、K12） */
  inherits?: { name: string; clause: 'implements' | 'extends'; decl?: string }[]
}

/** 接入层提取的代码依赖（K1–K3） */
export interface CodeDeps {
  deps: FileDep[]
  /** 外部依赖：包名 → 导入次数（K2） */
  external: Record<string, number>
  /** 解析了多少个脚本文件 */
  parsed: number
}

/** 基线（U7） */
export interface Baseline {
  createdAt: string
  /** 源码根目录的 git 提交 */
  commit?: string
  /** 违规键（U6），排序 */
  violations: string[]
  cyclicity: Cyclicity
}

export interface Cyclicity {
  modules: number
  files: number
}

export type Verdict = 'allowed' | 'denied' | 'unconstrained'

export type LedgerClient = 'cli' | 'mcp'

/** 确认记录写入的来源（Z6）：页面确认 / Node 侧直接调用 / 草图归档 */
export type ReviewedOrigin = 'page' | 'cli' | 'archive'

/** 拦截记录的一行（Q4） */
export type LedgerEntry =
  | { at: string; tool: 'check_dependency'; client: LedgerClient; from: string; to: string; verdict: Verdict; rules: RuleKind[]; cycle: boolean }
  | { at: string; tool: 'rescan'; client: LedgerClient; violations: number; newViolations: number; cyclicity: Cyclicity }
  | { at: string; tool: 'reviewed'; origin: ReviewedOrigin; modules: number; design?: string }
  /** B6、B7：草图整份写回、新建、级联改名（renamedFrom 为旧文件）与删除（ADR-0024、ADR-0025） */
  | { at: string; tool: 'sketch'; origin: 'page' | 'cli'; file: string; design?: string; created?: boolean; removed?: boolean; renamedFrom?: string }
  /** U11、M16：在 intent/roles.yaml 认可一个模块的角色（ADR-0027） */
  | { at: string; tool: 'roles'; origin: 'page' | 'cli'; file: string; module: string; role: ModuleRole }

/** 开发态端点 source/<项目>/facts.json 的内容（K8） */
export interface FactsPayload {
  deps: CodeDeps
  baseline: Baseline | null
  ledger: LedgerEntry[]
}

/** 模块依赖（K4）：key = `${from}->${to}` */
export interface ModuleDep {
  key: string
  from: string
  to: string
  files: FileDep[]
}

/** Y5：本层环里的一条本层依赖 */
export interface LevelCycleEdge {
  /** 本层的两端节点（视图节点 ID） */
  from: string
  to: string
  /** 两端节点对应的模块 ID（选中代码依赖用，K10） */
  fromModule: string
  toModule: string
  /** 这对节点之间同方向的视图边；没有时不给 */
  edgeId?: string
  /** 投影到这对节点的模块依赖（K4），带文件证据 */
  deps: ModuleDep[]
}

/** Y5：本层的一个环 */
export interface LevelCycle {
  /** 环编号（Y4，从 1 起） */
  id: number
  /** 环内节点，按视图节点顺序；module 为节点对应的模块 ID */
  nodes: { id: string; module: string }[]
  /** 两端都在环中的本层依赖，按节点顺序 */
  edges: LevelCycleEdge[]
}

export type ConfirmStatus = 'confirmed' | 'unconfirmed' | 'skipped'

/** 关系的证实（K5）：deps 为依据的模块依赖键 */
export interface Confirmation {
  status: ConfirmStatus
  deps: string[]
  /** 两端宿主相同（概念拆分，同文件）而不判定时，为共同的宿主模块 */
  host?: string
  /** 关系写了 via（K5b）：不判定时为经由的机制；经端口而证实时也带上 */
  via?: RelationVia
  /** K5b：经端口证实（发起方 → 端口定义模块的依赖 + 接收方是已证实的实现者）时为端口（接口 ID） */
  port?: string
  /** 未证实且两端之间（含祖先后代）没有任何模块依赖，两个方向、值与类型都没有（K6） */
  isolated?: boolean
  /** 已证实时，依据的依赖相对关系箭头的方向（面板「知识」一行，ADR-0022） */
  knows?: Knowledge
  /** 端口实现者有对应的模块依赖，却没有接口名或 implements / extends 的证据：证据像使用（K5c，原名证据像 depends） */
  likeDepends?: true
  /** 端口实现者有对应的模块依赖，只引了对方的数据类型（类型、枚举），没有接口名或 implements / extends：结构性实现（代码未显式声明，K5c） */
  structural?: true
}

/** K5c：端口的一个实现者与证据档（status：confirmed ① / unconfirmed 带 structural ② 或 likeDepends ③，否则未证实 / skipped 不判定） */
export interface ImplementerFact extends Confirmation {
  module: string
  /** 描述写了（接口的 implementedBy） */
  described: boolean
  /** 代码事实里有类 implements / extends 解析到该接口（K5c ①）；描述没写的即「仅代码事实」的实现者 */
  code: boolean
}

/** K5c：一个接口（端口）的实现者——描述与代码事实的并集；owner 为定义模块（owner，没有时取 provides 它的模块） */
export interface PortFacts {
  port: string
  owner?: string
  implementers: ImplementerFact[]
}

/** K12：子类事实——from 的类 extends to 的类（不是端口）；按模块对聚合 */
export interface SubclassFact {
  key: string
  from: string
  to: string
  files: FileDep[]
}

/** K13：组装事实——from 组装 to（new、工厂、容器注册）；按模块对聚合 */
export interface AssemblyFact {
  key: string
  from: string
  to: string
  kinds: InvokeKind[]
  files: FileDep[]
}

/** K11：端口面板的实现者（描述的与「仅代码事实」的，各带证据档） */
export interface PortImplementer {
  module: string
  described: boolean
  code: boolean
  /** 有代码事实时的证实状态（K5c） */
  status?: ConfirmStatus
  structural?: true
  likeDepends?: true
}

/** K11：端口面板的使用者——经端口（via: port:<P>）或直接（interface 为 P、to 在定义模块子树内）的交互关系的发起方 */
export interface PortUser {
  relation: string
  module: string
  type: RelationType
  how: 'port' | 'direct'
  status?: ConfirmStatus
}

/** K11：一个接口的端口面板：定义 · 实现者 · 使用者；isPort 为裁决 4 的「算端口」（被 via: port: 引用、或有实现者） */
export interface PortPanel {
  port: string
  owner?: string
  isPort: boolean
  implementers: PortImplementer[]
  users: PortUser[]
}

/** 知识方向相对关系箭头：同向 / 反向 / 两个方向都有 */
export type Knowledge = 'forward' | 'reverse' | 'both'

/** 一条规则命中（U2–U4） */
export interface RuleHit {
  kind: RuleKind
  /** 规则所在：层规则为依赖方一侧的层，白名单与访问面为写规则的模块 */
  at: string
  reason: string
  /** 命中例外（U5）时的理由 */
  allowed?: string
}

export type ViolationStatus = 'new' | 'known' | 'open' | 'allowed'

/** 违规（U6）：同一种类、规则所在、两端模块合并为一条 */
export interface Violation {
  key: string
  kind: RuleKind
  at: string
  from: string
  to: string
  reason: string
  files: FileDep[]
  /** new / known：有基线时；open：没有基线；allowed：已豁免 */
  status: ViolationStatus
  allowReason?: string
}

/** 环（Y1）：成员为模块 ID 或文件路径，按字典序 */
export interface Cycle {
  members: string[]
  tolerated: boolean
}

export interface GateSummary {
  newViolations: number
  knownViolations: number
  /** 基线中已不存在的违规条数（可收紧基线） */
  resolved: number
  cycleGrew: boolean
}

/** 治理报告（K4–K7、U2–U9、Y1–Y3） */
export interface GovernanceReport {
  moduleDeps: Map<string, ModuleDep>
  /** 有一端未归属或已忽略、未提升的文件依赖条数（K4） */
  skipped: number
  /** 有一端是归属冲突文件（G6）、未提升的文件依赖（K4）；返工清单按冲突项计数 */
  conflicted: FileDep[]
  fileDeps: number
  external: Record<string, number>
  relations: Map<string, Confirmation>
  /** K5c：端口（接口 ID）→ 实现者与证据档；只列有实现者（描述或代码事实）的接口 */
  implementers: Map<string, PortFacts>
  /** K12：子类事实 */
  subclasses: SubclassFact[]
  /** K13：组装事实与组装根（模块级组装图入度 0、出度 ≥ 1） */
  assembly: AssemblyFact[]
  assemblyRoots: string[]
  undescribed: ModuleDep[]
  /** U12：共用件反向依赖（ADR-0027） */
  sharedReverse: ModuleDep[]
  /** U11：疑似共用件（建议，不改描述；ADR-0027） */
  sharedSuggestions: SharedSuggestion[]
  violations: Violation[]
  moduleCycles: Cycle[]
  fileCycles: Cycle[]
  /** 门禁用的环度（不含容忍的环，Y2、Y3） */
  cyclicity: Cyclicity
  baseline: Baseline | null
  gate: GateSummary
  /** lint:model 的全部问题；页面只取 gateIssues（U9） */
  issues: Issue[]
}

/** 端口三角的一方（K11）：经哪条关系、另一端、类型 */
export interface PortParty {
  relation: string
  /** 另一端（模块或参与者） */
  module: string
  type: RelationType
  via?: RelationVia
  /** 有代码事实时的证实状态 */
  status?: ConfirmStatus
}

export interface PortTriad {
  /** 本模块的接口 ID（provides 与子树内 owner 指向它的接口，G12） */
  defines: string[]
  implementers: PortParty[]
  users: PortParty[]
}

/** 步骤的证据等级（S16）：按名字匹配 / 按模块依赖 / 无证据 / 不判定 */
export type EvidenceLevel = 'name' | 'module' | 'none' | 'skipped'
export const EVIDENCE_LEVELS: readonly EvidenceLevel[] = ['name', 'module', 'none', 'skipped']

/** 不判定的原因：一端是参与者 / 关系写了 via / 一端是目标态 / 两端文件相同（同一模块或同一宿主） */
export type EvidenceSkip = 'actor' | 'via' | 'target' | 'host'

/** 一步消息的代码证据（S16）：candidates 为候选调用点（依赖方文件:行），name 为用来匹配的接口名 */
export type StepEvidence =
  | { level: 'name' | 'module'; name?: string; candidates: FileDep[]; total: number }
  | { level: 'none'; name?: string }
  | { level: 'skipped'; reason: EvidenceSkip; via?: RelationVia; host?: string }

/** 场景的证据汇总：回放计划每一帧的证据与各等级的帧数 */
export interface ScenarioEvidence {
  frames: Map<string, StepEvidence>
  counts: Record<EvidenceLevel, number>
}

/** U11：一个疑似共用件与四条依据 */
export interface SharedSuggestion {
  module: string
  /** ①入度广：依赖它的模块所在的层（≥2 个即满足）与依赖它的兄弟模块（≥3 个即满足） */
  fanIn: { layers: string[]; siblings: string[]; dependents: string[] }
  /** ④像工具模块：命中的词，或 kind: library */
  nameHit: string
  /** 四条依据的文字（面板逐条列出） */
  reasons: string[]
}
