/**
 * 视图状态转移：会话规则的唯一入口（docs/architecture/view-state.md §3）。
 * 纯函数，不依赖 Vue、路由、计时器；非法动作返回原状态；任何输出都满足焦点不变式。
 */
import * as nav from './navigation'
import * as pb from './playback'
import { asPointing, assertFocusInvariant } from './focus'
import { restore } from './url'
import type { TransitionContext, TransitionResult, ViewAction, ViewState } from './types'

export * from './types'
export { selectionExists, keyIntent } from './navigation'
export { encodeSelection, decodeSelection, encodeView, sameQuery } from './url'
export { perspectiveOf, focusOf } from './focus'
export type { Perspective, Focus } from './focus'

export function transition(state: ViewState, action: ViewAction, ctx: TransitionContext): TransitionResult {
  const result = apply(state, action, ctx)
  assertFocusInvariant(result.state)
  return result
}

function apply(state: ViewState, action: ViewAction, ctx: TransitionContext): TransitionResult {
  const { index } = ctx
  switch (action.type) {
    case 'restore':
      return restore(state, ctx, action.query)
    case 'reloaded': {
      const r = nav.reloaded(state, index, action.previousPath)
      return { ...r, state: pb.reloadedPlayback(r.state, ctx) }
    }
    // 导航即「指向」：运行视角下暂停并钉住（V3）
    case 'drill':
      return asPointing(state, nav.drill(state, index, action.id), action.id)
    case 'goTo':
      return asPointing(state, nav.goTo(state, index, action.id, action.select))
    case 'goUp':
      return asPointing(state, nav.goUp(state, index))
    case 'select':
      return action.selection ? asPointing(state, nav.select(state, action.selection)) : nav.select(state, null)
    case 'revealRelation':
      return asPointing(state, nav.revealRelation(state, index, action.id))
    case 'revealModule':
      return asPointing(state, nav.revealModule(state, index, action.id))
    case 'openScenario':
      return pb.openScenario(state, ctx, action.id)
    case 'closeScenario':
      return pb.closeScenario(state)
    case 'next':
      return pb.next(state, ctx)
    case 'prev':
      return pb.prev(state, ctx)
    case 'tick':
      return pb.tick(state, ctx)
    case 'seek':
      return pb.seek(state, ctx, action.frameId)
    case 'play':
      return pb.play(state, ctx)
    case 'pause':
      return pb.pause(state)
    case 'speed':
      return pb.speed(state, action.value)
    case 'chooseBranch':
      return pb.chooseBranch(state, ctx, action.pointId, action.option)
    case 'hover':
      return { state: state.hover === action.id ? state : { ...state, hover: action.id }, history: 'replace' }
    case 'toggle':
      return nav.toggle(state, index, action.patch)
  }
}
