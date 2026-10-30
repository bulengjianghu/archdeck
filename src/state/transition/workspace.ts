/**
 * 工作区规则（WS，ADR-0054）：资料区的标签、预览、分组、显隐与属性栏开关是一个值 WorkspaceState，
 * 只经纯函数 workspaceTransition 改变；与 ViewState 不互相约束（资料区不跟随选中，WS-8），不进 URL 与历史。
 * 属性栏并排还是悬浮由宽度推出（propsPlacement，WS-3），不存状态。
 */

/** 一份资料（WS-4）：时序图跟当前场景，只有一份；源代码按路径；图解按模块（第十七轮 W5） */
export type DocRef = { kind: 'sequence' } | { kind: 'source'; path: string; line?: number | null } | { kind: 'explainer'; module: string }

export interface DocTab {
  /** 资料的键（docKey），同一份资料只开一个标签 */
  id: string
  doc: DocRef
  /** 预览标签：会被下一次不固定的打开替换（WS-5） */
  preview: boolean
}

export interface DocGroup {
  tabs: DocTab[]
  active: string | null
}

export interface WorkspaceState {
  /** 一到两组，上下排列（WS-6） */
  groups: DocGroup[]
  /** 新资料进入的组 */
  focus: number
  /** 「▣ 资料」隐藏了资料区（标签保留，WS-7） */
  dockHidden: boolean
  /** 属性栏开关（WS-2） */
  propsOpen: boolean
}

export type WorkspaceAction =
  | { type: 'open'; doc: DocRef; pin?: boolean }
  | { type: 'activate'; group: number; id: string }
  | { type: 'pin'; group: number; id: string }
  | { type: 'close'; group: number; id: string }
  /** 在所有组里关掉这份资料（退出场景关时序图，WS-8） */
  | { type: 'closeDoc'; id: string }
  | { type: 'closeDock' }
  | { type: 'toggleDock' }
  | { type: 'split' }
  | { type: 'unsplit' }
  | { type: 'focusGroup'; group: number }
  | { type: 'setProps'; open: boolean }

export const EMPTY_WORKSPACE: WorkspaceState = { groups: [{ tabs: [], active: null }], focus: 0, dockHidden: false, propsOpen: true }

/** WS-2、WS-3：属性栏宽度与并排时画布至少要留的宽度（px） */
export const PROPS_WIDTH = 330
export const MIN_CANVAS = 620

export function docKey(doc: DocRef): string {
  return doc.kind === 'sequence' ? 'seq' : doc.kind === 'source' ? `src:${doc.path}` : `exp:${doc.module}`
}

export const hasTabs = (s: WorkspaceState) => s.groups.some(g => g.tabs.length > 0)

/** 资料区是否显示：有标签且没被「▣ 资料」隐藏 */
export const dockShown = (s: WorkspaceState) => hasTabs(s) && !s.dockHidden

/** WS-9：资料区从不显示变为显示（据此收起导航树） */
export const dockAppeared = (prev: WorkspaceState, next: WorkspaceState) => !dockShown(prev) && dockShown(next)

/** WS-3：工作列宽度放下属性栏后画布还能留 ≥ MIN_CANVAS 时并排，否则悬浮 */
export function propsPlacement(workWidth: number): 'docked' | 'floating' {
  return workWidth - PROPS_WIDTH >= MIN_CANVAS ? 'docked' : 'floating'
}

export function workspaceTransition(s: WorkspaceState, a: WorkspaceAction): WorkspaceState {
  switch (a.type) {
    case 'open':
      return open(s, a.doc, !!a.pin)
    case 'activate':
      return withGroup(s, a.group, g => (g.tabs.some(t => t.id === a.id) ? { ...g, active: a.id } : g), a.group)
    case 'pin':
      return withGroup(s, a.group, g => ({ ...g, tabs: g.tabs.map(t => (t.id === a.id ? { ...t, preview: false } : t)) }))
    case 'close':
      return close(s, a.group, a.id)
    case 'closeDoc': {
      let next = s
      for (let gi = next.groups.length - 1; gi >= 0; gi--) if (next.groups[gi].tabs.some(t => t.id === a.id)) next = close(next, gi, a.id)
      return next
    }
    case 'closeDock':
      return { ...s, groups: [{ tabs: [], active: null }], focus: 0, dockHidden: false }
    case 'toggleDock':
      return hasTabs(s) ? { ...s, dockHidden: !s.dockHidden } : s
    case 'split':
      return s.groups.length === 1 && s.groups[0].tabs.length ? { ...s, groups: [...s.groups, { tabs: [], active: null }], focus: 1 } : s
    case 'unsplit':
      return unsplit(s)
    case 'focusGroup':
      return a.group >= 0 && a.group < s.groups.length && a.group !== s.focus ? { ...s, focus: a.group } : s
    case 'setProps':
      return s.propsOpen === a.open ? s : { ...s, propsOpen: a.open }
  }
}

function withGroup(s: WorkspaceState, gi: number, f: (g: DocGroup) => DocGroup, focus = s.focus): WorkspaceState {
  const g = s.groups[gi]
  if (!g) return s
  const next = f(g)
  return next === g && focus === s.focus ? s : { ...s, groups: s.groups.map((x, k) => (k === gi ? next : x)), focus }
}

/** WS-4、WS-5：已开即激活（固定地打开则转固定、源代码更新目标行）；否则进焦点组，不固定时替换该组的预览标签 */
function open(s: WorkspaceState, doc: DocRef, pin: boolean): WorkspaceState {
  const id = docKey(doc)
  const shown = { ...s, dockHidden: false }
  const at = s.groups.findIndex(g => g.tabs.some(t => t.id === id))
  if (at >= 0) return withGroup(shown, at, g => ({ active: id, tabs: g.tabs.map(t => (t.id === id ? { id, doc, preview: t.preview && !pin } : t)) }), at)
  const gi = Math.min(s.focus, s.groups.length - 1)
  const tab: DocTab = { id, doc, preview: !pin }
  return withGroup(shown, gi, g => {
    const pv = pin ? -1 : g.tabs.findIndex(t => t.preview)
    const tabs = pv >= 0 ? g.tabs.map((t, k) => (k === pv ? tab : t)) : [...g.tabs, tab]
    return { tabs, active: id }
  })
}

/** WS-6、WS-7：关闭后激活同位置的右邻（没有则左邻）；下组空了即消失；最后一个标签关闭后资料区消失 */
function close(s: WorkspaceState, gi: number, id: string): WorkspaceState {
  const g = s.groups[gi]
  const k = g?.tabs.findIndex(t => t.id === id) ?? -1
  if (!g || k < 0) return s
  const tabs = g.tabs.filter(t => t.id !== id)
  const active = g.active !== id ? g.active : (tabs[k]?.id ?? tabs[k - 1]?.id ?? null)
  if (!tabs.length && s.groups.length > 1) return { ...s, groups: s.groups.filter((_, x) => x !== gi), focus: 0 }
  const next = { ...s, groups: s.groups.map((x, n) => (n === gi ? { tabs, active } : x)) }
  return hasTabs(next) ? next : { ...next, dockHidden: false }
}

/** WS-6：下组的标签按固定并回上组（已在上组的不重复） */
function unsplit(s: WorkspaceState): WorkspaceState {
  if (s.groups.length < 2) return s
  const [top, bottom] = s.groups
  const have = new Set(top.tabs.map(t => t.id))
  const moved = bottom.tabs.filter(t => !have.has(t.id)).map(t => ({ ...t, preview: false }))
  return { ...s, groups: [{ tabs: [...top.tabs, ...moved], active: top.active ?? bottom.active }], focus: 0 }
}
