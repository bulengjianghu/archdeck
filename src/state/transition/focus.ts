/**
 * 视角与焦点（V1–V4）：由视图状态推出，不另存字段。
 *   视角 = playback 为 null ? 结构 : 运行
 *   焦点 = 结构视角：selection ?? 当前父模块
 *          运行视角：selection ≠ null ? 钉住(selection) : 跟随(当前帧)
 * 回放只由用户驱动（R1），没有「播放中」与选中争夺面板。
 */
import type { ModelIndex, Participation, ReturnPairs, ScenarioLevelView } from '@/model'
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
 * R15：焦点突出——运行视角下要突出的本层可见消息序号；null 表示不突出（结构视角、停在开头、当前帧本层不可见）。
 * 跟随：当前可见消息 + 配对帧（F7）所在的可见消息；钉住：钉住对象参与的可见消息（文件不参与，为空集）。
 * 钉住的是当前层次本身或其祖先（如下钻后钉住的模块）时按跟随：本层消息几乎都与它有关，全部突出等于没有突出（ADR-0011）。
 */
export function emphasisOf(
  state: ViewState,
  view: ScenarioLevelView | null,
  pairs: ReturnPairs | null,
  pinned: Participation | null,
  index?: ModelIndex,
): Set<number> | null {
  const pb = state.playback
  if (!pb || !view) return null
  const s = state.selection
  const enclosing = s?.kind === 'module' && !!index?.pathOf.get(state.levelId)?.includes(s.id)
  if (s && !enclosing) return new Set(s.kind === 'file' ? [] : (pinned?.messages ?? []))
  if (pb.frameId === null) return null
  const current = view.messageOf.get(pb.frameId)
  if (current === undefined) return null
  const out = new Set([current])
  for (const f of view.messages[current].frameIds) {
    const pair = pairs?.get(f)
    const m = pair === undefined ? undefined : view.messageOf.get(pair)
    if (m !== undefined) out.add(m)
  }
  return out
}

/**
 * V3：下钻作为「指向」：运行视角下钉住被下钻的模块（结构视角按 N2 清空选中）。
 * 其余导航（选中、跳转、定位、返回上级）本身就设定了选中，运行视角下即钉住，无需改写。
 */
export function asPointing(before: ViewState, result: TransitionResult, drilled: string): TransitionResult {
  if (!before.playback || result.state === before || result.state.levelId !== drilled) return result
  return { ...result, state: { ...result.state, selection: { kind: 'module', id: drilled } } }
}
