/**
 * 视角与焦点（V1–V4）：由视图状态推出，不另存字段。
 *   视角 = playback 为 null ? 结构 : 运行
 *   焦点 = 结构视角：selection ?? 当前父模块
 *          运行视角：selection ≠ null ? 钉住(selection) : 跟随(当前帧)
 *   不变式：playback?.playing ⇒ selection = null
 */
import type { Selection, TransitionResult, ViewState } from './types'

export type Perspective = 'structure' | 'run'

export type Focus =
  | { kind: 'selection'; selection: Selection }
  | { kind: 'level'; levelId: string }
  | { kind: 'pinned'; selection: Selection }
  | { kind: 'follow'; frameId: string | null }

export const perspectiveOf = (state: ViewState): Perspective => (state.playback ? 'run' : 'structure')

export function focusOf(state: ViewState): Focus {
  if (!state.playback) return state.selection ? { kind: 'selection', selection: state.selection } : { kind: 'level', levelId: state.levelId }
  return state.selection ? { kind: 'pinned', selection: state.selection } : { kind: 'follow', frameId: state.playback.frameId }
}

/** V3：运行视角下的「指向」先暂停；结构视角原样返回 */
export function pause(state: ViewState): ViewState {
  return state.playback?.playing ? { ...state, playback: { ...state.playback, playing: false } } : state
}

/**
 * V3：把一次导航（选中、下钻、跳转、定位、返回上级）作为「指向」：运行视角下暂停；
 * 下钻在运行视角下钉住被下钻的模块（结构视角按 N2 清空选中）。取消选中（V4）也暂停（本就无播放），回到跟随。
 */
export function asPointing(before: ViewState, result: TransitionResult, drilled?: string): TransitionResult {
  if (!before.playback || result.state === before) return result
  let state = pause(result.state)
  if (drilled && state.levelId === drilled) state = { ...state, selection: { kind: 'module', id: drilled } }
  return { ...result, state }
}

/** V2：每次转移后断言 */
export function assertFocusInvariant(state: ViewState): void {
  if (state.playback?.playing && state.selection !== null) throw new Error('焦点不变式被破坏：播放中仍有选中')
}
