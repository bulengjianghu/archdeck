/**
 * 视图状态转移：会话规则的唯一入口（docs/architecture/view-state.md §3）。
 * 纯函数，不依赖 Vue、路由、计时器；非法动作返回原状态；任何输出都满足焦点不变式。
 */
import * as nav from './navigation'
import { restore } from './url'
import type { TransitionContext, TransitionResult, ViewAction, ViewState } from './types'

export * from './types'
export { selectionExists, keyIntent } from './navigation'
export { encodeSelection, decodeSelection, encodeView, sameQuery } from './url'

export function transition(state: ViewState, action: ViewAction, ctx: TransitionContext): TransitionResult {
  const result = apply(state, action, ctx)
  assertInvariants(result.state)
  return result
}

function apply(state: ViewState, action: ViewAction, { index }: TransitionContext): TransitionResult {
  switch (action.type) {
    case 'restore':
      return restore(state, index, action.query)
    case 'reloaded':
      return nav.reloaded(state, index, action.previousPath)
    case 'drill':
      return nav.drill(state, index, action.id)
    case 'goTo':
      return nav.goTo(state, index, action.id, action.select)
    case 'goUp':
      return nav.goUp(state, index)
    case 'select':
      return nav.select(state, action.selection)
    case 'revealRelation':
      return nav.revealRelation(state, index, action.id)
    case 'revealModule':
      return nav.revealModule(state, index, action.id)
    case 'hover':
      return { state: state.hover === action.id ? state : { ...state, hover: action.id }, history: 'replace' }
    case 'toggle':
      return nav.toggle(state, index, action.patch)
    default:
      return { state, history: 'replace' }
  }
}

/** 焦点不变式（V2）：播放中 ⇒ 无选中 */
export function assertInvariants(state: ViewState): void {
  if (state.playback?.playing && state.selection !== null) {
    throw new Error('焦点不变式被破坏：播放中仍有选中')
  }
}
