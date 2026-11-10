/** 工作区规则（LY-3、LY-8–LY-12 与细化的「议」，ADR-0064）：视图区排布与开合是一个值，纯函数穷举 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ARRANGEMENTS,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_WIDTH,
  EMPTY_WORKSPACE,
  arrangementOf,
  defaultSidebarOpen,
  initialWorkspace,
  isResident,
  layoutContextOf,
  normalize,
  validArrangement,
  viewKey,
  workspaceTransition,
  type DocRef,
  type WorkspaceAction,
  type WorkspaceState,
} from '../../src/state/transition'

const src = (path: string, line?: number): DocRef => ({ kind: 'source', path, ...(line ? { line } : {}) })
const run = (s: WorkspaceState, ...actions: WorkspaceAction[]) => actions.reduce(workspaceTransition, s)
/** 各组的标签键；视图标签写类型名，预览的资料标签带 ~ */
const groups = (s: WorkspaceState) => s.groups.map(g => g.tabs.map(t => (t.kind === 'view' ? t.view : `${t.id}${t.preview ? '~' : ''}`)))
const actives = (s: WorkspaceState) => s.groups.map(g => g.active)
const V = viewKey

describe('LY-11 缺省排布由情境推出', () => {
  it('自由 = 上〔图解 描述 核对〕，图解激活', () => {
    expect(groups(EMPTY_WORKSPACE)).toEqual([['explainer', 'description', 'check']])
    expect(actives(EMPTY_WORKSPACE)).toEqual([V('explainer')])
    expect(EMPTY_WORKSPACE.context).toBe('free')
  })
  it('场景 = 上〔时序图〕下〔图解 描述 核对〕，时序图与图解激活，约 46/54（负责人 2026-11-08 走查）', () => {
    const s = run(EMPTY_WORKSPACE, { type: 'setContext', context: 'scenario' })
    expect(groups(s)).toEqual([['sequence'], ['explainer', 'description', 'check']])
    expect(actives(s)).toEqual([V('sequence'), V('explainer')])
    expect(s.split).toBe(0.46)
  })
  it('LY-11a、LY-11d 草图编辑 = 上〔对话 图解〕下〔描述 核对〕，对话固定、激活', () => {
    const s = run(EMPTY_WORKSPACE, { type: 'setContext', context: 'sketch' })
    expect(groups(s)).toEqual([
      ['dlg', 'explainer'],
      ['description', 'check'],
    ])
    expect(actives(s)).toEqual(['dlg', V('description')])
  })
  it('回到自由情境即回到自由的排布；同一情境无动作', () => {
    const s = run(EMPTY_WORKSPACE, { type: 'setContext', context: 'scenario' }, { type: 'setContext', context: 'free' })
    expect(groups(s)).toEqual(groups(EMPTY_WORKSPACE))
    expect(workspaceTransition(s, { type: 'setContext', context: 'free' })).toBe(s)
  })
  it('LY-11c 情境优先级：草图 > 场景 > 自由', () => {
    expect(layoutContextOf(false, false)).toBe('free')
    expect(layoutContextOf(true, false)).toBe('scenario')
    expect(layoutContextOf(true, true)).toBe('sketch')
    expect(layoutContextOf(false, true)).toBe('sketch')
  })
  it('人改过的排布按情境分别记下，再进这个情境即用它；别的情境不受影响', () => {
    const changed = run(EMPTY_WORKSPACE, { type: 'move', id: V('description'), group: 1, index: 0 })
    expect(changed.memory.free).toEqual({ groups: [['explainer', 'check'], ['description']], active: ['explainer', 'description'], split: 0.58 })
    const back = run(changed, { type: 'setContext', context: 'scenario' }, { type: 'setContext', context: 'free' })
    expect(groups(back)).toEqual([['explainer', 'check'], ['description']])
    const sc = run(changed, { type: 'setContext', context: 'scenario' })
    expect(groups(sc)).toEqual(groups(run(EMPTY_WORKSPACE, { type: 'setContext', context: 'scenario' })))
  })
  it('只是打开资料、换激活不算改排布，不记', () => {
    const s = run(EMPTY_WORKSPACE, { type: 'open', doc: src('a.ts') }, { type: 'activate', id: V('check') })
    expect(s.memory).toEqual({})
  })
  it('LY-11b 换情境时资料标签留在原组（原组不存在时并入上组），原本激活的仍激活', () => {
    const s = run(EMPTY_WORKSPACE, { type: 'setContext', context: 'scenario' }, { type: 'open', doc: src('a.ts'), pin: true })
    expect(groups(s)[0]).toContain('src:a.ts')
    const free = run(s, { type: 'setContext', context: 'free' })
    expect(groups(free)).toEqual([['explainer', 'description', 'check', 'src:a.ts']])
    expect(actives(free)).toEqual(['src:a.ts'])
  })
  it('LY-11b 记忆只记视图标签与对话，不记资料标签', () => {
    const s = run(EMPTY_WORKSPACE, { type: 'open', doc: src('a.ts'), pin: true }, { type: 'move', id: V('check'), group: 0, index: 0 })
    expect(s.memory.free?.groups).toEqual([['check', 'explainer', 'description']])
    expect(s.memory.free?.active).toEqual(['check'])
  })
})

describe('LY-9 常驻（负责人 2026-11-08 走查修订）', () => {
  it('图解、描述、核对始终常驻、不可关；时序图在场景情境常驻', () => {
    for (const v of ['explainer', 'description', 'check'] as const) {
      expect(isResident(EMPTY_WORKSPACE, V(v))).toBe(true)
      expect(workspaceTransition(EMPTY_WORKSPACE, { type: 'close', id: V(v) })).toBe(EMPTY_WORKSPACE)
    }
    expect(isResident(EMPTY_WORKSPACE, V('sequence'))).toBe(false)
    expect(isResident({ context: 'scenario' }, V('sequence'))).toBe(true)
    const sc = run(EMPTY_WORKSPACE, { type: 'setContext', context: 'scenario' })
    expect(workspaceTransition(sc, { type: 'close', id: V('sequence') })).toBe(sc)
    expect(isResident(EMPTY_WORKSPACE, 'src:a.ts')).toBe(false)
  })
  it('LY-9a 退出场景时时序图移出；资料标签照样可关', () => {
    const s = run(EMPTY_WORKSPACE, { type: 'setContext', context: 'scenario' }, { type: 'setContext', context: 'free' })
    expect(groups(s).flat()).not.toContain('sequence')
    const doc = run(EMPTY_WORKSPACE, { type: 'open', doc: src('a.ts'), pin: true }, { type: 'close', id: 'src:a.ts' })
    expect(groups(doc)).toEqual(groups(EMPTY_WORKSPACE))
  })
  it('规整：丢了的图解 / 时序图放回上组最前，丢了的描述 / 核对放回末组最后；不该在的时序图移出', () => {
    const bare: WorkspaceState = { ...EMPTY_WORKSPACE, groups: [{ tabs: [], active: null }] }
    expect(groups(normalize(bare))).toEqual([['explainer', 'description', 'check']])
    const sc = normalize({ ...bare, context: 'scenario' })
    expect(groups(sc)).toEqual([['explainer', 'sequence', 'description', 'check']])
    const two = normalize({
      ...EMPTY_WORKSPACE,
      groups: [
        { tabs: [], active: null },
        { tabs: [{ id: 'dlg', kind: 'doc', doc: { kind: 'dialogue' }, preview: false }], active: 'dlg' },
      ],
    })
    expect(groups(two)).toEqual([['explainer'], ['dlg', 'description', 'check']])
    const stray = normalize({
      ...EMPTY_WORKSPACE,
      groups: [{ tabs: [...EMPTY_WORKSPACE.groups[0].tabs, { id: V('sequence'), kind: 'view', view: 'sequence' }], active: V('sequence') }],
    })
    expect(groups(stray)).toEqual([['explainer', 'description', 'check']])
    expect(actives(stray)).toEqual([V('explainer')])
  })
})

describe('LY-8 两类标签', () => {
  it('视图标签按类型各一个：规整去重', () => {
    const t = EMPTY_WORKSPACE.groups[0].tabs[2]
    const s = normalize({ ...EMPTY_WORKSPACE, groups: [{ tabs: [...EMPTY_WORKSPACE.groups[0].tabs, t], active: t.id }] })
    expect(groups(s)[0].filter(x => x === 'check')).toHaveLength(1)
  })
  it('资料标签每份一个：再打开只激活它，源代码更新目标行', () => {
    const s = run(
      EMPTY_WORKSPACE,
      { type: 'open', doc: src('a.ts'), pin: true },
      { type: 'open', doc: src('b.ts'), pin: true },
      { type: 'open', doc: src('a.ts', 12) },
    )
    expect(groups(s)).toEqual([['explainer', 'description', 'check', 'src:a.ts', 'src:b.ts']])
    expect(actives(s)).toEqual(['src:a.ts'])
    const t = s.groups[0].tabs.find(x => x.id === 'src:a.ts')
    expect(t?.kind === 'doc' && t.doc).toEqual(src('a.ts', 12))
  })
  it('LY-8a 预览：不固定地打开替换该组的预览标签；固定地打开或双击即固定；视图标签没有预览', () => {
    const s = run(EMPTY_WORKSPACE, { type: 'open', doc: src('a.ts') }, { type: 'open', doc: src('b.ts') })
    expect(groups(s)[0].slice(3)).toEqual(['src:b.ts~'])
    const pinned = run(s, { type: 'pin', id: 'src:b.ts' }, { type: 'open', doc: src('c.ts') })
    expect(groups(pinned)[0].slice(3)).toEqual(['src:b.ts', 'src:c.ts~'])
    const viaOpen = run(pinned, { type: 'open', doc: src('c.ts'), pin: true })
    expect(groups(viaOpen)[0].slice(3)).toEqual(['src:b.ts', 'src:c.ts'])
    expect(workspaceTransition(EMPTY_WORKSPACE, { type: 'pin', id: V('description') })).toBe(EMPTY_WORKSPACE)
  })
  it('LY-10a 新资料进上组；已开在下组时激活它所在的组', () => {
    const split = run(EMPTY_WORKSPACE, { type: 'move', id: V('check'), group: 1, index: 0 }, { type: 'open', doc: src('a.ts'), pin: true })
    expect(groups(split)[0]).toContain('src:a.ts')
    const moved = run(split, { type: 'move', id: 'src:a.ts', group: 1, index: 1 }, { type: 'activate', id: V('check') }, { type: 'open', doc: src('a.ts') })
    expect(actives(moved)[1]).toBe('src:a.ts')
  })
  it('LY-10a 从下组的「+」打开的资料进下组；组号越界取上组', () => {
    const split = run(EMPTY_WORKSPACE, { type: 'move', id: V('check'), group: 1, index: 0 })
    const below = run(split, { type: 'open', doc: { kind: 'issues' }, pin: true, group: 1 })
    expect(groups(below)[1]).toEqual(['check', 'issues'])
    expect(actives(below)[1]).toBe('issues')
    const outside = run(EMPTY_WORKSPACE, { type: 'open', doc: { kind: 'issues' }, pin: true, group: 3 })
    expect(groups(outside)[0]).toContain('issues')
  })
})

describe('LY-10 分组与拖拽', () => {
  it('拖到下半区开下组；移动后激活它；原组激活落到邻居', () => {
    const s = run(EMPTY_WORKSPACE, { type: 'activate', id: V('description') }, { type: 'move', id: V('description'), group: 1, index: 0 })
    expect(groups(s)).toEqual([['explainer', 'check'], ['description']])
    expect(actives(s)).toEqual([V('check'), V('description')])
  })
  it('组内换序：拖到某个标签之前', () => {
    const s = run(EMPTY_WORKSPACE, { type: 'move', id: V('check'), group: 0, index: 0 })
    expect(groups(s)).toEqual([['check', 'explainer', 'description']])
    const t = run(EMPTY_WORKSPACE, { type: 'move', id: V('explainer'), group: 0, index: 3 })
    expect(groups(t)).toEqual([['description', 'check', 'explainer']])
  })
  it('一组拖空即合并', () => {
    const s = run(EMPTY_WORKSPACE, { type: 'move', id: V('check'), group: 1, index: 0 }, { type: 'move', id: V('check'), group: 0, index: 1 })
    expect(groups(s)).toEqual([['explainer', 'check', 'description']])
    const closed = run(
      EMPTY_WORKSPACE,
      { type: 'open', doc: src('a.ts'), pin: true },
      { type: 'move', id: 'src:a.ts', group: 1, index: 0 },
      { type: 'close', id: 'src:a.ts' },
    )
    expect(groups(closed)).toEqual([['explainer', 'description', 'check']])
  })
  it('至多两组：没有第三组；只剩一个标签时不能开下组（拖空即合并，原样）', () => {
    const two = run(EMPTY_WORKSPACE, { type: 'move', id: V('check'), group: 1, index: 0 })
    expect(workspaceTransition(two, { type: 'move', id: V('description'), group: 2, index: 0 })).toBe(two)
    const lone = run(EMPTY_WORKSPACE, { type: 'setContext', context: 'scenario' }, { type: 'move', id: V('explainer'), group: 0, index: 1 })
    expect(groups(lone)[1]).toEqual(['description', 'check'])
    // 上组空了即合并：把时序图拖到下组
    const merged = run(EMPTY_WORKSPACE, { type: 'setContext', context: 'scenario' }, { type: 'move', id: V('sequence'), group: 1, index: 0 })
    expect(groups(merged)).toEqual([['sequence', 'explainer', 'description', 'check']])
  })
  it('关闭后激活同位置的右邻，没有则左邻', () => {
    const two = run(EMPTY_WORKSPACE, { type: 'open', doc: src('a.ts'), pin: true }, { type: 'open', doc: src('b.ts'), pin: true })
    const s = run(two, { type: 'activate', id: 'src:a.ts' }, { type: 'close', id: 'src:a.ts' })
    expect(actives(s)).toEqual(['src:b.ts'])
    const t = run(two, { type: 'close', id: 'src:b.ts' })
    expect(actives(t)).toEqual(['src:a.ts'])
  })
  it('LY-10b 分隔比例 0.2–0.8，改了即记下', () => {
    expect(run(EMPTY_WORKSPACE, { type: 'setSplit', split: 0.95 }).split).toBe(0.8)
    const s = run(EMPTY_WORKSPACE, { type: 'setSplit', split: 0.1 })
    expect(s.split).toBe(0.2)
    expect(s.memory.free?.split).toBe(0.2)
  })
})

describe('LY-12、LY-3、LY-10b 开合与宽度', () => {
  it('视图区可整体收起，标签保留', () => {
    const s = run(EMPTY_WORKSPACE, { type: 'setCollapsed', collapsed: true })
    expect(s.collapsed).toBe(true)
    expect(s.groups).toBe(EMPTY_WORKSPACE.groups)
    expect(workspaceTransition(s, { type: 'setCollapsed', collapsed: true })).toBe(s)
  })
  it('视图区宽度 0.2–0.75，缺省 0.36', () => {
    expect(EMPTY_WORKSPACE.width).toBe(DEFAULT_WIDTH)
    expect(run(EMPTY_WORKSPACE, { type: 'setWidth', width: 0.9 }).width).toBe(0.75)
  })
  it('LY-3 侧栏：只由人开合，宽度 200–400；≥ 1440 缺省展开', () => {
    expect(EMPTY_WORKSPACE.sidebar).toEqual({ open: false, width: DEFAULT_SIDEBAR_WIDTH })
    const s = run(EMPTY_WORKSPACE, { type: 'setSidebar', open: true }, { type: 'setSidebar', width: 999 })
    expect(s.sidebar).toEqual({ open: true, width: 400 })
    expect(defaultSidebarOpen(1440)).toBe(true)
    expect(defaultSidebarOpen(1439)).toBe(false)
    // 换情境、开资料都不改侧栏
    expect(run(s, { type: 'setContext', context: 'scenario' }, { type: 'open', doc: src('a.ts') }).sidebar).toBe(s.sidebar)
  })
})

describe('本机记忆读回（restore）', () => {
  it('读回记忆即按当前情境重摆，开合宽度按读回的', () => {
    const memory = { free: { groups: [['check' as const, 'explainer' as const]], active: ['check' as const], split: 0.5 } }
    const s = run(EMPTY_WORKSPACE, { type: 'restore', memory, collapsed: true, width: 0.3, sidebar: { open: true, width: 260 } })
    expect(groups(s)).toEqual([['check', 'explainer', 'description']])
    expect(actives(s)).toEqual([V('check')])
    expect([s.collapsed, s.width, s.sidebar]).toEqual([true, 0.3, { open: true, width: 260 }])
  })
  it('记下的排布丢了常驻标签也会补回（常驻优先于记忆；旧版本里关掉过描述的记忆同样补回）', () => {
    const s = initialWorkspace('free', { free: { groups: [['check']], active: ['check'], split: 0.5 } })
    expect(groups(s)).toEqual([['explainer', 'check', 'description']])
  })
  it('形状不对的记忆丢弃', () => {
    expect(validArrangement(null)).toBeNull()
    expect(validArrangement({ groups: [['nope']], active: [null], split: 0.5 })).toBeNull()
    expect(validArrangement({ groups: [[], [], []], active: [], split: 0.5 })).toBeNull()
    expect(validArrangement({ groups: [['check']], active: ['check'], split: 2 })).toEqual({ groups: [['check']], active: ['check'], split: 0.8 })
  })
  it('arrangementOf 与 initialWorkspace 互逆（缺省排布）', () => {
    for (const c of ['free', 'scenario', 'sketch'] as const) expect(arrangementOf(initialWorkspace(c))).toEqual(DEFAULT_ARRANGEMENTS[c])
  })
})
