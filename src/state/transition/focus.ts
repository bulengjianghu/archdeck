/**
 * 视角与焦点（V1–V4）：由视图状态推出，不另存字段。
 *   视角 = playback 为 null ? 结构 : 运行
 *   焦点 = 结构视角：selection ?? 当前父模块
 *          运行视角：selection ≠ null ? 钉住(selection) : 跟随(当前帧)
 * 回放只由用户驱动（R1），没有「播放中」与选中争夺面板。
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

/**
 * V3：下钻作为「指向」：运行视角下钉住被下钻的模块（结构视角按 N2 清空选中）。
 * 其余导航（选中、跳转、定位、返回上级）本身就设定了选中，运行视角下即钉住，无需改写。
 */
export function asPointing(before: ViewState, result: TransitionResult, drilled: string): TransitionResult {
  if (!before.playback || result.state === before || result.state.levelId !== drilled) return result
  return { ...result, state: { ...result.state, selection: { kind: 'module', id: drilled } } }
}
