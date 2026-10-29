/**
 * 架构治理的数据类型（docs/architecture/governance.md §4.1）：接入层产出的文件依赖、基线与拦截记录，模型层产出的比对、违规与环。
 * 路径一律相对源码根目录、以 `/` 分隔。
 */
import type { Issue, ModuleRole, RelationType, RelationVia, RuleKind } from '../types'
import type { ExportKind, SourceOwnership, ExportedSymbol } from '../source/types'

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
  /** `export … from` 再导出：只转出、不使用（K1；K15d 按透传算可截断） */
  reexport?: true
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

// ── 结构视图（ADR-0031）：依赖事实的本层投影与指标的数据类型（计算在 structure.ts） ──

/** K14：依赖边的档——交互使用 > 值使用（只有纯值读取）> 只引类型 */
export type DepTier = 'invokes' | 'value' | 'type'
export const DEP_TIERS: readonly DepTier[] = ['invokes', 'value', 'type']

/** U15：结构边的规则判定——违规（新增 / 无基线 / 已知 / 已豁免）、允许、无约束 */
export type EdgeVerdict = 'violation' | 'allowed' | 'unconstrained'

/** U15：约束一条依赖的一条规则：种类、规则所在与可读的说明 */
export interface RuleBasis {
  kind: RuleKind
  at: string
  text: string
}

export interface EdgeRuling {
  verdict: EdgeVerdict
  /** 违规时投影到这条边的违规里最严的状态：new > open（无基线）> known > allowed（已豁免） */
  status?: ViolationStatus
  violations: Violation[]
  /** 约束这条边、且投影到它的模块依赖都通过了的规则（允许它的规则，U15 悬停与面板） */
  allowedBy: RuleBasis[]
}

/** K16：不稳定度三档（阈值：议）——稳定 I < 1/3、居中、易变 I > 2/3；Ca + Ce = 0 时无定义 */
export type StabilityBand = 'stable' | 'balanced' | 'unstable'
export const STABILITY_BANDS: readonly [number, number] = [1 / 3, 2 / 3]

export interface ModuleMetrics {
  module: string
  /** 扇入：子树外、依赖子树内任一模块的不同模块数 */
  ca: number
  /** 扇出：子树内的模块所依赖的、子树外的不同模块数 */
  ce: number
  /** I = Ce ÷ (Ca + Ce)；Ca + Ce = 0 时为 null（显示「—」） */
  instability: number | null
  band: StabilityBand | null
  /** K19：表面宽度 W（给了表面来源、模块有入口时） */
  w?: number
  /** K19：越过入口数 B（同上） */
  b?: number
}

export interface MetricsOptions {
  /** 只看值依赖：去掉只引类型的文件依赖重算（同 Y1） */
  valuesOnly?: boolean
  /** K19：给了时另算 W / B（只按模块依赖的文件，与 valuesOnly 同口径） */
  surface?: SurfaceSource
}

/** K16：面板「结构」一节——模块的 Ca / Ce / I，贡献最多的 5 个依赖方 / 被依赖方（按文件依赖条数），本层节点数 */
export interface ModuleMetricsDetail extends ModuleMetrics {
  /** 依赖它的模块，按文件依赖条数降序，最多 5 个 */
  topDependents: { module: string; files: number }[]
  /** 它依赖的模块，同上 */
  topDependencies: { module: string; files: number }[]
  /** 投影到本层后不同节点的传入 / 传出数（不含它自己所在的节点）；没给视图时不给 */
  level?: { in: number; out: number }
}

/** K17：一条依赖边的交互覆盖——覆盖它的交互关系，另列由端口实现、子类、组装事实覆盖的模块依赖条数 */
export interface EdgeCoverage {
  relations: string[]
  implementers: number
  subclass: number
  assembly: number
}

export interface LevelDeps {
  /** K14、A4：本层的束——一对节点同方向一条，按依赖方、被依赖方节点的视图顺序 */
  bundles: Bundle[]
  /** K14、A1：本层的元素级结构边，按束的顺序、束内按元素名与形态 */
  elementEdges: ElementEdge[]
}

export interface LevelDepsOptions {
  /** U17 的阈值，缺省 STABLE_DIRECTION_THRESHOLD */
  threshold?: number
  /** 已算好的指标（K16），省得重算 */
  metrics?: ReadonlyMap<string, ModuleMetrics>
  /** K18：表面的来源（入口、归属与入口导出）；不给时元素级边都接到模块本体、不判越过入口 */
  surface?: SurfaceSource
}

// ── 模块表面（ADR-0032）：表面元素、元素级结构边与束（计算在 surface.ts、structure.ts） ──

/** K14、A2：元素级结构边的形态——组装、子类、端口实现、使用；DEP_FORMS 按强到弱（束取最强） */
export type DepForm = 'assembly' | 'subclass' | 'implements' | 'use'
export const DEP_FORMS: readonly DepForm[] = ['subclass', 'assembly', 'implements', 'use']

/** K18、C2：表面元素的四类——端口（算端口的声明接口）、操作（函数、可调用常量、类）、类型（interface / type）、数据（枚举、纯数据常量） */
export type ElementKind = 'port' | 'operation' | 'type' | 'data'
export const ELEMENT_KINDS: readonly ElementKind[] = ['port', 'operation', 'type', 'data']

/**
 * K18、C1：表面元素的声明状态（入口导出与声明接口按名字匹配，同 G12）——已声明且导出 / 导出未声明 / 声明未导出；
 * 没有代码事实（K8）或入口导出还没读到、又没被引用的声明接口为 declared（导出与否未知）
 */
export type DeclState = 'declared-exported' | 'exported-only' | 'declared-only' | 'declared'

/** K18：一个表面元素（模块入口导出的一个符号，或描述声明的一个接口） */
export interface SurfaceElement {
  /** 表面所属的模块（入口所在的模块） */
  module: string
  /** 入口导出名；声明未导出的为接口名（去掉括号与泛型） */
  name: string
  kind: ElementKind
  state: DeclState
  /** 匹配到的声明接口 */
  interfaceId?: string
  /** 入口导出的种类（G11）；声明未导出或未读到入口导出时不给 */
  exportKind?: ExportKind
  /** 声明所在的文件与行（再导出按 K3 穿透到声明文件；本文件声明的为入口文件） */
  file?: string
  line?: number
  /** 入口导出还没读到，种类由用法推断 */
  guessed?: true
}

/** K18：表面的来源——入口（G10）、文件归属（判越过入口）与入口导出（G11；null = 还没读到或读不到，按用法推断种类） */
export interface SurfaceSource {
  entryOf: (moduleId: string) => string | null
  own: Pick<SourceOwnership, 'owners'>
  exportsOf?: (file: string) => readonly ExportedSymbol[] | null
}

/** K18：一个模块的表面；entry 为 null 时没有入口，表面只有声明接口（不判越过入口，K19 的 W / B 不给） */
export interface ModuleSurface {
  module: string
  entry: string | null
  /** 有代码事实（K8）；false 时表面只有声明接口（C8） */
  facts: boolean
  /** 入口导出已读到（种类不是推断的） */
  exports: boolean
  /** 端口、操作、类型、数据各按名字排序；声明未导出的排在最后 */
  elements: SurfaceElement[]
}

/**
 * K14、A1：一条元素级结构边——依赖方节点 → 被依赖方的一个表面元素；越过入口的（bypass）与整模块导入（namespace、默认、`*`）、
 * 被依赖方没有入口的接到模块本体（element 为 null）。一条边只有一种形态（A2），档取其文件依赖的最强（A3）。
 */
export interface ElementEdge {
  /** `el:<依赖方节点>-><被依赖方节点>:<形态>:<元素名 | * 整模块 | ! 越过入口>` */
  id: string
  /** 所在的束（Bundle.id） */
  bundle: string
  from: string
  to: string
  fromModule: string
  toModule: string
  element: SurfaceElement | null
  /** C3：越过入口（深层导入）；element 为 null */
  bypass?: true
  form: DepForm
  tier: DepTier
  /** 产生这条边的文件依赖（同一文件依赖可同时产生几条元素级边与越过入口边） */
  files: FileDep[]
}

/**
 * K14、A4：束——本层一对节点同方向的元素级边的集合。线型与端点记号取最强形态，档取最强，线宽为文件依赖合计（L18）；
 * U15 判定、K17 覆盖、U17 逆稳定都按束（A7）。
 */
export interface Bundle {
  /** `bundle:<依赖方节点>-><被依赖方节点>` */
  id: string
  from: string
  to: string
  /** 两端节点对应的模块 ID；选中落到 K10 的 `sel=d:<fromModule>-><toModule>` */
  fromModule: string
  toModule: string
  /** 最强形态（DEP_FORMS 顺序） */
  form: DepForm
  /** 出现的形态，按 DEP_FORMS 顺序 */
  forms: DepForm[]
  /** 形态不止一种（束上「×N 元素」角标，A4） */
  mixed?: true
  tier: DepTier
  /** 文件依赖条数合计（不重复计） */
  files: number
  /** 接到的不同表面元素数 */
  elements: number
  /** 越过入口的文件依赖条数 */
  bypass: number
  /** 束内的元素级边（ElementEdge.id），同 elementEdges 的顺序 */
  edges: string[]
  /** 聚合的模块依赖键（K4） */
  deps: string[]
  /** K17：交互覆盖 */
  coverage: EdgeCoverage
  /** K17：K7 的未解释的交互 */
  unexplained?: true
  ruling: EdgeRuling
  /** U17：违背稳定依赖方向时两端的 I（全部束都判，A7） */
  againstStability?: { from: number; to: number }
}

/** K19：表面元素的一次使用——元素、使用它的模块（扇入）与文件依赖 */
export interface ElementUse {
  element: SurfaceElement
  /** 使用它的模块（子树外的依赖方模块），按 ID 排序 */
  modules: string[]
  files: FileDep[]
}

/** K19：模块的表面指标；没有入口时 w / b 为 null（不给） */
export interface SurfaceMetrics {
  module: string
  entry: string | null
  /** 表面宽度 W：被子树外引用的不同元素数 */
  w: number | null
  /** 越过入口数 B：越过入口的文件依赖条数 */
  b: number | null
  /** 被引用的元素，按扇入降序、名字 */
  uses: ElementUse[]
  /** 越过入口的文件依赖，按依赖方文件、行 */
  bypasses: FileDep[]
  /** 整模块导入（namespace、默认、`*`）的文件依赖条数 */
  whole: number
}

/** K20：承载模板——直接、经端口、经总线、回调注册（直接通知）、经通道 */
export type CarrierTemplate = 'direct' | 'port' | 'bus' | 'callback' | 'channel'
export const CARRIER_TEMPLATES: readonly CarrierTemplate[] = ['direct', 'port', 'bus', 'callback', 'channel']

/** K20：承载段的角色 */
export type CarrierRole = 'call' | 'use-port' | 'implement' | 'assemble' | 'publish' | 'subscribe' | 'register' | 'contract-from' | 'contract-to'

/** K5d：承载判定——齐全 / 缺段 / 无承载 / 外部承载不判定（通道没写契约模块）/ 已证实（模块级，K5 回退：元素匹配不上但模块依赖在） */
export type CarrierVerdict = 'complete' | 'partial' | 'none' | 'external' | 'module-level'
export const CARRIER_VERDICTS: readonly CarrierVerdict[] = ['complete', 'module-level', 'partial', 'none', 'external']

/** K20：承载链的一段——期望 from → to（模块 ID）上的一条元素级边 */
export interface CarrierSegment {
  role: CarrierRole
  from: string
  to: string
  /** 期望接到的元素名（写了接口、经端口时）；没有时任一操作元素即可 */
  element?: string
  /** 找到的元素级边（模块级：两端为模块）；缺段时为 null */
  edge: ElementEdge | null
  missing?: true
  /** 只在模块级成立（边接到模块本体或别的元素，K5 回退） */
  moduleLevel?: true
}

/** K5d、K20：一条交互的承载 */
export interface Carrier {
  relation: string
  template: CarrierTemplate
  segments: CarrierSegment[]
  verdict: CarrierVerdict
}

/** O13③、L21：分层总览中核心模块（或架上共用件）的一条跨层束——一对节点同方向一条，取最强形态与档 */
export interface ChipDep {
  /** `chip:<依赖方节点>-><被依赖方节点>` */
  id: string
  from: string
  to: string
  fromModule: string
  toModule: string
  /** 最强形态（DEP_FORMS 顺序） */
  form: DepForm
  /** 出现的形态，按 DEP_FORMS 顺序 */
  forms: DepForm[]
  tier: DepTier
  /** 文件依赖条数 */
  files: number
  /** 元素级边条数（跨层依赖不接到元素：按形态与越过入口 / 整模块分条，线宽用） */
  edges: number
  deps: string[]
  /** 投影到这对节点的违规中最严的状态（新增 > 无基线 > 已知 > 已豁免）；没有违规时不给 */
  violation?: ViolationStatus
}

export interface ImpactEntry {
  module: string
  /** 到 M 子树的最短距离（1 = 直接依赖） */
  distance: number
  /** 在模块环中（Y1，只按值依赖） */
  inCycle: boolean
  /** K15d：只能经可截断的依赖（只用声明接口）到达 M——「可能波及」；只在传入闭包、给了表面来源时标 */
  possible?: true
}

export interface Impact {
  module: string
  valuesOnly: boolean
  /** 传入闭包：改它会牵动谁（能到达 M 子树的模块） */
  incoming: ImpactEntry[]
  /** 传出闭包：它要谁才能工作（从 M 子树出发能到达的模块） */
  outgoing: ImpactEntry[]
  /** M 自己（子树内某模块）在模块环中 */
  inCycle: boolean
  /** 闭包内模块归属的源码文件数（给了归属时） */
  files?: { incoming: number; outgoing: number }
}

/** U16：一条允许边——本层一对节点之间、由 mayDependOn 投影来 */
export interface AllowedEdge {
  /** `allowed:<依赖方节点>-><被依赖方节点>` */
  id: string
  from: string
  to: string
  fromModule: string
  toModule: string
  /** 投影到它的规则：层规则（at 为层）、白名单（at 为写规则的模块）、草图（at 为草图里的层） */
  rules: { kind: 'layer' | 'deps' | 'sketch'; at: string; to: string }[]
}

export interface AllowedDeps {
  edges: AllowedEdge[]
  /** 画布角的说明（ALLOWED_ONLY_NOTE；一条 mayDependOn 都没有时为 NO_ALLOWED_NOTE） */
  note: string
}

/** 结构视图在本层：有代码事实时为结构边，否则为允许依赖图（U16） */
export type StructureView = ({ facts: true } & LevelDeps) | ({ facts: false; reason: string } & AllowedDeps)

// ── 承载链的名称与证据对齐（ADR-0032 D；页面、lint 消息与命令行共用，放在类型与 Schema 里供呈现层只读） ──

/** K20：模板的名称（面板、lint 消息与命令行共用） */
export const CARRIER_TEMPLATE_LABELS: Record<CarrierTemplate, string> = { direct: '直接', port: '经端口', bus: '经总线', callback: '回调注册', channel: '经通道' }
/** K5d：判定的名称 */
export const CARRIER_VERDICT_LABELS: Record<CarrierVerdict, string> = {
  complete: '齐全',
  'module-level': '已证实（模块级）',
  partial: '缺段',
  none: '无承载',
  external: '外部承载，不判定',
}
/** K20：承载段的说明（「A → B 的操作」之类，from / to 为两端名称） */
export const CARRIER_ROLE_TEXT: Record<CarrierRole, (from: string, to: string) => string> = {
  call: (a, b) => `${a} → ${b}的操作`,
  'use-port': (a, b) => `${a} → ${b}的端口`,
  implement: (a, b) => `${a} 实现 ${b}的端口`,
  assemble: (_a, b) => `组装 ${b}的模块`,
  publish: (a, b) => `${a} → ${b}的发布操作`,
  subscribe: (a, b) => `${a} → ${b}的订阅操作`,
  register: (a, b) => `${a} → ${b}的注册操作`,
  'contract-from': (a, b) => `${a} → 契约 ${b}`,
  'contract-to': (a, b) => `${a} → 契约 ${b}`,
}

/** T0-10、S18b：承载判定 → 步骤证据等级（齐全 ↔ 按名字匹配、模块级 / 缺段 ↔ 按模块依赖、无承载 ↔ 无证据、外部 ↔ 不判定） */
export const VERDICT_LEVEL: Readonly<Record<CarrierVerdict, EvidenceLevel>> = {
  complete: 'name',
  'module-level': 'module',
  partial: 'module',
  none: 'none',
  external: 'skipped',
}

/** S18b：一帧的证据等级——有承载时由承载判定导出，否则为步骤证据（S16）的等级 */
export const alignedLevel = (level: EvidenceLevel, carrier: Pick<Carrier, 'verdict'> | null | undefined): EvidenceLevel =>
  carrier ? VERDICT_LEVEL[carrier.verdict] : level

/** D7：束里一条交互接到接收方表面的哪个元素——relation.interface 对上的声明接口；没写接口或表面上没有为 null（接到模块本体） */
export interface InteractionSpread {
  relation: string
  element: SurfaceElement | null
}

/** D7、D8：一条交互束（本层一对节点、一种类型的视图边）的散开数据 */
export interface InteractionBundle {
  items: InteractionSpread[]
  /** D8：束内同步 / 异步、via 不一致（只列不一致的那一项） */
  mixed?: { mode?: true; via?: true }
  /** M22：没写接口的交互条数（≥ 2 时提示） */
  unnamed: number
}


/** U19：导出未声明的元素被至少这么多个模块使用时提示声明接口（C4，h5player 实测后定） */
export const HOT_SURFACE_MODULES = 3
