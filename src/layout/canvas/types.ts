/** 画布场景的对外类型（ADR-0013）：与 Vue Flow 的节点、边同形，经 src/layout/canvas.ts 再导出 */
import type {
  ActorEntity,
  Bundle,
  Carrier,
  DepForm,
  DepTier,
  ElementEdge,
  ElementKind,
  InteractionBundle,
  GovernanceReport,
  Impact,
  ModuleMetrics,
  StabilityBand,
  StructureView,
  AssemblyOverlay,
  ActorKind,
  DepOverlay,
  EdgeFact,
  HeatKind,
  LevelCoupling,
  LevelEvolution,
  LevelFacts,
  ModelDiff,
  ModelIndex,
  ModuleEntity,
  NodeHeat,
  PortPanel,
  ScenarioLevelView,
  ViewEdge,
} from '@/model'
import type { EdgeRoute, Point, PositionedView } from '../layout'
import type { StageOverlay, StaticMode, TempLine } from '../stage'

/** 画布节点的公共数据 */
export interface NodeData {
  moduleId: string
  name: string
  module?: ModuleEntity
  childCount: number
  selected: boolean
  /** 结构视角有聚焦对象（悬停 / 选中）时，与它无关的节点变淡；运行视角按舞台显示 */
  dim: boolean
  /** 边界节点：外部模块所在路径 */
  path?: string
  /** 带（层）专用 */
  band?: { abstraction?: string; mayDependOn: string[]; hiddenCount: number }
  /** +N 占位块 */
  hiddenCount?: number
  /** O6：带内 +N 临时展开后，展开出来的模块数（占位块变为「收起」） */
  expanded?: number
  /** 设计版本：本模块相对对比基线新增或修改 */
  change?: 'added' | 'changed'
  /** 设计版本：涉及其子树或相关关系的变更条数 */
  touched?: number
  /** 外部参与者节点 */
  actor?: ActorEntity
  actorKind?: ActorKind
  /** 运行视角：步骤序号（结构图上的序号标记） */
  steps?: { n: number; frameId: string; current: boolean; muted?: boolean }[]
  /** 运行视角：分支点某个选项的预览 */
  preview?: { pointId: string; option: number; label: string }
  /** Y4：本层环的编号 */
  cycle?: number
  /** ADR-0027：普通层次的核心模块（大块） */
  core?: boolean
  /** L14：边界角色记号（port 对外端口、adapter 适配器） */
  rim?: 'port' | 'adapter'
  /** O12：组装根角标（组装开关开启、本节点含组装根时） */
  assemblyRoot?: number
  /** O10：「共用 ×N」角标 */
  sharedCount?: number
  /** O13②：结构视角下「共用 ×N」按依赖计（含只引类型），悬停文字随之 */
  sharedByDeps?: true
  /** O11：本层框（父模块框、分层总览的带）常驻计数「共用件 N · 折叠 M」 */
  counts?: { shared: number; folded: number }
  /** O9：共用件架在本框 / 带内的纵向位置（相对框顶，px），画「共用件」字样 */
  shelfAt?: number
  /** O8：普通层次的「+N」占位（双击无动作；分层总览的占位双击下钻到层） */
  graphFold?: boolean
  /** J5：热度角标（右下角三档色块）：档位、种类、热度值与次数 */
  heat?: NodeHeat & { kind: HeatKind }
  /** L13：节点定义的端口记号——画在进边一侧（side）的后半；超过 PORT_MERGE 个时合成一个「端口 ×N」（merged 为端口数） */
  ports?: NodePorts
  /** L17、L20①：结构视角的指标角标「入 Ca · 出 Ce · 表面 W」与不稳定度三档色条；共用件架上的块只标入（inOnly）；W 只在有入口时给；Ca + Ce = 0 时不给 */
  metrics?: { ca: number; ce: number; instability: number | null; band: StabilityBand | null; inOnly?: boolean; w?: number }
  /** K15b：结构视角查询影响面时，本节点在影响面（传入）/ 依赖面（传出）里的方向与最短距离；K15d：可能波及（possible）时标浅一档 */
  impact?: { direction: 'in' | 'out' | 'both'; distance: number; inCycle: boolean; possible?: true }
  /** K15：影响面的中心（选中的模块所在的节点） */
  impactSelf?: boolean
  /** C6、L20、L23：展开表面的节点——元素记号在入边一侧（side），坐标相对节点左上角；交互视角只给被交互接到的元素 */
  surface?: NodeSurface
  /** B2、L21③：跨界折叠的束——朝外一侧的小记号「界外 入 N · 出 M」，悬停列目标 */
  crossFold?: { in: number; out: number; side: 'top' | 'bottom' | 'left' | 'right'; title: string }
}

/** C6、L20②：节点上的一个端口点（不写名字，形状按种类） */
export interface SurfaceMark {
  name: string
  kind?: ElementKind
  /** K19：扇入（使用它的模块数） */
  fanIn?: number
  x: number
  y: number
  /** 本层有画出来的边接到它（结构视角：被显示偏好收起的为 false，记号变淡） */
  used: boolean
  /** L20b：所属子模块的名称（悬停「属于 <子模块>」）；本体为「本体」；节点没有子模块分组时不给 */
  owner?: string
  /** L20b：组首——该组的子模块短名（ID 去掉父模块前缀），画小标签；本体一组不给（ADR-0036） */
  group?: string
  /** L20b：组名可用的宽度（px，到下一组首），放不下截短 */
  groupRoom?: number
  /** L20④：使用它的模块（名称），悬停提示「扇入 N（…）」 */
  users?: string[]
}

export interface NodeSurface {
  side: 'top' | 'left'
  items: SurfaceMark[]
  /** 没画成端口的元素数（「+N 个元素」，清单在面板「表面」一节） */
  more?: number
  /** L20b：元素按所属子模块分了组（组首有标签） */
  grouped?: true
}

/** L16、K14：结构边的形态——使用、组装、子类、端口实现（第八轮按形态，A2）；没有代码事实时的允许边（U16） */
export type DepEdgeKind = DepForm | 'allowed'

/** U15：违规红晕三档——新增或无基线（红晕）、已知（淡红晕）、已豁免（灰描边）；共享通道（L18） */
export type DepViolation = 'new' | 'known' | 'allowed'

/** L16：结构边（依赖边）的画法——结构视图私有的编码（UML 类图惯例），与交互边的 L10 互不相干 */
export interface DepEdgeLook {
  kind: DepEdgeKind
  /** 依赖边的档（K14）：交互使用深、值使用中、只引类型浅（明度） */
  tier?: DepTier
  /** 两端节点对应的模块 ID：选中落到 `sel=d:<fromModule>-><toModule>`（K10） */
  fromModule: string
  toModule: string
  /** 线宽的条数（共享通道「聚合条数」三档，L18）：束为束内元素级边条数（T0 裁决 1）；元素级边与允许边为 1 */
  deps: number
  /** 文件依赖条数（只进悬停与面板） */
  files?: number
  /** L21①：束内出现的形态（不止一种时束上加「×N 元素」角标） */
  forms?: DepForm[]
  /** L21①：「×N 元素」的 N（束内元素级边条数）；形态只有一种时不给 */
  elements?: number
  /** C6：元素级边接到的元素（越过入口、整模块为空） */
  element?: { name: string; kind: ElementKind }
  /** C3：越过入口（深层导入），接到节点本体并带记号 */
  bypass?: boolean
  /** C6：散开的束里接到节点本体的其余元素级边合成的一条（「×N 其余」） */
  rest?: boolean
  /** L22：承载叠加的一段（交互视角选中交互时临时画出并高亮） */
  carrier?: boolean
  violation?: DepViolation
  /** K17：未解释（K7 同口径） */
  unexplained?: boolean
  /** U17：逆稳定——两端的 I */
  against?: { from: number; to: number }
  /** 悬停说明：种类与档、条数、覆盖、规则判定 */
  title: string
}

/** L13：一个端口记号——接口 ID、名称、实现者数（描述与代码事实的并集） */
export interface PortMark {
  id: string
  name: string
  implementers: number
}

export interface NodePorts {
  side: 'top' | 'left'
  /** 单独画的端口；合成时为空 */
  items: PortMark[]
  /** 合成「端口 ×N」时的端口数 */
  merged?: number
  /** 选中的端口（V2） */
  selected?: string
}

/** K9：事实状态——已证实或没有代码事实 / 未证实或部分证实 / 代码有描述无；不进线型（L10、ADR-0035），未证实写在标签位（L26） */
export type FactState = 'confirmed' | 'unconfirmed' | 'undescribed'

/** L10：箭头——同步实心、异步空心 */
export type EdgeArrow = 'closed' | 'open'

export interface RouteEdgeData {
  route: EdgeRoute
  edge: ViewEdge
  /** L26：标签位——×N、把手与词表里的异常和修饰（` · ` 连接）；运行视角走过的边不标条数 */
  label: string
  /** 有标签：画成带边框的 pill（L26） */
  pill?: boolean
  /** 标签含异常（违规 / 未证实 / 未解释 / 缺段 / 未建模）：警示色 */
  warn?: boolean
  factState: FactState
  arrow: EdgeArrow
  /** 线宽档位：聚合条数 1 / 2–4 / ≥5 */
  weight: 1 | 2 | 3
  /** L12：边上有一条经端口（via: port:）的关系——目标端画插座记号 */
  port?: boolean
  /** L24：边上有经回调（via: channel:callback）的关系——标签位写「回调」 */
  callback?: boolean
  /** L24：经回调关系配对的正向关系 ID（悬停时这些关系所在的边减一档高亮，L25） */
  callbackPairs?: string[]
  /** 选中：强调色窄晕，不改线宽 */
  selected: boolean
  /** L25：鼠标悬停——衬边 + 投影、线加粗、提到最上层（画布局部状态，GraphCanvas 叠加） */
  hovered?: boolean
  /** L24、L25：悬停回调边时它配对的正向边——减一档（只垫衬边） */
  hoverPair?: boolean
  dim: boolean
  /** 核心跨层边，只在悬停/选中时出现 */
  core?: boolean
  /** O10：共用件的边，只在悬停/选中一端时出现 */
  shelf?: boolean
  /** 设计版本：边包含新增或修改的关系 */
  change?: 'added' | 'changed'
  /** 运行视角：当前消息、走过、分支预览、时序图悬停预览 */
  play?: 'current' | 'walked' | 'preview' | 'hover'
  /** R15：选中步骤时，不属于选中 / 配对消息的走过的边淡为灰色 */
  muted?: boolean
  /** 当前消息与边的箭头方向相反（P10） */
  flowReverse?: boolean
  /** 本层没有视图边时的临时线：经由上层关系（P15）/ 结构中未建模（P11）；代码依赖叠加线（K9）；时间耦合的波浪线（J5） */
  temp?: TempLine['kind'] | 'code' | 'couple' | 'assembly' | 'carried' | 'carrier-gap'
  /** 悬停说明（D8：交互束内修饰不一致时列出各条；L22：缺段的说明） */
  title?: string
  /** D8：交互束内同步 / 异步、via 不一致（标签位加「混合」，L26） */
  mixed?: boolean
  /** L23b：收起的交互束的把手角标（`×N · M 把手`）；有它时 title 为按子模块分组的悬停列表 */
  handles?: string
  /** K9：关系边的证实 */
  fact?: EdgeFact
  /** K9：边含违规 */
  violated?: boolean
  /** L11：本边水平段上的跳线点（与其他可见折线边的交叉） */
  jumps?: Point[]
  /** K9：代码依赖叠加线的内容 */
  overlay?: DepOverlay
  /** J5：耦合线的内容（次数、两端、是否无依赖无关系） */
  couple?: LevelCoupling
  /** O12：组装叠加线的内容 */
  assembly?: AssemblyOverlay
  /** L15、L16：结构视角的结构边（依赖边）；有它时由 DepEdge 按结构视图的编码画 */
  dep?: DepEdgeLook
}

export type CanvasNodeType = 'frame' | 'module' | 'boundary' | 'band' | 'core' | 'more' | 'shared' | 'actor' | 'step' | 'preview'

/** 与 Vue Flow 的节点同形 */
export interface CanvasNode {
  id: string
  type: CanvasNodeType
  position: { x: number; y: number }
  data: NodeData
  zIndex: number
  width: number
  height: number
  style: { width: string; height: string }
  selectable: false
  /** 编辑态下模块与带可拖动（移动、排序）、可连线（X7） */
  draggable: boolean
  connectable: boolean
  class?: string
}

/** 与 Vue Flow 的边同形；箭头由 RouteEdge 按 data.arrow 自画（L10）；结构边（type 'dep'）由 DepEdge 按 data.dep 画（L16） */
export interface CanvasEdge {
  id: string
  source: string
  target: string
  type: 'route' | 'dep'
  zIndex: number
  data: RouteEdgeData
}

export interface CanvasInput {
  positioned: PositionedView | null
  index: ModelIndex | null
  selection: { kind: string; id: string } | null
  /** 悬停：视图节点 ID，或 `step:<帧 ID>`（悬停时序图消息） */
  hover: string | null
  /** 运行视角的舞台叠加；结构视角为 null */
  stage: StageOverlay | null
  scenarioView: ScenarioLevelView | null
  /** 选中突出：选中步骤所在的可见消息与配对消息（R15、R16）；选中的不是步骤时 selected 为 null */
  emphasis: { selected: number | null; paired: ReadonlySet<number> } | null
  /** 参与本场景的舞台节点（V5） */
  participants: ReadonlyMap<string, 'path' | 'other'>
  /** 交互关系显示方式与「在画布上显示」的节点（V8、V9） */
  mode: StaticMode
  reveal: readonly string[]
  /** 设计版本且开启「标出变更」时的差异；否则为 null */
  diff: ModelDiff | null
  /** G14：选中文件在本层投影的节点 */
  fileHits: ReadonlySet<string> | null
  /** 停在分支点时的分支点 ID（分支预览用） */
  branchPointId: string | null
  /** K9、Y4：结构视角下开启「代码事实」时的本层投影；否则为 null */
  facts?: LevelFacts | null
  /** J5：结构视角下开启热度或时间耦合时的本层投影；否则为 null */
  evolution?: LevelEvolution | null
  /** L13：本层节点（模块 ID）定义的端口；运行视角为 null（不画） */
  ports?: ReadonlyMap<string, readonly PortPanel[]> | null
  /** O12：结构视角下开启「组装」时的组装叠加线；否则为空 */
  assembly?: readonly AssemblyOverlay[] | null
  /** O12：本层节点 ID → 落在它上面的组装根个数（「组装根」角标）；开关关闭时为空 */
  assemblyRoots?: ReadonlyMap<string, number> | null
  /** ADR-0031：结构视角的输入；交互视角与运行视角为 null（照交互图画） */
  structure?: StructureInput | null
  /** D7、D8：本层交互视图边 → 按接收方表面散开的数据与束内混合（交互视角用；运行视角为 null） */
  spreads?: ReadonlyMap<string, InteractionBundle> | null
  /** L22：交互视角选中一条交互时它的承载（不判定或没有代码事实时为 null） */
  carrier?: Carrier | null
  /** C6：展开表面的节点模块 → 元素名 → 种类与扇入（元素记号的悬停） */
  surfaceInfo?: ReadonlyMap<string, ReadonlyMap<string, { kind: ElementKind; fanIn: number; sub?: string | null; users?: readonly string[] }>> | null
}

/**
 * B1–B4、C6：结构视角画布要画的束（desk.facts.structureDisplay 的结果；同形，Layout 不依赖视图状态层的类型）
 */
export interface StructureDisplayInput {
  shown: readonly Bundle[]
  elementEdges: readonly ElementEdge[]
  hidden: { type: number; value: number; covered: number; cross: number }
  cross: ReadonlyMap<string, { in: number; out: number }>
  reach: ReadonlyMap<string, 'sibling' | 'cross' | 'outer'>
  anomalies: ReadonlySet<string>
  focus: { bundle: string; nodes: readonly [string, string] | string[]; bundles: ReadonlySet<string> } | null
  expanded: ReadonlyMap<string, ReadonlySet<string> | null>
}

/** 结构视角（ADR-0031）画什么：本层结构视图与显示偏好、指标、影响面、本层的环 */
export interface StructureInput {
  /** 本层的结构边（有代码事实）或允许依赖图（U16）；代码事实还在读取时为 null（不画边，画布角说明） */
  view: StructureView | null
  /** B1–B4、C6：按显示偏好过滤后的束、收起计数、跨界折叠、聚焦与展开（desk.facts.structureDisplay）；没有代码事实时为 null */
  display?: StructureDisplayInput | null
  /** L15：只引类型的依赖边是否画出（缺省收起，显示偏好 typeOnly）；展开后的元素级边同样随它（T0 裁决 11） */
  typeOnly: boolean
  /** B1：只看交互使用（展开后的元素级边同样随它） */
  invokesOnly?: boolean
  /** B4：只看未解释（跨界折叠的目标清单与计数同口径） */
  uncoveredOnly?: boolean
  /** L17：各模块的 Ca / Ce / I（没有代码事实时为 null） */
  metrics: ReadonlyMap<string, ModuleMetrics> | null
  /** K15b：面板显式查询的影响面（全系统，视图状态 impactQuery）；不看、没有选中模块或没有代码事实时为 null */
  impact: Impact | null
  /** K15b：查询的方向——影响面（传入）、依赖面（传出）或两者；impact 为 null 时不用 */
  impactMode: 'in' | 'out' | 'both'
  /** Y4：本层的环（节点 → 编号），结构视角常显 */
  cycles: ReadonlyMap<string, number> | null
  /** O13③：分层总览中核心模块的跨层依赖（聚焦核心模块时画）要用的模块依赖与违规；没有代码事实时为 null */
  report?: Pick<GovernanceReport, 'moduleDeps' | 'violations'> | null
  /** 画布角的说明（没有代码事实、正在读取） */
  note?: string | null
}

export interface CanvasScene {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  /**
   * 结构视角：画布角的计数与说明——收起的只引类型束（L15、B1）、只看交互使用时收起的值使用（B1）、只看未解释时收起的已解释（B4），
   * 没有代码事实时的说明（U16）；其余视角不给
   */
  structure?: { typeOnlyHidden: number; valueHidden: number; coveredHidden: number; note: string | null }
  /** V5：运行视角隐藏了静态内容时只按这些节点适应画布；否则为 null（取全部内容） */
  visibleIds: Set<string> | null
}
