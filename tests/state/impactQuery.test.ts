/** K15b、S2-1（ADR-0037）：影响面查询是视图状态里的一次性值——只在结构视角、选中模块时可设，选中或视角一变即回到「不看」，不进 URL */
import { describe, expect, it } from 'vitest'
import { loadModel, projectLevel, RELATION_TYPES } from '../../src/model'
import { DEFAULT_TOGGLES, encodeView, transition, type TransitionContext, type ViewAction, type ViewState } from '../../src/state/transition'
import { sampleFiles } from '../fixtures/sample'

const { index } = loadModel(sampleFiles())
const ctx: TransitionContext = { index, levelView: projectLevel(index, 'infra') }
const run = (s: ViewState, a: ViewAction) => transition(s, a, ctx).state
const base: ViewState = { levelId: 'infra', selection: null, hover: null, toggles: DEFAULT_TOGGLES(RELATION_TYPES), playback: null, mode: 'structure' }
const selected: ViewState = { ...base, selection: { kind: 'module', id: 'infra.framework' } }
const asked = run(selected, { type: 'queryImpact', query: { mode: 'in' } })

describe('K15b 影响面查询', () => {
  it('结构视角选中模块时可设、可改方向与「含只引类型」、可撤回「不看」；不进历史', () => {
    expect(asked.impactQuery).toEqual({ mode: 'in' })
    expect(transition(selected, { type: 'queryImpact', query: { mode: 'in' } }, ctx).history).toBe('replace')
    expect(run(asked, { type: 'queryImpact', query: { mode: 'both', types: true } }).impactQuery).toEqual({ mode: 'both', types: true })
    expect(run(asked, { type: 'queryImpact', query: null }).impactQuery).toBeNull()
    // 相同的查询无动作
    expect(run(asked, { type: 'queryImpact', query: { mode: 'in' } })).toBe(asked)
  })

  it('没有选中模块、交互视角或运行视角下设不上', () => {
    expect(run(base, { type: 'queryImpact', query: { mode: 'in' } })).toBe(base)
    const rel: ViewState = { ...base, selection: { kind: 'dep', id: 'infra.framework->infra.player' } }
    expect(run(rel, { type: 'queryImpact', query: { mode: 'out' } })).toBe(rel)
    const inter: ViewState = { ...selected, mode: undefined }
    expect(run(inter, { type: 'queryImpact', query: { mode: 'in' } })).toBe(inter)
  })

  it('S2-1：换选中、取消选中、切换视角、下钻都回到「不看」；悬停与开关不动它', () => {
    expect(run(asked, { type: 'select', selection: { kind: 'module', id: 'infra.player' } }).impactQuery).toBeNull()
    expect(run(asked, { type: 'select', selection: null }).impactQuery).toBeNull()
    expect(run(asked, { type: 'setMode', mode: 'interaction' }).impactQuery).toBeNull()
    expect(run(asked, { type: 'drill', id: 'infra.framework' }).impactQuery ?? null).toBeNull()
    expect(run(asked, { type: 'hover', id: 'infra.player' }).impactQuery).toEqual({ mode: 'in' })
    expect(run(asked, { type: 'toggle', patch: { showBoundaries: !asked.toggles.showBoundaries } }).impactQuery).toEqual({ mode: 'in' })
    // 再选回原来的模块也不恢复：查询不记在别处
    const away = run(asked, { type: 'select', selection: { kind: 'module', id: 'infra.player' } })
    expect(run(away, { type: 'select', selection: { kind: 'module', id: 'infra.framework' } }).impactQuery ?? null).toBeNull()
  })

  it('不进 URL：有无查询编码相同', () => {
    expect(encodeView(asked, index, null)).toEqual(encodeView(selected, index, null))
  })
})
