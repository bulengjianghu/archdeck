/** 导航规则 N1–N13 与 URL 编解码：纯函数穷举（docs/02-domain.md §2.6） */
import { describe, expect, it } from 'vitest'
import { loadModel, nearestExisting, RELATION_TYPES } from '../../src/model'
import { DEFAULT_TOGGLES, encodeView, keyIntent, transition, type ViewAction, type ViewState } from '../../src/state/transition'
import { sampleFiles } from '../fixtures/sample'

const { index } = loadModel(sampleFiles())
const base: ViewState = { levelId: 'sys', selection: null, hover: null, toggles: DEFAULT_TOGGLES(RELATION_TYPES), playback: null }
const at = (levelId: string, extra: Partial<ViewState> = {}): ViewState => ({ ...base, levelId, ...extra })
const run = (s: ViewState, a: ViewAction) => transition(s, a, { index })

describe('导航规则', () => {
  it('N1：只有有子模块的模块可下钻', () => {
    const s = at('infra')
    expect(run(s, { type: 'drill', id: 'infra.mus' }).state).toBe(s)
    expect(run(s, { type: 'drill', id: 'infra.framework' }).state.levelId).toBe('infra.framework')
  })

  it('N2：下钻后清空选中与悬停', () => {
    const r = run(at('infra', { selection: { kind: 'module', id: 'infra.framework' }, hover: 'infra.mus' }), { type: 'drill', id: 'infra.framework' })
    expect(r.state.selection).toBeNull()
    expect(r.state.hover).toBeNull()
  })

  it('N3：定位关系跳到两端的最近公共祖先并选中', () => {
    expect(run(base, { type: 'revealRelation', id: 'r6' }).state).toMatchObject({ levelId: 'infra.framework', selection: { kind: 'relation', id: 'r6' } })
    expect(run(base, { type: 'revealRelation', id: 'r1' }).state.levelId).toBe('sys')
    expect(run(base, { type: 'revealRelation', id: 'nope' }).state).toBe(base)
  })

  it('N4：定位模块跳到其父模块并选中', () => {
    expect(run(base, { type: 'revealModule', id: 'infra.framework.sm' }).state).toMatchObject({
      levelId: 'infra.framework',
      selection: { kind: 'module', id: 'infra.framework.sm' },
    })
    expect(run(base, { type: 'revealModule', id: 'nope' }).state).toBe(base)
  })

  it('N5：重新加载保留层次与选中；层次失效退到最近仍存在的祖先，选中失效则清空', () => {
    const s = at('infra.framework', { selection: { kind: 'module', id: 'infra.framework.sm' } })
    expect(run(s, { type: 'reloaded', previousPath: ['sys', 'infra', 'infra.framework'] }).state).toEqual(s)
    const gone = at('infra.gone', { selection: { kind: 'relation', id: 'r-gone' } })
    const r = run(gone, { type: 'reloaded', previousPath: ['sys', 'infra', 'infra.gone'] })
    expect(r.state.levelId).toBe('infra')
    expect(r.state.selection).toBeNull()
    expect(r.history).toBe('replace')
  })

  it('N5 · nearestExisting：旧路径中最深的仍存在的模块，否则根', () => {
    expect(nearestExisting(index, ['sys', 'infra', 'infra.gone', 'infra.gone.x'])).toBe('infra')
    expect(nearestExisting(index, ['old-root', 'x'])).toBe('sys')
    expect(nearestExisting(index, [])).toBe('sys')
  })

  it('N6：层次与选中写进 URL，根层省略 level', () => {
    expect(encodeView(base, index)).toEqual({})
    expect(encodeView(at('infra', { selection: { kind: 'edge', id: 'a->b' } }), index)).toEqual({ level: 'infra', sel: 'e:a->b' })
    const r = run(base, { type: 'restore', query: { level: 'infra.framework', sel: 'r:r6' } })
    expect(r.state).toMatchObject({ levelId: 'infra.framework', selection: { kind: 'relation', id: 'r6' } })
  })

  it('N6：解码时丢弃无效值', () => {
    const r = run(at('infra'), { type: 'restore', query: { level: 'nope', sel: 'm:nope' } })
    expect(r.state).toMatchObject({ levelId: 'sys', selection: null })
    expect(run(base, { type: 'restore', query: { sel: 'x:1' } }).state.selection).toBeNull()
  })

  it('N7：根层按 Backspace 回项目列表，其他层次返回上级', () => {
    expect(keyIntent(base, index, 'Backspace')).toBe('leave')
    expect(keyIntent(at('infra'), index, 'Backspace')).toEqual({ type: 'goUp' })
  })

  it('N8：返回上级时选中刚离开的模块；根层无上级', () => {
    expect(run(at('infra.framework'), { type: 'goUp' }).state).toMatchObject({ levelId: 'infra', selection: { kind: 'module', id: 'infra.framework' } })
    expect(run(base, { type: 'goUp' }).state).toBe(base)
  })

  it('N9：Esc 先取消选中，无选中再返回上级', () => {
    expect(keyIntent(at('infra', { selection: { kind: 'module', id: 'infra.mus' } }), index, 'Escape')).toEqual({ type: 'select', selection: null })
    expect(keyIntent(at('infra'), index, 'Escape')).toEqual({ type: 'goUp' })
    expect(keyIntent(at('infra'), index, 'a')).toBeNull()
  })

  it('N10：下钻、跳转、定位在层次改变时进浏览器历史；层次不变（含选中）只替换地址', () => {
    expect(run(base, { type: 'drill', id: 'infra' }).history).toBe('push')
    expect(run(base, { type: 'goTo', id: 'app' }).history).toBe('push')
    expect(run(base, { type: 'revealModule', id: 'infra.mus' }).history).toBe('push')
    expect(run(at('infra'), { type: 'revealModule', id: 'infra.mus' }).history).toBe('replace')
    expect(run(base, { type: 'goTo', id: 'sys', select: null }).history).toBe('replace')
    expect(run(base, { type: 'select', selection: { kind: 'module', id: 'infra' } }).history).toBe('replace')
    expect(run(base, { type: 'restore', query: { level: 'infra' } }).history).toBe('replace')
  })

  it('N11：切换版本按 URL 恢复层次与选中（新版本中不存在的退回根并清空）', () => {
    expect(run(base, { type: 'restore', query: { level: 'infra', sel: 'm:infra.mus' } }).state).toMatchObject({
      levelId: 'infra',
      selection: { kind: 'module', id: 'infra.mus' },
    })
    expect(run(base, { type: 'restore', query: { level: 'infra.renamed' } }).state.levelId).toBe('sys')
  })

  it('N12：「只看现状」隐藏了当前层次时，退到最近的可见层次', () => {
    const { index: idx } = loadModel(
      sampleFiles({
        'z.yaml':
          'modules: [{ id: app.next, name: Next, parent: app, status: target, responsibility: x, children: [{ id: app.next.a, name: A, responsibility: x }] }]',
      }),
    )
    const s = at('app.next', { selection: { kind: 'module', id: 'app.next.a' } })
    const r = transition(s, { type: 'toggle', patch: { currentOnly: true } }, { index: idx })
    expect(r.state.levelId).toBe('app')
    expect(r.state.toggles.currentOnly).toBe(true)
    expect(transition(at('infra'), { type: 'toggle', patch: { currentOnly: true } }, { index: idx }).state.levelId).toBe('infra')
  })

  it('N13：单击空白取消选中', () => {
    expect(run(at('infra', { selection: { kind: 'module', id: 'infra.mus' } }), { type: 'select', selection: null }).state.selection).toBeNull()
  })

  it('goTo 可同时设定选中；不存在的层次回到根', () => {
    expect(run(base, { type: 'goTo', id: 'infra', select: { kind: 'module', id: 'infra.mus' } }).state.selection).toEqual({ kind: 'module', id: 'infra.mus' })
    expect(run(at('infra'), { type: 'goTo', id: 'nope' }).state.levelId).toBe('sys')
  })

  it('悬停与开关只改各自的字段', () => {
    expect(run(base, { type: 'hover', id: 'infra' }).state.hover).toBe('infra')
    const r = run(base, { type: 'toggle', patch: { showBoundaries: false } })
    expect(r.state.toggles.showBoundaries).toBe(false)
    expect(r.state.levelId).toBe('sys')
  })
})
