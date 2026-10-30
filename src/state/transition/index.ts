/**
 * 视图状态转移：会话规则的唯一入口（docs/architecture/view-state.md §3）。
 * 纯函数，不依赖 Vue、路由；非法动作返回原状态。
 */
import * as nav from './navigation'
import * as pb from './playback'
import { asPointing, perspectiveOf } from './selected'
import { restore } from './url'
import * as edit from './edit'
import { setMode } from './mode'
import type { TransitionContext, TransitionResult, ViewAction, ViewState } from './types'

export * from './types'
export { selectionExists, keyIntent } from './navigation'
export { encodeSelection, decodeSelection, encodeView, sameQuery } from './url'
export { perspectiveOf, selectedOf, emphasisOf } from './selected'
export { leaveGuard, isEditing } from './edit'
export { mapSelection, withMode } from './mode'
export * from './workspace'
export type { Perspective, Selected, Emphasis, EmphasisContext } from './selected'

export function transition(state: ViewState, action: ViewAction, ctx: TransitionContext): TransitionResult {
  const r = step(state, action, ctx)
  return { ...r, state: dropStaleQuery(state, r.state) }
}

const sameSelection = (a: ViewState['selection'], b: ViewState['selection']) => a?.kind === b?.kind && a?.id === b?.id

/** K15b、S2-1（ADR-0037）：影响面查询是一次性的——选中（种类或 ID）或视角变了即回到「不看」；任何动作之后统一判定，不靠各处记得清 */
function dropStaleQuery(prev: ViewState, next: ViewState): ViewState {
  if (!next.impactQuery) return next
  if (sameSelection(prev.selection, next.selection) && perspectiveOf(prev) === perspectiveOf(next)) return next
  return { ...next, impactQuery: null }
}

/** K15b：只在结构视角、选中模块时可设；与当前相同时不变 */
function queryImpact(state: ViewState, query: ViewState['impactQuery']): TransitionResult {
  const cur = state.impactQuery ?? null
  if (query && (perspectiveOf(state) !== 'structure' || state.selection?.kind !== 'module')) return { state, history: 'replace' }
  if (cur?.mode === query?.mode && !!cur?.types === !!query?.types) return { state, history: 'replace' }
  return { state: { ...state, impactQuery: query }, history: 'replace' }
}

function step(state: ViewState, action: ViewAction, ctx: TransitionContext): TransitionResult {
  const { index } = ctx
  // X7a：草图画布下打开场景、选中文件、代码事实与演化叠加、模型画布的层次导航为无效动作
  if (edit.blocked(state, action)) return { state, history: 'replace' }
  switch (action.type) {
    case 'enterEdit':
      return edit.enterEdit(state, ctx, action.target, action.level)
    case 'exitEdit':
      return edit.exitEdit(state)
    case 'edited':
      return edit.edited(state, index, action.effects, action.previousPath, action.level)
    case 'openSketch':
      return edit.openSketch(state, index, action.level)
    case 'restore':
      return restore(state, ctx, action.query)
    case 'reloaded': {
      const r = nav.reloaded(state, index, action.previousPath)
      return { ...r, state: pb.reloadedPlayback(r.state, ctx) }
    }
    // 导航即「指向」：运行视角下同样设定选中；下钻选中被下钻的模块（V3）
    case 'drill':
      return asPointing(state, nav.drill(state, index, action.id), action.id)
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
    case 'setMode':
      return setMode(state, ctx, action.mode)
    case 'openScenario':
      return pb.openScenario(state, ctx, action.id)
    case 'closeScenario':
      return pb.closeScenario(state)
    case 'next':
      return pb.next(state, ctx)
    case 'prev':
      return pb.prev(state, ctx)
    case 'seek':
      return pb.seek(state, ctx, action.frameId)
    case 'chooseBranch':
      return pb.chooseBranch(state, ctx, action.pointId, action.option)
    case 'hover':
      return { state: state.hover === action.id ? state : { ...state, hover: action.id }, history: 'replace' }
    case 'queryImpact':
      return queryImpact(state, action.query)
    case 'toggle':
      return nav.toggle(state, index, action.patch)
  }
}
