/**
 * 视图状态：用户此刻在看什么，一个值（docs/architecture/view-state.md §1）。
 * 只经 transition() 改变；视角与选中由它推出，不另存字段（运行视角下 selection 为空即选中进度所在的步骤 / 场景，ADR-0012）。
 */
import type { EditEffects, HeatKind, LevelView, ModelIndex, RelationType, ScenarioLevelView, ScenarioPlan, SketchTarget } from '@/model'

export type Selection =
  | { kind: 'module'; id: string }
  | { kind: 'relation'; id: string }
  /** 视图里的一条边（多为聚合边），ID 见 edgeId() */
  | { kind: 'edge'; id: string }
  | { kind: 'actor'; id: string }
  /** 源码文件，id 为相对源码根目录的路径（G16） */
  | { kind: 'file'; id: string }
  /** 代码依赖叠加线，id 为 `<依赖方模块>-><被依赖方模块>`（本层两端节点的模块 ID，K10） */
  | { kind: 'dep'; id: string }
  /** 时间耦合（耦合线），id 为 `<A>~<B>`（两端模块 ID 按字典序，J7） */
  | { kind: 'couple'; id: string }
  /** 端口（接口 ID，L13、V2）：结构视角单击端口记号选中，面板显示端口面板（K11） */
  | { kind: 'port'; id: string }

export interface Toggles {
  showBoundaries: boolean
  currentOnly: boolean
  relationTypes: RelationType[]
  /** 设计版本：在图上标出相对对比基线的变更 */
  showDiff: boolean
  /** 设计版本的对比基线：当前版本或上一轮 */
  compareTo: 'current' | 'previous'
  /** K9：结构视角下在画布上叠加代码事实 */
  showFacts: boolean
  /** J5：热度角标——关 / 修改热度 / 缺陷热度（单选，缺省关，按项目记在本地） */
  heat: 'off' | HeatKind
  /** J5：时间耦合的波浪线（缺省关，按项目记在本地） */
  coupling: boolean
  /** O12：组装叠加线与组装根角标（缺省关，按项目记在本地，不进 URL） */
  assembly: boolean
}

export interface PlaybackState {
  scenarioId: string
  /** 播放头（帧 ID）；null = 停在开头（尚未开始）。只由用户移动，没有自动播放（R1） */
  frameId: string | null
  /** 分支点 ID → 已选选项 */
  choices: ReadonlyMap<string, number>
}

/**
 * V11（ADR-0031）：不开场景时画布的模式——交互视角画交互图（四类交互），结构视角画结构图（依赖事实）。
 * 打开场景即运行视角，模式保留，退出场景回到进入前的模式。
 */
export type CanvasMode = 'interaction' | 'structure'

export interface ViewState {
  /** 当前层次（父模块 ID）；未加载时为空串 */
  levelId: string
  selection: Selection | null
  hover: string | null
  toggles: Toggles
  /** null = 结构 / 交互视角（按 mode）；非 null = 运行视角（V1、V11） */
  playback: PlaybackState | null
  /** V11：画布模式；只在结构视角时写 'structure'，缺省（undefined）为交互视角。URL `v=s` */
  mode?: CanvasMode
  /** 草图画布（X7a，ADR-0025）：打开的草图版本的编辑目标——进入草图即编辑；与运行视角互斥，不进 URL。缺省（undefined）同 null */
  editing?: SketchTarget | null
}

export type Query = Record<string, string | undefined>

export type ViewAction =
  /** 重新加载描述：previousPath 是旧模型中当前层次的路径（N5） */
  | { type: 'reloaded'; previousPath: readonly string[] }
  /** 按 URL 查询参数恢复（首次打开、后退 / 前进、分享链接） */
  | { type: 'restore'; query: Query }
  | { type: 'drill'; id: string }
  | { type: 'goTo'; id: string; select?: Selection | null }
  | { type: 'goUp' }
  | { type: 'select'; selection: Selection | null }
  | { type: 'revealRelation'; id: string }
  | { type: 'revealModule'; id: string }
  | { type: 'hover'; id: string | null }
  | { type: 'toggle'; patch: Partial<Toggles> }
  /** V11、V12：切到结构 / 交互视角（运行视角下即退出场景）；进历史 */
  | { type: 'setMode'; mode: CanvasMode }
  | { type: 'openScenario'; id: string }
  | { type: 'closeScenario' }
  | { type: 'next' }
  | { type: 'prev' }
  /** 指向某一步；null = 回到开头 */
  | { type: 'seek'; frameId: string | null }
  | { type: 'chooseBranch'; pointId: string; option: number }
  /** X7a：进入草图画布（level 为当前张挂载点的层次：根挂载为系统根）/ 退出 */
  | { type: 'enterEdit'; target: SketchTarget; level: string }
  | { type: 'exitEdit' }
  /** X7h：一次编辑（或撤销 / 重做）的影响；previousPath 是编辑前当前层次的路径，level 是编辑后当前张的层次 */
  | { type: 'edited'; effects: EditEffects; previousPath: readonly string[]; level: string }
  /** X7h：下钻 / 面包屑返回切到另一张草图（level 为它的挂载点层次）；不进浏览器历史 */
  | { type: 'openSketch'; level: string }

export interface TransitionContext {
  index: ModelIndex
  /** 运行视角：打开的场景的回放计划、当前层次的舞台视图、回放路径在当前层次的投影 */
  plan?: ScenarioPlan | null
  levelView?: LevelView | null
  scenarioView?: ScenarioLevelView | null
  /** X7a：打开的版本是草图版本（设计的草图、持久草图），可进入编辑态 */
  editable?: boolean
  /** V12：本层这对节点（以两端的模块 ID 指明）之间有没有结构边（K14）；没有代码事实时不给，关系与视图边切到结构视角即清空 */
  structurePair?: (fromModule: string, toModule: string) => boolean
}

export interface TransitionResult {
  state: ViewState
  /** 地址变化进不进浏览器历史（N10、R10） */
  history: 'push' | 'replace'
  /** V12：模式切换时映射不过去而被清空的选中（面板据此说明原因） */
  dropped?: Selection
}

export const DEFAULT_TOGGLES = (relationTypes: readonly RelationType[]): Toggles => ({
  showBoundaries: true,
  currentOnly: false,
  relationTypes: [...relationTypes],
  showDiff: true,
  compareTo: 'current',
  showFacts: true,
  heat: 'off',
  coupling: false,
  assembly: false,
})
