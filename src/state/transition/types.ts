/**
 * 视图状态：用户此刻在看什么，一个值（docs/architecture/view-state.md §1）。
 * 只经 transition() 改变；视角与焦点由它推出，不另存字段。
 */
import type { LevelView, ModelIndex, RelationType, ScenarioLevelView, ScenarioPlan } from '@/model'

export type Selection =
  | { kind: 'module'; id: string }
  | { kind: 'relation'; id: string }
  /** 视图里的一条边（多为聚合边），ID 见 edgeId() */
  | { kind: 'edge'; id: string }
  | { kind: 'actor'; id: string }
  /** 源码文件，id 为相对源码根目录的路径（G16） */
  | { kind: 'file'; id: string }

export interface Toggles {
  showBoundaries: boolean
  currentOnly: boolean
  relationTypes: RelationType[]
  /** 设计版本：在图上标出相对对比基线的变更 */
  showDiff: boolean
  /** 设计版本的对比基线：当前版本或上一轮 */
  compareTo: 'current' | 'previous'
}

export interface PlaybackState {
  scenarioId: string
  /** 播放头（帧 ID）；null = 停在开头（尚未开始）。只由用户移动，没有自动播放（R1） */
  frameId: string | null
  /** 分支点 ID → 已选选项 */
  choices: ReadonlyMap<string, number>
}

export interface ViewState {
  /** 当前层次（父模块 ID）；未加载时为空串 */
  levelId: string
  selection: Selection | null
  hover: string | null
  toggles: Toggles
  /** null = 结构视角；非 null = 运行视角（V1） */
  playback: PlaybackState | null
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
  | { type: 'openScenario'; id: string }
  | { type: 'closeScenario' }
  | { type: 'next' }
  | { type: 'prev' }
  /** 指向某一步；null = 回到开头 */
  | { type: 'seek'; frameId: string | null }
  | { type: 'chooseBranch'; pointId: string; option: number }

export interface TransitionContext {
  index: ModelIndex
  /** 运行视角：打开的场景的回放计划、当前层次的舞台视图、回放路径在当前层次的投影 */
  plan?: ScenarioPlan | null
  levelView?: LevelView | null
  scenarioView?: ScenarioLevelView | null
}

export interface TransitionResult {
  state: ViewState
  /** 地址变化进不进浏览器历史（N10、R10） */
  history: 'push' | 'replace'
}

export const DEFAULT_TOGGLES = (relationTypes: readonly RelationType[]): Toggles => ({
  showBoundaries: true,
  currentOnly: false,
  relationTypes: [...relationTypes],
  showDiff: true,
  compareTo: 'current',
})
