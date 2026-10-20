/**
 * 视图状态：用户此刻在看什么，一个值（docs/architecture/view-state.md §1）。
 * 只经 transition() 改变；视角与焦点由它推出，不另存字段。
 */
import type { ModelIndex, RelationType } from '@/model'

export type Selection =
  | { kind: 'module'; id: string }
  | { kind: 'relation'; id: string }
  /** 视图里的一条边（多为聚合边），ID 见 edgeId() */
  | { kind: 'edge'; id: string }

export interface Toggles {
  showBoundaries: boolean
  currentOnly: boolean
  relationTypes: RelationType[]
  /** 设计版本：在图上标出相对对比基线的变更 */
  showDiff: boolean
  /** 设计版本的对比基线：当前版本或上一轮 */
  compareTo: 'current' | 'previous'
}

export type Speed = 0.5 | 1 | 2

export interface PlaybackState {
  scenarioId: string
  /** 播放头（帧 ID）；null = 尚未开始 */
  frameId: string | null
  /** 分支点 ID → 已选选项 */
  choices: ReadonlyMap<string, number>
  playing: boolean
  speed: Speed
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
  | { type: 'seek'; frameId: string }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'speed'; value: Speed }
  | { type: 'chooseBranch'; pointId: string; option: number }
  /** 时钟到点：与 next 相同，但到分支点或末尾时暂停（F6a） */
  | { type: 'tick' }

export interface TransitionContext {
  index: ModelIndex
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
