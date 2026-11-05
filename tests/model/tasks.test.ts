/**
 * 任务单（DL-36、DL-37，TK-2–TK-4）：核验偏差 ↔ 改动项号的映射（六类各一例 + 改 ID）、不核验的项、对不上号的偏差、任务单头、Markdown。
 * 每一类：当前版本 = 基线时「待做」带原号；按草图实现后的当前版本「✓」。
 */
import { describe, expect, it } from 'vitest'
import {
  applyDesignEdit,
  changeItems,
  checkSketches,
  designEntities,
  EMPTY_CHANGE_TABLE,
  loadModel,
  reconcileChanges,
  seedFromBaseline,
  taskList,
  taskMarkdown,
  type DesignEditContext,
  type DesignEditOp,
  type ModelIndex,
  type RawFile,
  type SketchSet,
  type TaskInput,
} from '../../src/model'

const SKELETON = `
sketch:
  id: skeleton
  mount: root
  lifetime: persistent
  closed: [fe, core]
  modules:
    - id: fe
      name: Front
      kind: layer
      children:
        - { id: fe.ui, name: UI, kind: subsystem }
    - id: core
      name: Core
      kind: layer
      children:
        - { id: core.api, name: Api, kind: subsystem }
        - { id: core.store, name: Store, kind: subsystem }
`
const MODULES = `
modules:
  - { id: fe.ui.view, name: View, parent: fe.ui, kind: component }
  - { id: fe.ui.list, name: List, parent: fe.ui, kind: component }
  - { id: fe.ui.form, name: Form, parent: fe.ui, kind: component }
relations:
  - { id: rel.view-api, from: fe.ui.view, to: core.api, type: queries }
  - { id: rel.list-api, from: fe.ui.list, to: core.api, type: queries }
  - { id: rel.view-list, from: fe.ui.view, to: fe.ui.list, type: queries }
  - { id: rel.form-store, from: fe.ui.form, to: core.store, type: commands }
`
const version = (modules: string): ModelIndex =>
  loadModel(
    Object.entries({ 'system.yaml': 'system: { id: sys, name: S }', 'intent/skeleton.yaml': SKELETON, 'modules/all.yaml': modules }).map(
      ([path, text]): RawFile => ({ path, text }),
    ),
  ).index
const baseline = version(MODULES)
const ctx: DesignEditContext & { baseline: ModelIndex } = { design: 'd1', persistent: baseline.model.sketches, baseline }
const seed = (): SketchSet => ({ 'fe.ui': seedFromBaseline('fe.ui', baseline, { id: 'd1' }) })
const run = (...ops: DesignEditOp[]): SketchSet =>
  ops.reduce<SketchSet>((s, op) => {
    const r = applyDesignEdit(s, op, ctx)
    if (!r.ok) throw new Error(r.reason)
    return r.design
  }, seed())

/** 编号表：按改动项给号（模拟页面每步对一次表） */
const tableOf = (set: SketchSet) => reconcileChanges(EMPTY_CHANGE_TABLE, changeItems(set, baseline, 'd1'), { round: 1, by: 'ai' }, 't')
const input = (set: SketchSet, current: ModelIndex, over: Partial<TaskInput> = {}): TaskInput => ({
  design: 'd1',
  name: 'D1',
  status: 'accepted',
  approval: { at: '2026-11-05', sketches: {} },
  sketches: set,
  baseline,
  table: tableOf(set),
  checks: checkSketches(current, designEntities(set, 'd1'), new Map(), new Map([['d1', baseline]])).filter(c => c.design === 'd1'),
  ...over,
})

/** 每类：做法、实现后的当前版本 */
const CASES: { kind: string; ops: DesignEditOp[]; implemented: string }[] = [
  {
    kind: 'added',
    ops: [{ op: 'edit', sketch: 'fe.ui', edit: { op: 'addModule', parent: 'fe.ui', name: 'Toast', id: 'toast' } }],
    implemented: MODULES.replace('relations:', '  - { id: fe.ui.toast, name: Toast, parent: fe.ui }\nrelations:'),
  },
  {
    kind: 'changed',
    ops: [{ op: 'edit', sketch: 'fe.ui', edit: { op: 'updateModule', id: 'fe.ui.list', patch: { kind: 'service' } } }],
    implemented: MODULES.replace('name: List, parent: fe.ui, kind: component', 'name: List, parent: fe.ui, kind: service'),
  },
  {
    kind: 'merged',
    ops: [{ op: 'merge', sketch: 'fe.ui', ids: ['fe.ui.view', 'fe.ui.list'], name: 'Pane', id: 'pane' }],
    implemented: `
modules:
  - { id: fe.ui.pane, name: Pane, parent: fe.ui, kind: component }
  - { id: fe.ui.pane.view, name: View, parent: fe.ui.pane, kind: component }
  - { id: fe.ui.pane.list, name: List, parent: fe.ui.pane, kind: component }
  - { id: fe.ui.form, name: Form, parent: fe.ui, kind: component }
relations:
  - { id: rel.view-api, from: fe.ui.pane, to: core.api, type: queries }
  - { id: rel.view-list, from: fe.ui.pane.view, to: fe.ui.pane.list, type: queries }
  - { id: rel.form-store, from: fe.ui.form, to: core.store, type: commands }
`,
  },
  {
    kind: 'split',
    ops: [{ op: 'split', sketch: 'fe.ui', id: 'fe.ui.form', parts: [{ name: 'Fields', id: 'fields' }, { name: 'Submit', id: 'submit' }] }],
    implemented: MODULES.replace('  - { id: fe.ui.form, name: Form, parent: fe.ui, kind: component }', '  - { id: fe.ui.fields, name: Fields, parent: fe.ui, kind: component }\n  - { id: fe.ui.submit, name: Submit, parent: fe.ui, kind: component }').replace(
      'from: fe.ui.form',
      'from: fe.ui.submit',
    ),
  },
  {
    kind: 'moved',
    ops: [{ op: 'demote', sketch: 'fe.ui', id: 'fe.ui.list', target: 'fe.ui.view' }],
    implemented: MODULES.replace('{ id: fe.ui.list, name: List, parent: fe.ui,', '{ id: fe.ui.view.list, name: List, parent: fe.ui.view,').replace(/fe\.ui\.list\b/g, 'fe.ui.view.list'),
  },
  {
    kind: 'renamed',
    ops: [{ op: 'rename', sketch: 'fe.ui', id: 'fe.ui.list', newId: 'lst' }],
    implemented: MODULES.replace(/fe\.ui\.list\b/g, 'fe.ui.lst'),
  },
  {
    kind: 'removed',
    ops: [{ op: 'remove', sketch: 'fe.ui', id: 'fe.ui.form' }],
    implemented: MODULES.replace('  - { id: fe.ui.form, name: Form, parent: fe.ui, kind: component }\n', '').replace(
      '  - { id: rel.form-store, from: fe.ui.form, to: core.store, type: commands }\n',
      '',
    ),
  },
]

describe('DL-36 任务单的映射：六类（加改 ID）各一例', () => {
  it.each(CASES)('$kind：实现前待做、原号不变；按草图实现后 ✓', ({ kind, ops, implemented }) => {
    const set = run(...ops)
    const before = taskList(input(set, baseline))
    const row = before.rows.find(r => r.kind === kind)!
    expect(row, JSON.stringify(before.rows)).toBeDefined()
    const n = tableOf(set).items.find(x => x.key === row.key)!.n
    expect(row).toMatchObject({ n, state: 'todo' })
    expect(row.remaining.length).toBeGreaterThan(0)
    expect(row.criteria[0].codes.length).toBeGreaterThan(0)
    expect(before.unmatched, JSON.stringify(before.unmatched)).toEqual([])
    const after = taskList(input(set, version(implemented)))
    const done = after.rows.find(r => r.key === row.key)!
    expect(done, JSON.stringify(after)).toMatchObject({ n, state: 'done', remaining: [] })
    expect(after.unmatched, JSON.stringify(after.unmatched)).toEqual([])
  })
})

describe('DL-36 不核验与对不上号', () => {
  it('只改了文字字段（名称、职责）：「不核验」，不算待做也不打 ✓', () => {
    const set = run({ op: 'edit', sketch: 'fe.ui', edit: { op: 'updateModule', id: 'fe.ui.list', patch: { name: 'Listing', responsibility: '列出条目' } } })
    const t = taskList(input(set, baseline))
    expect(t.rows).toHaveLength(1)
    expect(t.rows[0]).toMatchObject({ state: 'unchecked', criteria: [{ codes: [], text: expect.stringContaining('X17') }] })
    expect(t.counts).toMatchObject({ done: 0, todo: 0, unchecked: 1 })
  })
  it('设计开始后当前版本另有变化（多出的子模块）：偏差归不到任何改动项，单列「对不上号」并说明', () => {
    const set = run({ op: 'edit', sketch: 'fe.ui', edit: { op: 'setClosed', id: 'fe.ui', closed: true } })
    const drifted = version(MODULES.replace('relations:', '  - { id: fe.ui.extra, name: Extra, parent: fe.ui }\nrelations:'))
    const t = taskList(input(set, drifted))
    expect(t.unmatched).toEqual([expect.objectContaining({ code: 'sketch.extra-child', key: 'extra-child:fe.ui.extra', reason: expect.stringContaining('归不到任何改动项') })])
    expect(t.counts.unmatched).toBe(1)
  })
  it('编号表里没有的改动项标「未编号」、排在后面', () => {
    const set = run(...CASES[0].ops)
    const t = taskList(input(set, baseline, { table: EMPTY_CHANGE_TABLE }))
    expect(t.rows[0]).toMatchObject({ n: null, state: 'todo' })
    expect(taskMarkdown(t)).toContain('（未编号）')
  })
})

describe('DL-37 任务单头与出口', () => {
  const set = run(...CASES[0].ops)
  it('按设计状态：有效 / 认可已撤回 / 预览 / 作废 / 已归档', () => {
    expect(taskList(input(set, baseline))).toMatchObject({ state: 'active', note: expect.stringContaining('2026-11-05'), approvedAt: '2026-11-05' })
    expect(taskList(input(set, baseline, { status: 'draft', approval: { at: '2026-11-05', withdrawnAt: '2026-11-06' } }))).toMatchObject({
      state: 'withdrawn',
      note: expect.stringContaining('认可已撤回'),
    })
    expect(taskList(input(set, baseline, { status: 'draft', approval: undefined }))).toMatchObject({ state: 'preview' })
    expect(taskList(input(set, baseline, { status: 'abandoned' }))).toMatchObject({ state: 'void', note: expect.stringContaining('作废') })
    expect(taskList(input(set, baseline, { status: 'implemented' }))).toMatchObject({ state: 'archived' })
  })
  it('Markdown：写明语义是把代码改到草图那样、✓ 由核验推出不手工勾；每项带号、状态、怎样算做到与还差', () => {
    const md = taskMarkdown(taskList(input(set, baseline)))
    expect(md).toContain('# 任务单：设计「D1」（d1）')
    expect(md).toContain('不是问题清单')
    expect(md).toContain('不要手工勾选')
    expect(md).toMatch(/## #1 待做 · 新增 · /)
    expect(md).toContain('怎样算做到：当前版本里有模块 fe.ui.toast（Toast）（核验 sketch.missing-module）')
    expect(md).toContain('- 还差：')
  })
})
