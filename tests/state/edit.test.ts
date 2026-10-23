/**
 * 编辑规则（docs/02-domain.md §2.21 X7a、X7h，ADR-0024）：进入 / 退出编辑态与互斥、离开确认、编辑后的跟随。
 */
import { describe, expect, it } from 'vitest'
import { RELATION_TYPES, loadModel } from '../../src/model'
import { DEFAULT_TOGGLES, keyIntent, leaveGuard, transition, type ViewState } from '../../src/state/transition'

const { index } = loadModel([
  { path: 'system.yaml', text: 'system: { id: sys, name: S }' },
  {
    path: 'sketches/root.yaml',
    text: `sketch:
  id: d
  mount: root
  modules:
    - { id: core, name: Core, kind: layer, order: 1, children: [{ id: core.a, name: A, children: [{ id: core.a.x, name: X }] }, { id: core.b, name: B }] }
  relations:
    - { id: r1, from: core.a, to: core.b, type: calls }
`,
  },
])
const target = { kind: 'design' as const, design: 'd' }
const base: ViewState = { levelId: 'sys', selection: null, hover: null, toggles: DEFAULT_TOGGLES(RELATION_TYPES), playback: null }
const editing: ViewState = { ...base, editing: target }
const ctx = { index, editable: true }

describe('X7a 进入 / 退出编辑态与互斥', () => {
  it('只在草图版本上进入（ctx.editable）；进入时关闭场景、清掉文件选中，保留层次与模块选中', () => {
    expect(transition(base, { type: 'enterEdit', target }, { index }).state).toBe(base)
    const running: ViewState = {
      ...base,
      levelId: 'core',
      selection: { kind: 'file', id: 'a.ts' },
      playback: { scenarioId: 'sc', frameId: null, choices: new Map() },
    }
    const r = transition(running, { type: 'enterEdit', target }, ctx).state
    expect(r).toMatchObject({ editing: target, playback: null, selection: null, levelId: 'core' })
    const withModule = transition({ ...base, selection: { kind: 'module', id: 'core.a' } }, { type: 'enterEdit', target }, ctx).state
    expect(withModule.selection).toEqual({ kind: 'module', id: 'core.a' })
    expect(transition(editing, { type: 'exitEdit' }, ctx).state.editing).toBeNull()
  })

  it('编辑态下打开场景、选中文件、打开代码事实与演化叠加为无效动作', () => {
    for (const action of [
      { type: 'openScenario', id: 'sc' },
      { type: 'select', selection: { kind: 'file', id: 'a.ts' } },
      { type: 'toggle', patch: { showFacts: true } },
      { type: 'toggle', patch: { heat: 'changes' } },
    ] as const)
      expect(transition(editing, action, ctx).state).toBe(editing)
    expect(transition(editing, { type: 'select', selection: { kind: 'module', id: 'core.a' } }, ctx).state.selection).toEqual({ kind: 'module', id: 'core.a' })
  })

  it('Esc 只取消选中；编辑态下 Backspace 留给删除，不返回上级', () => {
    const sel = { ...editing, selection: { kind: 'module' as const, id: 'core.a' } }
    expect(keyIntent(sel, index, 'Escape')).toEqual({ type: 'select', selection: null })
    expect(keyIntent(sel, index, 'Backspace')).toBeNull()
    expect(keyIntent(base, index, 'Backspace')).toBe('leave')
  })

  it('有未保存改动时离开要确认', () => {
    expect(leaveGuard(true)).toBe('confirm')
    expect(leaveGuard(false)).toBe('free')
  })

  it('编辑态不进 URL：层次与选中照常编码，编辑态本身不编码', async () => {
    const { encodeView } = await import('../../src/state/transition')
    expect(encodeView(editing, index)).toEqual(encodeView(base, index))
  })
})

describe('X7h 编辑后的跟随', () => {
  const effects = (e: Partial<{ created: string[]; renamed: [string, string][]; removed: string[] }>) => ({ created: [], renamed: [], removed: [], ...e })

  it('当前层次或选中的模块被改名：换成新 ID', () => {
    const { index: after } = loadModel([
      { path: 'system.yaml', text: 'system: { id: sys, name: S }' },
      {
        path: 'm.yaml',
        text: 'modules: [{ id: core, name: Core, kind: layer, order: 1, children: [{ id: core.alpha, name: A, children: [{ id: core.alpha.x, name: X }] }] }]',
      },
    ])
    const st = { ...editing, levelId: 'core.a', selection: { kind: 'module' as const, id: 'core.a.x' } }
    const r = transition(
      st,
      {
        type: 'edited',
        effects: effects({
          renamed: [
            ['core.a', 'core.alpha'],
            ['core.a.x', 'core.alpha.x'],
          ],
        }),
        previousPath: ['sys', 'core', 'core.a'],
      },
      { index: after },
    )
    expect(r.state).toMatchObject({ levelId: 'core.alpha', selection: { kind: 'module', id: 'core.alpha.x' } })
    expect(r.history).toBe('replace')
  })

  it('当前层次被删除：退到最近仍存在的祖先，选中清空；选中的关系被删除：清空', () => {
    const st = { ...editing, levelId: 'core.a.x', selection: { kind: 'relation' as const, id: 'r1' } }
    const { index: after } = loadModel([
      { path: 'system.yaml', text: 'system: { id: sys, name: S }' },
      { path: 'm.yaml', text: 'modules: [{ id: core, name: Core, kind: layer, order: 1, children: [{ id: core.b, name: B }] }]' },
    ])
    const r = transition(
      st,
      { type: 'edited', effects: effects({ removed: ['core.a', 'core.a.x', 'r1'] }), previousPath: ['sys', 'core', 'core.a', 'core.a.x'] },
      { index: after },
    ).state
    expect(r).toMatchObject({ levelId: 'core', selection: null })
  })

  it('新建模块或关系：选中它', () => {
    expect(transition(editing, { type: 'edited', effects: effects({ created: ['core.b'] }), previousPath: ['sys'] }, ctx).state.selection).toEqual({
      kind: 'module',
      id: 'core.b',
    })
    expect(transition(editing, { type: 'edited', effects: effects({ created: ['r1'] }), previousPath: ['sys'] }, ctx).state.selection).toEqual({
      kind: 'relation',
      id: 'r1',
    })
  })
})
