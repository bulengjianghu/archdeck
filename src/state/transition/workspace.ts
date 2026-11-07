/**
 * 工作区规则（LY，ADR-0064）：视图区的排布（两组的标签序列、各组激活标签、分隔比例）、视图区与侧栏的开合与宽度是一个值
 * WorkspaceState，只经纯函数 workspaceTransition 改变；每次转移之后统一 normalize（常驻、至多两组、空组合并）。
 * 标签分两类（LY-8）：视图标签（图解、描述、核对、时序图）按类型各一个、内容随主语变——这里只记「有哪几个、摆在哪」，
 * 内容是（主语, 标签类型）的纯函数，不在工作区里；资料标签（源代码、对话、设计说明）不跟随主语。
 * 缺省排布由情境推出（LY-11，defaultArrangement），人改过的排布按情境记进 memory（LY-11b），由同步适配器读写本机。
 * 与 ViewState 不互相约束（情境由协调者从视图状态推出后经 setContext 告知），不进 URL 与历史。
 */

/**
 * 资料（LY-8 的资料标签）：源代码按路径；对话一个项目一份（DA-1）；设计说明按文件（DL-10）。
 * 种类可扩展（DL-5）：加一种 kind 只动这个联合、DOC_KEYS 里的一行（可省，缺省按 kind 与其余字段推出键）与呈现层的种类表（dock/docKinds.ts）。
 */
export type DocRef =
  | { kind: 'source'; path: string; line?: number | null }
  | { kind: 'dialogue' }
  /** DA-10、DL-10：设计说明（designs/<设计>/notes/<名>.md）的预览标签 */
  | { kind: 'note'; file: string }

/** LY-8：视图标签——看主语的四个角度 */
export type ViewKind = 'explainer' | 'description' | 'check' | 'sequence'
export const VIEW_KINDS: readonly ViewKind[] = ['explainer', 'description', 'check', 'sequence']

export type Tab =
  | { id: string; kind: 'view'; view: ViewKind }
  /** preview：预览标签，会被下一次不固定的打开替换（LY-8a） */
  | { id: string; kind: 'doc'; doc: DocRef; preview: boolean }

export interface TabGroup {
  tabs: Tab[]
  active: string | null
}

/** LY-11：情境——自由、场景（回放中）、草图编辑；优先级 草图 > 场景 > 自由（LY-11c） */
export type LayoutContext = 'free' | 'scenario' | 'sketch'
export const LAYOUT_CONTEXTS: readonly LayoutContext[] = ['free', 'scenario', 'sketch']

/** 排布里的一格：视图标签，或对话（草图情境的缺省排布里有它，LY-11） */
export type Slot = ViewKind | 'dialogue'

/** 一个情境的排布（本机记忆的单位，LY-11b）：各组的格子次序、各组激活的格子、分隔比例 */
export interface Arrangement {
  groups: Slot[][]
  active: (Slot | null)[]
  split: number
}

export interface SidebarState {
  open: boolean
  /** px（LY-10b） */
  width: number
}

export interface WorkspaceState {
  context: LayoutContext
  /** 一到两组，上下排列（LY-10） */
  groups: TabGroup[]
  /** 上组所占比例（LY-10b） */
  split: number
  /** 视图区整体收起（LY-12） */
  collapsed: boolean
  /** 视图区占项目视图宽度的比例（LY-10b） */
  width: number
  /** LY-3 */
  sidebar: SidebarState
  /** 人改过的各情境排布（LY-11、LY-11b） */
  memory: Partial<Record<LayoutContext, Arrangement>>
}

export type WorkspaceAction =
  /** 打开资料：已开即激活（固定地打开则转固定、源代码更新目标行）；否则进上组，不固定时替换该组的预览标签（LY-8a、LY-10a） */
  | { type: 'open'; doc: DocRef; pin?: boolean }
  | { type: 'activate'; id: string }
  | { type: 'pin'; id: string }
  /** 关闭一个标签；常驻标签无效（LY-9、LY-9a） */
  | { type: 'close'; id: string }
  /** 拖拽：移到第 group 组的第 index 位；group 等于组数即开下组（LY-10） */
  | { type: 'move'; id: string; group: number; index: number }
  /** 「+」：加一个视图标签到第 group 组（已开即激活它，LY-9、LY-10a） */
  | { type: 'addView'; view: ViewKind; group: number }
  | { type: 'setSplit'; split: number }
  | { type: 'setContext'; context: LayoutContext }
  | { type: 'setCollapsed'; collapsed: boolean }
  | { type: 'setWidth'; width: number }
  | { type: 'setSidebar'; open?: boolean; width?: number }
  /** 同步适配器读到的本机记忆（启动时一次）：人改过的排布、视图区收起、宽度、侧栏 */
  | { type: 'restore'; memory: Partial<Record<LayoutContext, Arrangement>>; collapsed?: boolean; width?: number; sidebar?: SidebarState }

/** LY-10b：取值范围与缺省 */
export const SPLIT_RANGE = [0.2, 0.8] as const
export const WIDTH_RANGE = [0.2, 0.75] as const
export const SIDEBAR_RANGE = [200, 400] as const
export const DEFAULT_WIDTH = 0.44
export const DEFAULT_SIDEBAR_WIDTH = 240
/** LY-3：没有本机记忆时，窗口宽 ≥ 1440 侧栏缺省展开 */
export const SIDEBAR_OPEN_MIN = 1440
export const defaultSidebarOpen = (windowWidth: number) => windowWidth >= SIDEBAR_OPEN_MIN

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v))

/** LY-11：缺省排布表——加一种情境只加一行 */
export const DEFAULT_ARRANGEMENTS: Readonly<Record<LayoutContext, Arrangement>> = {
  free: { groups: [['explainer', 'description', 'check']], active: ['explainer'], split: 0.58 },
  scenario: { groups: [['sequence', 'explainer', 'check'], ['description']], active: ['sequence', 'description'], split: 0.56 },
  sketch: { groups: [['dialogue', 'explainer'], ['description']], active: ['dialogue', 'description'], split: 0.6 },
}

export const defaultArrangement = (context: LayoutContext): Arrangement => DEFAULT_ARRANGEMENTS[context]

/** 已有种类的键（沿用旧键：E2E 认它们）；不在表里的种类按 genericDocKey 推出 */
const DOC_KEYS: Record<string, (doc: never) => string> = {
  source: (d: { path: string }) => `src:${d.path}`,
  dialogue: () => 'dlg',
}

/** DL-5：缺省键 = 种类 + 除定位行号外的其余字段（按字段名排序），同一份资料同一个键 */
export function genericDocKey(doc: { kind: string } & Record<string, unknown>): string {
  const rest = Object.keys(doc)
    .filter(k => k !== 'kind' && k !== 'line')
    .sort()
    .map(k => String(doc[k]))
  return [doc.kind, ...rest].join(':')
}

export function docKey(doc: DocRef): string {
  const f = DOC_KEYS[doc.kind] as ((d: DocRef) => string) | undefined
  return f ? f(doc) : genericDocKey(doc as unknown as { kind: string } & Record<string, unknown>)
}

/** 视图标签的键（每类一个） */
export const viewKey = (view: ViewKind) => `view:${view}`

const viewTab = (view: ViewKind): Tab => ({ id: viewKey(view), kind: 'view', view })
const DIALOGUE: DocRef = { kind: 'dialogue' }
const slotTab = (slot: Slot): Tab => (slot === 'dialogue' ? { id: docKey(DIALOGUE), kind: 'doc', doc: DIALOGUE, preview: false } : viewTab(slot))
const slotOf = (t: Tab): Slot | null => (t.kind === 'view' ? t.view : t.doc.kind === 'dialogue' ? 'dialogue' : null)

/** LY-9：常驻标签——图解始终；时序图在场景情境 */
export function isResident(s: Pick<WorkspaceState, 'context'>, id: string): boolean {
  return id === viewKey('explainer') || (id === viewKey('sequence') && s.context === 'scenario')
}

/** 视图标签在这个情境里可不可以出现（时序图只在场景里，LY-9） */
const allowed = (context: LayoutContext, t: Tab) => !(t.kind === 'view' && t.view === 'sequence' && context !== 'scenario')

export const findTab = (s: WorkspaceState, id: string): { group: number; index: number } | null => {
  for (let g = 0; g < s.groups.length; g++) {
    const index = s.groups[g].tabs.findIndex(t => t.id === id)
    if (index >= 0) return { group: g, index }
  }
  return null
}

export const hasTab = (s: WorkspaceState, id: string) => findTab(s, id) !== null

/** 这个排布的格子按情境铺成标签组（资料标签另行保留，见 relayout） */
function groupsOf(a: Arrangement, context: LayoutContext): TabGroup[] {
  const groups = a.groups.slice(0, 2).map((slots, g) => {
    const tabs = slots.map(slotTab).filter(t => allowed(context, t))
    const want = a.active[g]
    const active = want ? (tabs.find(t => slotOf(t) === want)?.id ?? null) : null
    return { tabs, active }
  })
  return groups.length ? groups : [{ tabs: [], active: null }]
}

/** 当前组的排布（只记视图标签与对话，LY-11b） */
export function arrangementOf(s: WorkspaceState): Arrangement {
  const groups = s.groups.map(g => g.tabs.map(slotOf).filter((x): x is Slot => x !== null))
  const active = s.groups.map(g => {
    const t = g.tabs.find(x => x.id === g.active)
    return t ? slotOf(t) : null
  })
  return { groups, active, split: s.split }
}

/**
 * LY-9、LY-10：规整——去重；图解常驻（不在就放回上组最前）；时序图在场景情境常驻（不在就放回上组最前）、其他情境移出；
 * 空组与另一组合并、至多两组、至少一组；激活标签无效时取该组第一个。没有变化时返回原状态。
 */
export function normalize(s: WorkspaceState): WorkspaceState {
  const seen = new Set<string>()
  let groups = s.groups.map(g => {
    const tabs = g.tabs.filter(t => allowed(s.context, t) && !seen.has(t.id) && seen.add(t.id))
    return { tabs, active: g.active }
  })
  if (groups.length > 2) groups = [groups[0], { tabs: groups.slice(1).flatMap(g => g.tabs), active: groups[1].active }]
  if (!groups.length) groups = [{ tabs: [], active: null }]
  const ensure = (view: ViewKind) => {
    if (seen.has(viewKey(view))) return
    seen.add(viewKey(view))
    groups[0] = { ...groups[0], tabs: [viewTab(view), ...groups[0].tabs] }
  }
  if (s.context === 'scenario') ensure('sequence')
  ensure('explainer')
  groups = groups.filter(g => g.tabs.length)
  if (!groups.length) groups = [{ tabs: [], active: null }]
  groups = groups.map(g => (g.tabs.some(t => t.id === g.active) ? g : { ...g, active: g.tabs[0]?.id ?? null }))
  return sameGroups(s.groups, groups) ? s : { ...s, groups }
}

function sameGroups(a: TabGroup[], b: TabGroup[]): boolean {
  return (
    a.length === b.length && a.every((g, k) => g.active === b[k].active && g.tabs.length === b[k].tabs.length && g.tabs.every((t, i) => t === b[k].tabs[i]))
  )
}

/** 新状态：给定情境的缺省（或记下的）排布 */
export function initialWorkspace(context: LayoutContext = 'free', memory: WorkspaceState['memory'] = {}): WorkspaceState {
  const a = memory[context] ?? defaultArrangement(context)
  return normalize({
    context,
    groups: groupsOf(a, context),
    split: clamp(a.split, SPLIT_RANGE),
    collapsed: false,
    width: DEFAULT_WIDTH,
    sidebar: { open: false, width: DEFAULT_SIDEBAR_WIDTH },
    memory,
  })
}

export const EMPTY_WORKSPACE: WorkspaceState = initialWorkspace()

/**
 * LY-11、LY-11b：换情境——视图标签与对话按新情境记下的（没有则缺省的）排布重摆；
 * 资料标签（对话除外）留在原来的组，那一组不存在时并入上组；保留下来的资料标签若原本激活，仍激活。
 */
function relayout(s: WorkspaceState, context: LayoutContext): WorkspaceState {
  const a = s.memory[context] ?? defaultArrangement(context)
  const groups = groupsOf(a, context)
  s.groups.forEach((g, gi) => {
    const keep = g.tabs.filter(t => slotOf(t) === null)
    if (!keep.length) return
    const at = Math.min(gi, groups.length - 1)
    groups[at] = { tabs: [...groups[at].tabs, ...keep], active: keep.some(t => t.id === g.active) ? g.active : groups[at].active }
  })
  return normalize({ ...s, context, groups, split: clamp(a.split, SPLIT_RANGE) })
}

/** 人改了排布：按当前情境记下（LY-11） */
const remember = (s: WorkspaceState): WorkspaceState => ({ ...s, memory: { ...s.memory, [s.context]: arrangementOf(s) } })

function withGroups(s: WorkspaceState, groups: TabGroup[]): WorkspaceState {
  return normalize({ ...s, groups })
}

export function workspaceTransition(s: WorkspaceState, a: WorkspaceAction): WorkspaceState {
  switch (a.type) {
    case 'open':
      return open(s, a.doc, !!a.pin)
    case 'activate': {
      const at = findTab(s, a.id)
      if (!at || s.groups[at.group].active === a.id) return s
      return { ...s, groups: s.groups.map((g, k) => (k === at.group ? { ...g, active: a.id } : g)) }
    }
    case 'pin': {
      const at = findTab(s, a.id)
      const t = at && s.groups[at.group].tabs[at.index]
      if (!at || !t || t.kind !== 'doc' || !t.preview) return s
      return { ...s, groups: s.groups.map((g, k) => (k === at.group ? { ...g, tabs: g.tabs.map(x => (x === t ? { ...t, preview: false } : x)) } : g)) }
    }
    case 'close': {
      const next = close(s, a.id)
      return next === s ? s : remember(next)
    }
    case 'move': {
      const next = move(s, a.id, a.group, a.index)
      return next === s ? s : remember(next)
    }
    case 'addView': {
      const next = addView(s, a.view, a.group)
      return next === s ? s : remember(next)
    }
    case 'setSplit': {
      const split = clamp(a.split, SPLIT_RANGE)
      return split === s.split ? s : remember({ ...s, split })
    }
    case 'setContext':
      return a.context === s.context ? s : relayout(s, a.context)
    case 'setCollapsed':
      return a.collapsed === s.collapsed ? s : { ...s, collapsed: a.collapsed }
    case 'setWidth': {
      const width = clamp(a.width, WIDTH_RANGE)
      return width === s.width ? s : { ...s, width }
    }
    case 'setSidebar': {
      const open = a.open ?? s.sidebar.open
      const width = a.width === undefined ? s.sidebar.width : clamp(a.width, SIDEBAR_RANGE)
      return open === s.sidebar.open && width === s.sidebar.width ? s : { ...s, sidebar: { open, width } }
    }
    case 'restore': {
      const restored: WorkspaceState = {
        ...s,
        memory: a.memory,
        collapsed: a.collapsed ?? s.collapsed,
        width: a.width === undefined ? s.width : clamp(a.width, WIDTH_RANGE),
        sidebar: a.sidebar ? { open: a.sidebar.open, width: clamp(a.sidebar.width, SIDEBAR_RANGE) } : s.sidebar,
      }
      return relayout(restored, s.context)
    }
  }
}

/** LY-8a、LY-10a：已开即激活（固定地打开则转固定、源代码更新目标行）；否则进上组，不固定时替换该组的预览标签 */
function open(s: WorkspaceState, doc: DocRef, pin: boolean): WorkspaceState {
  const id = docKey(doc)
  const at = findTab(s, id)
  if (at)
    return {
      ...s,
      groups: s.groups.map((g, k) =>
        k === at.group ? { active: id, tabs: g.tabs.map(t => (t.id === id && t.kind === 'doc' ? { ...t, doc, preview: t.preview && !pin } : t)) } : g,
      ),
    }
  const tab: Tab = { id, kind: 'doc', doc, preview: !pin }
  const g = s.groups[0]
  const pv = pin ? -1 : g.tabs.findIndex(t => t.kind === 'doc' && t.preview)
  const tabs = pv >= 0 ? g.tabs.map((t, k) => (k === pv ? tab : t)) : [...g.tabs, tab]
  return withGroups(s, [{ tabs, active: id }, ...s.groups.slice(1)])
}

/** LY-9a、LY-10：关闭后激活同位置的右邻（没有则左邻）；常驻标签不可关；一组空了即合并 */
function close(s: WorkspaceState, id: string): WorkspaceState {
  if (isResident(s, id)) return s
  const at = findTab(s, id)
  if (!at) return s
  const g = s.groups[at.group]
  const tabs = g.tabs.filter(t => t.id !== id)
  const active = g.active !== id ? g.active : (tabs[at.index]?.id ?? tabs[at.index - 1]?.id ?? null)
  return withGroups(
    s,
    s.groups.map((x, k) => (k === at.group ? { tabs, active } : x)),
  )
}

/** LY-10：移到第 group 组第 index 位（group = 组数时开下组）；移动后激活它；原组空了即合并 */
function move(s: WorkspaceState, id: string, group: number, index: number): WorkspaceState {
  const at = findTab(s, id)
  if (!at || group < 0 || group > Math.min(s.groups.length, 1)) return s
  const tab = s.groups[at.group].tabs[at.index]
  // 开下组：只有一组、且那组还有别的标签时才成立（否则拖空即合并，原样）
  if (group === s.groups.length && s.groups[0].tabs.length < 2) return s
  const groups = s.groups.map(g => ({ ...g, tabs: g.tabs.filter(t => t.id !== id) }))
  if (group === groups.length) groups.push({ tabs: [], active: null })
  const target = groups[group]
  const i = Math.max(0, Math.min(index - (at.group === group && at.index < index ? 1 : 0), target.tabs.length))
  if (at.group === group && i === at.index)
    return s.groups[group].active === id ? s : { ...s, groups: s.groups.map((g, k) => (k === group ? { ...g, active: id } : g)) }
  target.tabs = [...target.tabs.slice(0, i), tab, ...target.tabs.slice(i)]
  target.active = id
  const src = groups[at.group]
  if (at.group !== group && src.active === id) src.active = src.tabs[at.index]?.id ?? src.tabs[at.index - 1]?.id ?? null
  return withGroups(s, groups)
}

/** LY-9、LY-10a：「+」加视图标签——已开即激活；时序图只在场景情境 */
function addView(s: WorkspaceState, view: ViewKind, group: number): WorkspaceState {
  const id = viewKey(view)
  if (hasTab(s, id)) return workspaceTransition(s, { type: 'activate', id })
  if (!allowed(s.context, viewTab(view))) return s
  const gi = Math.max(0, Math.min(group, s.groups.length - 1))
  return withGroups(
    s,
    s.groups.map((g, k) => (k === gi ? { tabs: [...g.tabs, viewTab(view)], active: id } : g)),
  )
}

/** LY-11c：情境由视图状态与编辑会话推出 */
export const layoutContextOf = (scenario: boolean, sketching: boolean): LayoutContext => (sketching ? 'sketch' : scenario ? 'scenario' : 'free')

/** 校验本机读回的排布（形状不对的丢弃，按缺省） */
export function validArrangement(raw: unknown): Arrangement | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Partial<Arrangement>
  const slot = (x: unknown): x is Slot => x === 'dialogue' || VIEW_KINDS.includes(x as ViewKind)
  if (!Array.isArray(a.groups) || !a.groups.length || a.groups.length > 2 || !a.groups.every(g => Array.isArray(g) && g.every(slot))) return null
  if (!Array.isArray(a.active) || !a.active.every(x => x === null || slot(x))) return null
  if (typeof a.split !== 'number' || !Number.isFinite(a.split)) return null
  return { groups: a.groups.map(g => [...g]), active: a.groups.map((_, k) => a.active![k] ?? null), split: clamp(a.split, SPLIT_RANGE) }
}
