/** 工作区规则（WS-2–WS-9，ADR-0054）：资料区的标签、预览、分组、显隐与属性栏开关，纯函数穷举 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_WORKSPACE,
  MIN_CANVAS,
  PROPS_WIDTH,
  dockAppeared,
  dockShown,
  propsPlacement,
  workspaceTransition,
  type DocRef,
  type WorkspaceAction,
  type WorkspaceState,
} from '../../src/state/transition'

const src = (path: string, line?: number): DocRef => ({ kind: 'source', path, ...(line ? { line } : {}) })
const SEQ: DocRef = { kind: 'sequence' }
const run = (...actions: WorkspaceAction[]) => actions.reduce(workspaceTransition, EMPTY_WORKSPACE)
const tabs = (s: WorkspaceState, g = 0) => s.groups[g].tabs.map(t => `${t.id}${t.preview ? '~' : ''}`)

describe('WS-2 属性栏开关', () => {
  it('setProps 切换；与当前相同时返回原状态', () => {
    const off = run({ type: 'setProps', open: false })
    expect(off.propsOpen).toBe(false)
    expect(workspaceTransition(off, { type: 'setProps', open: false })).toBe(off)
    expect(EMPTY_WORKSPACE.propsOpen).toBe(true)
  })
})

describe('WS-3 并排或悬浮由宽度推出', () => {
  it('宽度 − 330 ≥ 620 并排，否则悬浮', () => {
    expect(PROPS_WIDTH).toBe(330)
    expect(MIN_CANVAS).toBe(620)
    expect(propsPlacement(950)).toBe('docked')
    expect(propsPlacement(949)).toBe('floating')
    expect(propsPlacement(1440)).toBe('docked')
    expect(propsPlacement(700)).toBe('floating')
  })
})

describe('WS-4 每份资料一个标签', () => {
  it('同一份资料再打开只激活它，源代码更新目标行', () => {
    const s = run({ type: 'open', doc: src('a.ts'), pin: true }, { type: 'open', doc: src('b.ts'), pin: true }, { type: 'open', doc: src('a.ts', 12) })
    expect(tabs(s)).toEqual(['src:a.ts', 'src:b.ts'])
    expect(s.groups[0].active).toBe('src:a.ts')
    expect(s.groups[0].tabs[0].doc).toEqual(src('a.ts', 12))
  })
  it('时序图只有一份；图解按模块', () => {
    const s = run(
      { type: 'open', doc: SEQ, pin: true },
      { type: 'open', doc: SEQ, pin: true },
      { type: 'open', doc: { kind: 'explainer', module: 'kit' }, pin: true },
    )
    expect(tabs(s)).toEqual(['seq', 'exp:kit'])
  })
  it('已开在另一组：激活它并聚焦那一组', () => {
    const s = run({ type: 'open', doc: src('a.ts'), pin: true }, { type: 'split' }, { type: 'open', doc: src('b.ts') }, { type: 'open', doc: src('a.ts') })
    expect(s.focus).toBe(0)
    expect(tabs(s, 1)).toEqual(['src:b.ts~'])
  })
})

describe('WS-5 预览标签', () => {
  it('不固定地打开替换预览，不堆积', () => {
    const s = run({ type: 'open', doc: src('a.ts') }, { type: 'open', doc: src('b.ts') })
    expect(tabs(s)).toEqual(['src:b.ts~'])
    expect(s.groups[0].active).toBe('src:b.ts')
  })
  it('固定地打开追加固定标签，预览保留；一组至多一个预览', () => {
    const s = run({ type: 'open', doc: src('a.ts') }, { type: 'open', doc: src('b.ts'), pin: true }, { type: 'open', doc: src('c.ts') })
    expect(tabs(s)).toEqual(['src:c.ts~', 'src:b.ts'])
  })
  it('已开的预览被固定地打开或双击标签：转为固定，下一次预览追加', () => {
    const a = run({ type: 'open', doc: src('a.ts') }, { type: 'open', doc: src('a.ts'), pin: true }, { type: 'open', doc: src('b.ts') })
    expect(tabs(a)).toEqual(['src:a.ts', 'src:b.ts~'])
    const b = run({ type: 'open', doc: src('a.ts') }, { type: 'pin', group: 0, id: 'src:a.ts' }, { type: 'open', doc: src('b.ts') })
    expect(tabs(b)).toEqual(['src:a.ts', 'src:b.ts~'])
  })
  it('已固定的标签不固定地再打开仍是固定', () => {
    const s = run({ type: 'open', doc: src('a.ts'), pin: true }, { type: 'open', doc: src('a.ts') })
    expect(tabs(s)).toEqual(['src:a.ts'])
  })
})

describe('WS-6 分组', () => {
  const two = run({ type: 'open', doc: SEQ, pin: true }, { type: 'split' })
  it('分屏新建空的下组并聚焦；最多两组；没有标签时不能分屏', () => {
    expect(two.groups).toHaveLength(2)
    expect(two.focus).toBe(1)
    expect(workspaceTransition(two, { type: 'split' })).toBe(two)
    expect(workspaceTransition(EMPTY_WORKSPACE, { type: 'split' })).toBe(EMPTY_WORKSPACE)
  })
  it('新资料进焦点组；单击上组后进上组', () => {
    const s = workspaceTransition(two, { type: 'open', doc: src('a.ts') })
    expect(tabs(s, 1)).toEqual(['src:a.ts~'])
    const t = [{ type: 'focusGroup', group: 0 } as const, { type: 'open', doc: src('b.ts') } as const].reduce(workspaceTransition, s)
    expect(tabs(t, 0)).toEqual(['seq', 'src:b.ts~'])
    expect(workspaceTransition(t, { type: 'focusGroup', group: 5 })).toBe(t)
  })
  it('预览替换只在本组内', () => {
    const s = [{ type: 'open', doc: src('a.ts') } as const, { type: 'focusGroup', group: 0 } as const, { type: 'open', doc: src('b.ts') } as const].reduce(
      workspaceTransition,
      two,
    )
    expect(tabs(s, 0)).toEqual(['seq', 'src:b.ts~'])
    expect(tabs(s, 1)).toEqual(['src:a.ts~'])
  })
  it('下组最后一个标签关闭：下组消失，焦点回上组', () => {
    const s = [{ type: 'open', doc: src('a.ts') } as const, { type: 'close', group: 1, id: 'src:a.ts' } as const].reduce(workspaceTransition, two)
    expect(s.groups).toHaveLength(1)
    expect(s.focus).toBe(0)
  })
  it('取消分屏：下组按固定并回上组，不重复', () => {
    const s = [
      { type: 'open', doc: src('a.ts') } as const,
      { type: 'focusGroup', group: 0 } as const,
      { type: 'open', doc: src('b.ts'), pin: true } as const,
      { type: 'unsplit' } as const,
    ].reduce(workspaceTransition, two)
    expect(s.groups).toHaveLength(1)
    expect(tabs(s)).toEqual(['seq', 'src:b.ts', 'src:a.ts'])
    expect(workspaceTransition(s, { type: 'unsplit' })).toBe(s)
  })
})

describe('WS-7 关闭与显隐', () => {
  const three = run(...['a', 'b', 'c'].map(n => ({ type: 'open', doc: src(`${n}.ts`), pin: true }) as const), { type: 'activate', group: 0, id: 'src:b.ts' })
  it('关闭活动标签激活右邻，没有则左邻；关闭非活动标签不改活动', () => {
    const s = workspaceTransition(three, { type: 'close', group: 0, id: 'src:b.ts' })
    expect(s.groups[0].active).toBe('src:c.ts')
    const t = workspaceTransition(s, { type: 'close', group: 0, id: 'src:c.ts' })
    expect(t.groups[0].active).toBe('src:a.ts')
    expect(workspaceTransition(three, { type: 'close', group: 0, id: 'src:a.ts' }).groups[0].active).toBe('src:b.ts')
  })
  it('最后一个标签关闭后资料区消失；✕ 关闭全部', () => {
    const one = run({ type: 'open', doc: src('a.ts') })
    expect(dockShown(one)).toBe(true)
    expect(dockShown(workspaceTransition(one, { type: 'close', group: 0, id: 'src:a.ts' }))).toBe(false)
    const all = workspaceTransition(workspaceTransition(three, { type: 'split' }), { type: 'closeDock' })
    expect(all.groups).toEqual([{ tabs: [], active: null }])
    expect(dockShown(all)).toBe(false)
  })
  it('「▣ 资料」隐藏而保留标签；打开资料重新显示；没有标签时无效', () => {
    const hidden = workspaceTransition(three, { type: 'toggleDock' })
    expect(dockShown(hidden)).toBe(false)
    expect(hidden.groups).toBe(three.groups)
    expect(dockShown(workspaceTransition(hidden, { type: 'toggleDock' }))).toBe(true)
    expect(dockShown(workspaceTransition(hidden, { type: 'open', doc: src('a.ts') }))).toBe(true)
    expect(workspaceTransition(EMPTY_WORKSPACE, { type: 'toggleDock' })).toBe(EMPTY_WORKSPACE)
  })
  it('closeDoc 在所有组里关掉这份资料（退出场景关时序图，WS-8）', () => {
    const s = run({ type: 'open', doc: src('a.ts'), pin: true }, { type: 'split' }, { type: 'open', doc: SEQ, pin: true }, { type: 'closeDoc', id: 'seq' })
    expect(s.groups).toHaveLength(1)
    expect(tabs(s)).toEqual(['src:a.ts'])
    expect(workspaceTransition(s, { type: 'closeDoc', id: 'seq' })).toBe(s)
  })
})

describe('WS-9 资料区出现', () => {
  it('从不显示到显示才算出现；隐藏后再显示也算', () => {
    const a = run({ type: 'open', doc: src('a.ts') })
    expect(dockAppeared(EMPTY_WORKSPACE, a)).toBe(true)
    const b = workspaceTransition(a, { type: 'open', doc: src('b.ts') })
    expect(dockAppeared(a, b)).toBe(false)
    const hidden = workspaceTransition(b, { type: 'toggleDock' })
    expect(dockAppeared(hidden, workspaceTransition(hidden, { type: 'toggleDock' }))).toBe(true)
  })
})
