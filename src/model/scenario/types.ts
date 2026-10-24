/**
 * 场景投影的数据类型：回放计划、路径、帧的层次投影、参与查询、步骤大纲与时序模型。
 * 属于模型层的契约（类型与 Schema，U10）：只有声明，计算在同目录的各文件里。
 */
import type { MessageKind, SourceLoc } from '../types'

// ── 消息与关系的绑定（S13、P10） ──

export interface MessageEnds {
  kind: MessageKind
  from: string
  to: string
  relation?: string
}

export interface Binding {
  /** 对应的关系 ID；没有对应时不给 */
  relation?: string
  /** 没写 relation、由 S13 推断得出 */
  inferred: boolean
  /** 消息方向与关系箭头相反（event、return，P10） */
  reverse: boolean
  /**
   * 与结构不一致之处（供 Validator 报告）：
   * - mismatch：引用了关系但端点或方向对不上（error）
   * - not-runtime：引用了 implements（error）
   * - unrelated：没写 relation、推断不到，且两端结构上没有任何关系（warning）
   */
  issue?: 'mismatch' | 'not-runtime' | 'unrelated'
}

// ── 回放计划（F、S14、F7） ──

export type FragmentKind = 'alt' | 'loop' | 'par' | 'ref'

/** 帧所在的一层组合框：id 是组合框实例 ID（alt 即分支点 ID），branch 是所在分支 */
export interface FragmentTag {
  kind: FragmentKind
  id: string
  label: string
  branch?: number
}

export interface Frame {
  id: string
  kind: MessageKind
  /** 真实端点：最深模块或参与者 */
  from: string
  to: string
  label?: string
  interface?: string
  payload: string[]
  note?: string
  relation?: string
  /** S13：对应关系是推断的 */
  relationInferred: boolean
  /** 消息方向与关系箭头相反 */
  reverse: boolean
  /** S14：接口 / 数据取自对应关系（步骤没写） */
  inherited?: { interface?: boolean; payload?: boolean }
  /** 步骤写在哪个场景（ref 内联时为被引用的场景）及其路径、出处 */
  scenarioId: string
  stepPath: string
  src: SourceLoc
  /** 外到内 */
  fragments: FragmentTag[]
}

export interface BranchPoint {
  id: string
  /** 分支点所在的组合框（不含它自己的 alt 标签） */
  fragments: FragmentTag[]
  options: { when: string; first?: Frame }[]
}

export type PlanNode = { kind: 'frame'; frame: Frame } | { kind: 'branch'; point: BranchPoint; options: PlanNode[][] }

export interface ScenarioPlan {
  scenarioId: string
  nodes: PlanNode[]
  /** 计划中的全部帧（含所有分支），按书写顺序 */
  frames: Map<string, Frame>
  points: Map<string, BranchPoint>
}

/** 调用与显式返回的配对：帧 ID → 配对帧 ID（双向；一条调用可能被多个分支中的返回回应，取书写顺序的第一个） */
export type ReturnPairs = ReadonlyMap<string, string>

// ── 回放路径（F6、F6e、F6f） ──

export type Choices = ReadonlyMap<string, number>

export interface ResolvedPath {
  frames: Frame[]
  /** 路径截止处未选分支的分支点（F6） */
  pending?: BranchPoint
  /** 路径上依次经过的分支点 */
  points: BranchPoint[]
}

/** 路线上的一项：路径上依次经过的分支点（chosen 为所选选项），截止处待选的分支点 chosen 为 null */
export interface RouteItem {
  pointId: string
  when: string[]
  chosen: number | null
}

// ── 帧的层次投影（P） ──

/** 分层总览中消息在时序图上的两条泳道（核心模块优先），与结构图上的落点节点不同时给出（P7、P14） */
export type Lanes = { from: string; to: string }

/** 一帧在本层的落点 */
export type Landing =
  /** 落在视图边上；from / to 是消息方向上的视图节点，reverse 表示与边的箭头相反（P10）；core 表示分层总览的核心跨层边（P7） */
  | { kind: 'edge'; edgeId: string; from: string; to: string; reverse: boolean; core?: boolean; lanes?: Lanes }
  /** 本层两节点之间没有视图边，帧已绑定关系（显式或推断）：关系建在上层，一端是当前层次本身或其祖先（P15） */
  | { kind: 'upper'; from: string; to: string; relationId: string; lanes?: Lanes }
  /** 本层两节点之间没有视图边，帧没有绑定任何关系：结构中未建模（P11） */
  | { kind: 'unmodeled'; from: string; to: string; lanes?: Lanes }
  /** 两端落在本层同一个节点（P3）；带 lanes 时是分层总览中同一层不同泳道之间的消息，时序图画成泳道间的箭头；
   *  带 shared 时一端是本层共用件架上的共用件，按另一端的内部活动处理（P18，共用件不开泳道） */
  | { kind: 'internal'; node: string; lanes?: Lanes; shared?: string[] }
  /** 两端都在本层外（P4） */
  | { kind: 'hidden' }

export type VisibleLanding = Exclude<Landing, { kind: 'hidden' }>

export interface VisibleMessage {
  index: number
  /** 覆盖的连续帧 */
  frameIds: string[]
  at: VisibleLanding
  kind: MessageKind | 'internal'
}

export interface ScenarioLevelView {
  levelId: string
  /** 本层可见消息 = 单步单位（R7） */
  messages: VisibleMessage[]
  /** 本层不可见的帧 */
  hidden: string[]
  /** 路径上帧的先后序号 */
  order: Map<string, number>
  /** 帧 → 所在可见消息的序号 */
  messageOf: Map<string, number>
}

export type FrameStatus = 'path' | 'unchosen' | 'unreached'

// ── 参与查询 ──

export type ParticipationTarget = { kind: 'module' | 'relation' | 'edge' | 'actor'; id: string }

export interface Participation {
  /** 参与的帧，按路径顺序；from / to / internal 对模块与参与者，traverse 对关系与视图边 */
  frames: { frameId: string; seq: number; role: 'from' | 'to' | 'internal' | 'traverse' }[]
  /** 涉及的本层可见消息序号 */
  messages: number[]
  interfaces: string[]
  dataStructures: string[]
  /** 离播放头最近的参与帧 */
  nearest?: string
}

// ── 步骤大纲（T5、T6） ──

export interface OutlineOption {
  option: number
  when: string
  status: FrameStatus
  children: OutlineNode[]
}

export type OutlineNode =
  | { kind: 'frame'; frame: Frame; status: FrameStatus }
  /** loop、par 的一个分支、ref */
  | { kind: 'group'; tag: FragmentTag; children: OutlineNode[] }
  | { kind: 'alt'; pointId: string; options: OutlineOption[] }

// ── 时序模型（P9、P13） ──

export interface SequenceParticipant {
  /** 视图节点 ID（本层子模块、`boundary:<模块>`、参与者） */
  nodeId: string
  /** 模块或参与者 ID */
  id: string
  name: string
  kind: 'module' | 'boundary' | 'actor'
  /** 所属父模块（参与者没有）；P13 按它分组 */
  parentId?: string
  /** 根下到自身的模块 ID（参与者为空） */
  path: string[]
  /** 所属层：模块自身或最近的 kind: layer 祖先 */
  layer?: string
  /** 层次顺序的排序键（P9） */
  key: number[]
  /** 本层的非层子模块：同一父模块内改按结构图横坐标排（P9） */
  byX: boolean
}

export interface SequenceMessage {
  index: number
  /** 消息方向上的视图节点；内部活动两端相同 */
  from: string
  to: string
  /** empty：空分支的占位 */
  kind: 'call' | 'async' | 'return' | 'internal' | 'empty'
  label: string
  frameIds: string[]
  status: FrameStatus
  /** 回放路径上的消息在 ScenarioLevelView.messages 中的序号 */
  pathIndex?: number
  /** 本层两节点之间没有视图边：经由上层关系（P15）/ 结构中未建模（P11） */
  temp?: 'upper' | 'unmodeled'
  /** 经由上层关系时对应的关系 */
  relationId?: string
  /** P18：一端是共用件的消息折叠为另一端的内部活动，这里是经过的共用件（模块 ID 与名称），步骤上画「共用」角标 */
  shared?: { id: string; name: string }[]
}

export interface SequenceFragment {
  id: string
  kind: FragmentKind
  label: string
  /** 嵌套深度，最外层为 0 */
  depth: number
  first: number
  last: number
  /** P6：框内的消息在本层全部是内部活动，缩成一行 */
  collapsed: boolean
  /** 仅 alt 与 par：各分支（option 为选项序号，F6e）；chosen 为 null 表示分支点尚未到达 */
  branches?: { option: number; label: string; chosen: boolean | null; first: number; last: number }[]
}

export interface SequenceModel {
  participants: SequenceParticipant[]
  messages: SequenceMessage[]
  fragments: SequenceFragment[]
}
