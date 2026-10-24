/**
 * 导航规则（N1–N13）：层次与选中怎么变、进不进浏览器历史。纯函数。
 * 「重新加载后退到哪」等关于被描述系统的问题交给模型层的架构查询（nearestExisting、lowestCommonAncestor）。
 */
import { lowestCommonAncestor, nearestExisting, nearestVisibleLevel, type ModelIndex, coupleEnds } from '@/model'
import type { Selection, Toggles, TransitionResult, ViewAction, ViewState } from './types'

/** 选中的对象在本模型中是否存在；视图边按 ID 规则重算、文件不在模型里（G16，由面板提示），总视为存在 */
export function selectionExists(index: ModelIndex, s: Selection | null): s is Selection {
  if (!s) return false
  switch (s.kind) {
    case 'module':
      return index.modules.has(s.id) || s.id === index.rootId
    case 'relation':
      return index.relations.has(s.id)
    case 'actor':
      return index.actors.has(s.id)
    case 'edge':
    case 'file':
      return true
    case 'dep': {
      // K10：两端都是存在的模块或参与者
      const ends = s.id.split('->')
      return ends.length === 2 && ends.every(id => index.modules.has(id) || index.actors.has(id))
    }
    // L13、V2：端口就是接口
    case 'port':
      return index.interfaces.has(s.id)
    case 'couple': {
      // J7：两端都是存在的模块
      const ends = coupleEnds(s.id)
      return !!ends && ends.every(id => index.modules.has(id))
    }
  }
}

interface LevelOptions {
  /** 给出时直接设为新的选中 */
  select?: Selection | null
  /** 未给 select 时：保留仍存在的选中（N5），否则清空（N2） */
  keepSelection?: boolean
}

/** 切换层次；不存在的层次回到根。切换后清空悬停 */
export function withLevel(state: ViewState, index: ModelIndex, id: string, opts: LevelOptions = {}): ViewState {
  const levelId = index.pathOf.has(id) ? id : index.rootId
  const selection = opts.select !== undefined ? opts.select : opts.keepSelection && selectionExists(index, state.selection) ? state.selection : null
  return { ...state, levelId, selection, hover: levelId === state.levelId ? state.hover : null }
}

const push = (state: ViewState): TransitionResult => ({ state, history: 'push' })
const replace = (state: ViewState): TransitionResult => ({ state, history: 'replace' })

/** N1、N2：只有有子模块的模块可下钻，下钻后清空选中 */
export function drill(state: ViewState, index: ModelIndex, id: string): TransitionResult {
  if ((index.childrenOf.get(id) ?? []).length === 0) return replace(state)
  return push(withLevel(state, index, id))
}

/** 跳到某层次（面包屑、跳到场景所在层次……），可同时设定选中；N10：层次改变才进历史 */
export function goTo(state: ViewState, index: ModelIndex, id: string, select?: Selection | null): TransitionResult {
  const next = withLevel(state, index, id, { select })
  return next.levelId === state.levelId ? replace(next) : push(next)
}

/** N8：返回上级时选中刚离开的模块 */
export function goUp(state: ViewState, index: ModelIndex): TransitionResult {
  const path = index.pathOf.get(state.levelId) ?? []
  if (path.length <= 1) return replace(state)
  return goTo(state, index, path[path.length - 2], { kind: 'module', id: path[path.length - 1] })
}

/** N13：选中只替换地址（N10）；选 null 即取消选中 */
export function select(state: ViewState, selection: Selection | null): TransitionResult {
  return replace({ ...state, selection })
}

/** N3：定位关系——跳到两端的最近公共祖先并选中 */
export function revealRelation(state: ViewState, index: ModelIndex, id: string): TransitionResult {
  const r = index.relations.get(id)
  if (!r) return replace(state)
  return goTo(state, index, lowestCommonAncestor(index, r.from, r.to), { kind: 'relation', id })
}

/** N4：定位模块——跳到其父模块并选中 */
export function revealModule(state: ViewState, index: ModelIndex, id: string): TransitionResult {
  const m = index.modules.get(id)
  if (!m) return replace(state)
  return goTo(state, index, m.parentId, { kind: 'module', id })
}

/** N5、N11：重新加载保留层次与选中；层次失效退到最近仍存在的祖先，选中失效则清空 */
export function reloaded(state: ViewState, index: ModelIndex, previousPath: readonly string[]): TransitionResult {
  return replace(withLevel(state, index, nearestExisting(index, previousPath), { keepSelection: true }))
}

/** 显示开关；N12：「只看现状」隐藏了当前层次时退到最近的可见层次 */
export function toggle(state: ViewState, index: ModelIndex, patch: Partial<Toggles>): TransitionResult {
  const toggles = { ...state.toggles, ...patch }
  const next = { ...state, toggles }
  const level = state.levelId ? nearestVisibleLevel(index, state.levelId, toggles) : state.levelId
  return replace(level === state.levelId ? next : withLevel(next, index, level, { keepSelection: true }))
}

/** 键盘意图：N9 Esc 只取消选中，无选中时无动作；N7 Backspace 返回上级，根层回项目列表（'leave'） */
export function keyIntent(state: ViewState, index: ModelIndex, key: string): ViewAction | 'leave' | null {
  const atRoot = (index.pathOf.get(state.levelId) ?? []).length <= 1
  if (key === 'Escape') return state.selection ? { type: 'select', selection: null } : null
  // X7a：编辑态下 Backspace 留给删除选中对象，不返回上级
  if (key === 'Backspace') return state.editing ? null : atRoot ? 'leave' : { type: 'goUp' }
  return null
}
