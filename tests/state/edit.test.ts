/**
 * 草图画布的会话规则（docs/02-domain.md §2.21 X7a、X7h，ADR-0024、ADR-0025）：进入草图即编辑、互斥、层次只由当前张决定、离开确认、编辑后的跟随。
 */
import { describe, expect, it } from 'vitest'
import { RELATION_TYPES, loadModel } from '../../src/model'
import { DEFAULT_TOGGLES, encodeView, keyIntent, leaveGuard, transition, type ViewState } from '../../src/state/transition'

const { index } = loadModel([
  { path: 'system.yaml', text: 'system: { id: sys, name: S }' },
  {
    path: 'sketches/core.a.yaml',
    text: `sketch:
  id: d
  mount: core.a
  modules:
    - { id: core.a.x, name: X }
    - { id: core.a.y, name: Y }
  relations:
    - { id: r1, from: core.a.x, to: core.a.y, type: calls }
`,
  },
  { path: 'm.yaml', text: 'modules: [{ id: core, name: Core, kind: layer, order: 1, children: [{ id: core.a, name: A }, { id: core.b, name: B }] }]' },
])
const target = { kind: 'design' as const, design: 'd' }
const base: ViewState = { levelId: 'sys', selection: null, hover: null, toggles: DEFAULT_TOGGLES(RELATION_TYPES), playback: null }
const editing: ViewState = { ...base, editing: target, levelId: 'core.a' }
const ctx = { index, editable: true }

describe('X7a 进入草图画布与互斥', () => {
  it('只在草图版本上进入（ctx.editable）；进入时关闭场景、清掉文件选中，层次换成当前张的挂载点', () => {
    expect(transition(base, { type: 'enterEdit', target, level: 'core.a' }, { index }).state).toBe(base)
    const running: ViewState = { ...base, selection: { kind: 'file', id: 'a.ts' }, playback: { scenarioId: 'sc', frameId: null, choices: new Map() } }
    const r = transition(running, { type: 'enterEdit', target, level: 'core.a' }, ctx).state
    expect(r).toMatchObject({ editing: target, playback: null, selection: null, levelId: 'core.a' })
    const keep = transition({ ...base, selection: { kind: 'module', id: 'core.a.x' } }, { type: 'enterEdit', target, level: 'core.a' }, ctx).state
    expect(keep.selection).toEqual({ kind: 'module', id: 'core.a.x' })
    expect(transition(base, { type: 'enterEdit', target, level: 'root' }, ctx).state.levelId).toBe('sys')
    expect(transition(editing, { type: 'exitEdit' }, ctx).state.editing).toBeNull()
  })

  it('草图画布下打开场景、选中文件 / 依赖线 / 耦合线 / 聚合边、打开代码事实与演化叠加为无效动作', () => {
    for (const action of [
      { type: 'openScenario', id: 'sc' },
      { type: 'select', selection: { kind: 'file', id: 'a.ts' } },
      { type: 'select', selection: { kind: 'dep', id: 'a->b' } },
      { type: 'toggle', patch: { showFacts: true } },
      { type: 'toggle', patch: { heat: 'changes' } },
    ] as const)
      expect(transition(editing, action, ctx).state).toBe(editing)
    expect(transition(editing, { type: 'select', selection: { kind: 'module', id: 'core.a.x' } }, ctx).state.selection).toEqual({
      kind: 'module',
      id: 'core.a.x',
    })
  })

  it('层次只由当前张决定：模型画布的下钻、返回上级、跳到别的层次、按 URL 恢复为无效动作', () => {
    for (const action of [
      { type: 'drill', id: 'core.a.x' },
      { type: 'goUp' },
      { type: 'goTo', id: 'core' },
      { type: 'revealModule', id: 'core.b' },
      { type: 'restore', query: { level: 'core' } },
    ] as const)
      expect(transition(editing, action, ctx).state).toBe(editing)
  })

  it('X7h：切到另一张草图（下钻、面包屑返回）：层次换成它的挂载点、清空选中，不进浏览器历史；不在草图里时无效', () => {
    const sel = { ...editing, selection: { kind: 'module' as const, id: 'core.a.x' } }
    const r = transition(sel, { type: 'openSketch', level: 'core.b' }, ctx)
    expect(r.state).toMatchObject({ levelId: 'core.b', selection: null })
    expect(r.history).toBe('replace')
    expect(transition(sel, { type: 'openSketch', level: 'root' }, ctx).state.levelId).toBe('sys')
    expect(transition(base, { type: 'openSketch', level: 'core.b' }, ctx).state).toBe(base)
  })

  it('Esc 只取消选中；草图画布下 Backspace 留给删除，不返回上级', () => {
    const sel = { ...editing, selection: { kind: 'module' as const, id: 'core.a.x' } }
    expect(keyIntent(sel, index, 'Escape')).toEqual({ type: 'select', selection: null })
    expect(keyIntent(sel, index, 'Backspace')).toBeNull()
    expect(keyIntent(base, index, 'Backspace')).toBe('leave')
  })

  it('有未保存改动时离开要确认', () => {
    expect(leaveGuard(true)).toBe('confirm')
    expect(leaveGuard(false)).toBe('free')
  })

  it('草图画布不进 URL：层次与选中照常编码，编辑目标本身不编码', () => {
    expect(encodeView(editing, index)).toEqual(encodeView({ ...editing, editing: null }, index))
  })
})

describe('X7h 编辑后的跟随', () => {
  const effects = (e: Partial<{ created: string[]; renamed: [string, string][]; removed: string[] }>) => ({ created: [], renamed: [], removed: [], ...e })

  it('选中的模块被改名（含前缀级联）：换成新 ID；层次为编辑后的当前张', () => {
    const { index: after } = loadModel([
      { path: 'system.yaml', text: 'system: { id: sys, name: S }' },
      {
        path: 'm.yaml',
        text: 'modules: [{ id: core, name: Core, kind: layer, order: 1, children: [{ id: core.a, name: A, children: [{ id: core.a.ex, name: X }] }] }]',
      },
    ])
    const st = { ...editing, selection: { kind: 'module' as const, id: 'core.a.x' } }
    const r = transition(
      st,
      { type: 'edited', effects: effects({ renamed: [['core.a.x', 'core.a.ex']] }), previousPath: ['sys', 'core', 'core.a'], level: 'core.a' },
      { index: after },
    )
    expect(r.state).toMatchObject({ levelId: 'core.a', selection: { kind: 'module', id: 'core.a.ex' } })
    expect(r.history).toBe('replace')
  })

  it('选中的被删除：清空；当前张不在了：退到旧路径上最近仍存在的祖先', () => {
    const st = { ...editing, levelId: 'core.a', selection: { kind: 'relation' as const, id: 'r1' } }
    const { index: after } = loadModel([
      { path: 'system.yaml', text: 'system: { id: sys, name: S }' },
      { path: 'm.yaml', text: 'modules: [{ id: core, name: Core, kind: layer, order: 1, children: [{ id: core.b, name: B }] }]' },
    ])
    const r = transition(
      st,
      { type: 'edited', effects: effects({ removed: ['core.a', 'r1'] }), previousPath: ['sys', 'core', 'core.a'], level: 'core.a' },
      { index: after },
    ).state
    expect(r).toMatchObject({ levelId: 'core', selection: null })
  })

  it('新建、合并、拆分：选中结果（模块或关系）', () => {
    const go = (created: string[]) =>
      transition(editing, { type: 'edited', effects: effects({ created }), previousPath: ['sys'], level: 'core.a' }, ctx).state.selection
    expect(go(['core.a.y'])).toEqual({ kind: 'module', id: 'core.a.y' })
    expect(go(['r1'])).toEqual({ kind: 'relation', id: 'r1' })
  })
})
