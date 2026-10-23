/**
 * 草图画布的会话规则（X7a、X7h，ADR-0024、ADR-0025）：进入草图即进入编辑画布（没有「查看态」）、与运行视角和文件选中互斥、
 * 层次只由当前张决定（下钻与面包屑返回不进浏览器历史）、离开确认、编辑后的跟随。
 * 纯函数；编辑会话本身（各张草图、当前张与设计级撤销栈）不在视图状态里，在 DeskState 的编辑分组（desk/edit）。
 */
import { nearestExisting, type EditEffects, type ModelIndex, type SketchTarget } from '@/model'
import { withLevel } from './navigation'
import type { Selection, TransitionContext, TransitionResult, ViewAction, ViewState } from './types'

const replace = (state: ViewState): TransitionResult => ({ state, history: 'replace' })

export const isEditing = (state: ViewState): boolean => !!state.editing

/**
 * X7a：草图画布下无效的动作——打开场景、选中文件 / 代码依赖 / 耦合线、打开代码事实与演化叠加（草图不对应代码）；
 * 模型画布的层次导航（下钻、返回上级、跳转、按 URL 恢复）：草图下的层次只由当前张决定，经 openSketch 切换。
 */
export function blocked(state: ViewState, action: ViewAction): boolean {
  if (!state.editing) return false
  switch (action.type) {
    case 'openScenario':
    case 'drill':
    case 'goUp':
    case 'revealModule':
    case 'revealRelation':
    case 'restore':
      return true
    case 'select':
      return badSelection(action.selection)
    case 'goTo':
      return action.id !== state.levelId || badSelection(action.select ?? null)
    case 'toggle':
      return 'showFacts' in action.patch || 'heat' in action.patch || 'coupling' in action.patch
    default:
      return false
  }
}

const badSelection = (s: Selection | null): boolean => s?.kind === 'file' || s?.kind === 'dep' || s?.kind === 'couple' || s?.kind === 'edge'

/** X7a：只在草图版本上进入；进入时关闭场景、清掉文件选中，层次换成当前张的挂载点，保留仍在的模块与关系选中 */
export function enterEdit(state: ViewState, ctx: TransitionContext, target: SketchTarget, level: string): TransitionResult {
  if (!ctx.editable) return replace(state)
  const { index } = ctx
  const lvl = index.modules.has(level) ? level : index.rootId
  const s = state.selection
  const keep = s && ((s.kind === 'module' && index.modules.has(s.id)) || (s.kind === 'relation' && index.relations.has(s.id)))
  return replace({ ...state, editing: target, playback: null, levelId: lvl, selection: keep ? s : null })
}

export function exitEdit(state: ViewState): TransitionResult {
  return state.editing ? replace({ ...state, editing: null }) : replace(state)
}

/** X7h：切到另一张草图（下钻、面包屑返回、升级后跟到父草图）：层次换成它的挂载点，选中清空；不进浏览器历史 */
export function openSketch(state: ViewState, index: ModelIndex, level: string): TransitionResult {
  if (!state.editing) return replace(state)
  const lvl = index.modules.has(level) ? level : index.rootId
  if (lvl === state.levelId) return replace(state)
  return replace({ ...state, levelId: lvl, selection: null, hover: null })
}

/** X7a：有未保存改动时离开（退出、切换版本、关闭页面）要确认 */
export const leaveGuard = (dirty: boolean): 'free' | 'confirm' => (dirty ? 'confirm' : 'free')

/**
 * X7h：编辑后的跟随——选中的被改名（含前缀级联）换成新 ID；被删除清空；新建、合并、拆分选中结果；
 * 层次为编辑后的当前张（它的挂载点被改名跟着换、被删除回到父草图——由会话给出），不在索引里时退到旧路径上最近仍存在的祖先。
 * index 为编辑后设计的索引；不进浏览器历史。
 */
export function edited(state: ViewState, index: ModelIndex, effects: EditEffects, previousPath: readonly string[], level: string): TransitionResult {
  const rename = new Map(effects.renamed)
  const gone = new Set(effects.removed)
  const lvl =
    index.modules.has(level) || level === index.rootId
      ? level
      : nearestExisting(
          index,
          previousPath.map(id => rename.get(id) ?? id),
        )
  let selection: Selection | null = state.selection
  if (selection) {
    const id = rename.get(selection.id) ?? selection.id
    selection = gone.has(selection.id) ? null : { ...selection, id }
  }
  const created = effects.created.find(id => index.modules.has(id) || index.relations.has(id))
  if (created) selection = index.modules.has(created) ? { kind: 'module', id: created } : { kind: 'relation', id: created }
  const exists = (s: Selection) => (s.kind === 'module' ? index.modules.has(s.id) : s.kind === 'relation' ? index.relations.has(s.id) : true)
  const next = withLevel(state, index, lvl, { select: selection && exists(selection) ? selection : null })
  return replace(next)
}
