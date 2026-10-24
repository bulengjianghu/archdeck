/** 画布场景的对外类型（ADR-0013）：与 Vue Flow 的节点、边同形，经 src/layout/canvas.ts 再导出 */
import type {
  ActorEntity,
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
  /** O10：「共用 ×N」角标 */
  sharedCount?: number
  /** O11：本层框（父模块框、分层总览的带）常驻计数「共用件 N · 折叠 M」 */
  counts?: { shared: number; folded: number }
  /** O9：共用件架在本框 / 带内的纵向位置（相对框顶，px），画「共用件」字样 */
  shelfAt?: number
  /** O8：普通层次的「+N」占位（双击无动作；分层总览的占位双击下钻到层） */
  graphFold?: boolean
  /** J5：热度角标（右下角三档色块）：档位、种类、热度值与次数 */
  heat?: NodeHeat & { kind: HeatKind }
}

/** L10：线型表示的事实状态——已证实或没有代码事实（实线）/ 未证实或部分证实（虚线）/ 代码有描述无（点线） */
export type FactState = 'confirmed' | 'unconfirmed' | 'undescribed'

/** L10：箭头——同步实心、异步空心 */
export type EdgeArrow = 'closed' | 'open'

export interface RouteEdgeData {
  route: EdgeRoute
  edge: ViewEdge
  /** L10：只有聚合条数（×N）与异常标记；运行视角走过的边为空 */
  label: string
  /** 标签含 ×N：画成带边框的 pill */
  pill?: boolean
  /** 标签含异常标记（? / 未解释 / 违规） */
  warn?: boolean
  factState: FactState
  arrow: EdgeArrow
  /** 线宽档位：聚合条数 1 / 2–4 / ≥5 */
  weight: 1 | 2 | 3
  /** L12：边上有一条经端口（via: port:）的关系——目标端画插座记号 */
  port?: boolean
  /** 选中：强调色窄晕，不改线宽 */
  selected: boolean
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
  temp?: TempLine['kind'] | 'code' | 'couple'
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

/** 与 Vue Flow 的边同形；箭头由 RouteEdge 按 data.arrow 自画（L10） */
export interface CanvasEdge {
  id: string
  source: string
  target: string
  type: 'route'
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
  /** 静态关系显示方式与「在画布上显示」的节点（V8、V9） */
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
}

export interface CanvasScene {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  /** V5：运行视角隐藏了静态内容时只按这些节点适应画布；否则为 null（取全部内容） */
  visibleIds: Set<string> | null
}
