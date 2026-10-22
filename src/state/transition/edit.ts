/**
 * 编辑规则（X7a、X7h，ADR-0024）：进入 / 退出编辑态与互斥、离开确认、编辑改名与删除后层次与选中的跟随。
 * 纯函数；编辑会话本身（草图与撤销栈）不在视图状态里，在 DeskState 的编辑分组（desk/edit）。
 */
import { nearestExisting, type EditEffects, type ModelIndex, type SketchTarget } from '@/model'
import { withLevel } from './navigation'
import type { Selection, TransitionContext, TransitionResult, ViewAction, ViewState } from './types'

const replace = (state: ViewState): TransitionResult => ({ state, history: 'replace' })

export const isEditing = (state: ViewState): boolean => !!state.editing

/** X7a：编辑态下无效的动作——打开场景、选中文件、打开代码事实与演化叠加（草图不对应代码） */
export function blocked(state: ViewState, action: ViewAction): boolean {
  if (!state.editing) return false
  if (action.type === 'openScenario') return true
  if (action.type === 'select' || action.type === 'goTo') {
    const s = action.type === 'select' ? action.selection : action.select
    return s?.kind === 'file' || s?.kind === 'dep' || s?.kind === 'couple'
  }
  if (action.type === 'toggle') return 'showFacts' in action.patch || 'heat' in action.patch || 'coupling' in action.patch
  return false
}

/** X7a：只在草图版本上进入；进入时关闭场景、清掉文件选中，保留层次与模块选中 */
export function enterEdit(state: ViewState, ctx: TransitionContext, target: SketchTarget): TransitionResult {
  if (!ctx.editable || state.editing) return replace(state)
  const keep = state.selection && state.selection.kind !== 'file' && state.selection.kind !== 'dep' && state.selection.kind !== 'couple'
  return replace({ ...state, editing: target, playback: null, selection: keep ? state.selection : null })
}

export function exitEdit(state: ViewState): TransitionResult {
  return state.editing ? replace({ ...state, editing: null }) : replace(state)
}

/** X7a：有未保存改动时离开（切换版本、退出编辑、关闭页面）要确认 */
export const leaveGuard = (dirty: boolean): 'free' | 'confirm' => (dirty ? 'confirm' : 'free')

/**
 * X7h：编辑后的跟随——改名换成新 ID；当前层次被删除时退到最近仍存在的祖先、选中清空；选中的对象被删除时清空；
 * 新建模块或关系即选中它。index 为编辑后草图的索引；不进浏览器历史。
 */
export function edited(state: ViewState, index: ModelIndex, effects: EditEffects, previousPath: readonly string[]): TransitionResult {
  const rename = new Map(effects.renamed)
  const gone = new Set(effects.removed)
  const path = previousPath.map(id => rename.get(id) ?? id)
  const level = nearestExisting(index, path)
  let selection: Selection | null = state.selection
  if (selection) {
    const id = rename.get(selection.id) ?? selection.id
    selection = gone.has(selection.id) ? null : { ...selection, id }
  }
  const created = effects.created.find(id => index.modules.has(id) || index.relations.has(id))
  if (created) selection = index.modules.has(created) ? { kind: 'module', id: created } : { kind: 'relation', id: created }
  const next = withLevel(state, index, level, {
    select:
      selection && (selection.kind === 'module' ? index.modules.has(selection.id) : selection.kind === 'relation' ? index.relations.has(selection.id) : true)
        ? selection
        : null,
  })
  return replace(next)
}
