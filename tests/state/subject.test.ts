/** LY-7、LY-7a（ADR-0064）：主语——选中；回放中无显式选中为进度所在的步骤 / 场景；否则当前层次的父模块，根层即系统 */
import { describe, expect, it } from 'vitest'
import { loadModel, RELATION_TYPES } from '../../src/model'
import { DEFAULT_TOGGLES, subjectOf, transition, type ViewState } from '../../src/state/transition'
import { scenarioFiles } from '../fixtures/sample'

const { index } = loadModel(scenarioFiles())
const root = index.rootId
const base: ViewState = { levelId: root, selection: null, hover: null, toggles: DEFAULT_TOGGLES(RELATION_TYPES), playback: null }

describe('LY-7 主语', () => {
  it('根层无选中：系统', () => {
    expect(subjectOf(base, root)).toEqual({ kind: 'system' })
    expect(subjectOf({ ...base, levelId: '' }, root)).toEqual({ kind: 'system' })
  })
  it('有选中：选中的对象（任何种类）', () => {
    expect(subjectOf({ ...base, selection: { kind: 'module', id: 'infra' } }, root)).toEqual({ kind: 'module', id: 'infra' })
    expect(subjectOf({ ...base, selection: { kind: 'relation', id: 'r1' } }, root)).toEqual({ kind: 'relation', id: 'r1' })
  })
  it('LY-7a 下钻后无选中：当前层次的父模块（不跳回系统）', () => {
    expect(subjectOf({ ...base, levelId: 'infra' }, root)).toEqual({ kind: 'module', id: 'infra' })
  })
  it('回放中无显式选中：开头为场景，走了几步为进度所在的步骤（V7）', () => {
    const opened = transition(base, { type: 'openScenario', id: 'sc.play' }, { index }).state
    expect(subjectOf(opened, root)).toEqual({ kind: 'scenario', id: 'sc.play' })
    const stepped = { ...opened, playback: { ...opened.playback!, frameId: 'f1' } }
    expect(subjectOf(stepped, root)).toEqual({ kind: 'step', id: 'f1' })
    expect(subjectOf({ ...stepped, selection: { kind: 'module', id: 'infra' } }, root)).toEqual({ kind: 'module', id: 'infra' })
  })
})
