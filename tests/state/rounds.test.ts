/**
 * AI 回合与三种撤回（第二十一轮波 2，T2.3；DA-6、DA-9、CI-5，DL-1、DL-2、DL-19）：编辑会话上的纯转移每条一测，
 * 外加对话会话在草图里的转移（缺省「改」、改 / 问切换、锚点带当前张）与协调者把一轮的改动块交给编辑会话。
 */
import { shallowRef } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  applyDesignEdit,
  changeItems,
  loadModel,
  seedFromBaseline,
  type DesignEditContext,
  type DesignEditOp,
  type ModelIndex,
  type RawFile,
} from '../../src/model'
import { begin, redo, apply } from '../../src/state/desk/edit/session'
import { applyRound, latestLive, planWithdrawRound, roundState, withdrawItem, withdrawRound } from '../../src/state/desk/edit/rounds'
import { anchorOf, anchorText, createDialogue, dialogueTransition, EMPTY_DIALOGUE, type AgentPush, type AgentTransport } from '../../src/state/desk/dialogue'

const MODULES = `
modules:
  - { id: fe, name: Front, kind: layer }
  - { id: fe.ui, name: UI, parent: fe, kind: subsystem }
  - { id: fe.ui.view, name: View, parent: fe.ui }
  - { id: fe.ui.list, name: List, parent: fe.ui }
  - { id: fe.ui.form, name: Form, parent: fe.ui }
relations:
  - { id: rel.view-list, from: fe.ui.view, to: fe.ui.list, type: queries }
  - { id: rel.form-list, from: fe.ui.form, to: fe.ui.list, type: queries }
`
const files: RawFile[] = [
  { path: 'system.yaml', text: 'system: { id: sys, name: S }' },
  { path: 'modules/all.yaml', text: MODULES },
]
const baseline: ModelIndex = loadModel(files).index
const ctx: DesignEditContext = { design: 'd1', persistent: [], baseline }
const fresh = () =>
  begin({ kind: 'design', design: 'd1' }, 'd1', { 'fe.ui': { file: 'sketches/fe.ui.yaml', hash: 'h', def: seedFromBaseline('fe.ui', baseline, { id: 'd1' }) } })
const MERGE: DesignEditOp = { op: 'merge', sketch: 'fe.ui', ids: ['fe.ui.view', 'fe.ui.list'], name: 'Pane', id: 'pane' }
const ADD: DesignEditOp = { op: 'edit', sketch: 'fe.ui', edit: { op: 'addModule', parent: 'fe.ui', name: 'Toast', id: 'toast' } }
const TOUCH: DesignEditOp = { op: 'edit', sketch: 'fe.ui', edit: { op: 'updateModule', id: 'fe.ui.pane', patch: { responsibility: '列与看' } } }
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error((r as unknown as { reason: string }).reason)
  return r as Extract<T, { ok: true }>
}
const kinds = (s: ReturnType<typeof fresh>) => changeItems(s.doc.sketches, baseline, 'd1').map(i => i.kind)

describe('DL-1 一轮一步', () => {
  it('AI 的一轮（几个操作）一次性应用为撤销的一步，记下开始前的快照与碰过的框', () => {
    const r = ok(applyRound(fresh(), [MERGE, ADD], ctx, 's-t1'))
    expect(r.session.past).toHaveLength(1)
    expect(r.session.past[0].round).toBe(1)
    expect(r.round).toMatchObject({ n: 1, turn: 's-t1' })
    expect(r.round.touched.modules).toEqual(expect.arrayContaining(['fe.ui.pane', 'fe.ui.toast', 'fe.ui.view', 'fe.ui.list']))
    expect(Object.keys(r.round.before)).toEqual(['fe.ui'])
    expect(r.round.after).toBe(r.session.doc.sketches)
  })
  it('任一条做不成：整轮不落（会话不变）', () => {
    const s = fresh()
    const r = applyRound(s, [ADD, { op: 'remove', sketch: 'fe.ui', id: 'fe.ui.nope' }], ctx, 's-t1')
    expect(r.ok).toBe(false)
  })
})

describe('CI-5 三种撤回', () => {
  it('撤回最近一轮 = 一步撤销；重做恢复', () => {
    const s1 = ok(applyRound(fresh(), [MERGE], ctx, 't1')).session
    expect(planWithdrawRound(s1, 1)).toEqual({ kind: 'undo' })
    const back = ok(withdrawRound(s1, 1, ctx)).session
    expect(kinds(back)).toEqual([])
    expect(roundState(back, back.rounds[0])).toBe('undone')
    expect(latestLive(back)).toBeNull()
    const again = redo(back)!.session
    expect(kinds(again)).toEqual(['merged'])
    expect(roundState(again, again.rounds[0])).toBe('live')
  })
  it('撤回更早一轮：那一轮碰过的回到它开始前，后面轮次改的别处不动；是一步新编辑（可撤销）', () => {
    let s = ok(applyRound(fresh(), [MERGE], ctx, 't1')).session
    s = ok(applyRound(s, [ADD], ctx, 't2')).session
    expect(planWithdrawRound(s, 1)).toMatchObject({ kind: 'restore', conflicts: { modules: [], relations: [] } })
    const r = ok(withdrawRound(s, 1, ctx))
    expect(kinds(r.session)).toEqual(['added'])
    expect(r.session.rounds[0].withdrawn).toBe(true)
    expect(roundState(r.session, r.session.rounds[1])).toBe('live')
    expect(r.session.past).toHaveLength(3)
  })
  it('后面的轮次也碰过同一个框：先列出要确认的，确认后才撤', () => {
    let s = ok(applyRound(fresh(), [MERGE], ctx, 't1')).session
    s = ok(applyRound(s, [TOUCH], ctx, 't2')).session
    const asked = withdrawRound(s, 1, ctx)
    expect(asked.ok).toBe(false)
    if (!asked.ok) expect(asked.confirm?.modules).toEqual(['fe.ui.pane'])
    const done = ok(withdrawRound(s, 1, ctx, true))
    expect(kinds(done.session)).toEqual([])
  })
  it('撤回一项 = 恢复到基线：别的项不动；别的项依赖它时先确认', () => {
    let s = apply(fresh(), [ADD, { op: 'remove', sketch: 'fe.ui', id: 'fe.ui.form' }], ctx)
    s = ok(s)
    const items = changeItems(ok(s).session.doc.sketches, baseline, 'd1')
    const added = items.find(i => i.kind === 'added')!
    const r = ok(withdrawItem(ok(s).session, added, ctx, items))
    expect(kinds(r.session)).toEqual(['removed'])
    // 依赖：先改 ID view→vw，再把 list 降级到 vw 下；撤回改 ID 会让「移动」那一项跟着变
    const chain = ok(
      apply(
        fresh(),
        [
          { op: 'rename', sketch: 'fe.ui', id: 'fe.ui.view', newId: 'vw' },
          { op: 'demote', sketch: 'fe.ui', id: 'fe.ui.list', target: 'fe.ui.vw' },
        ],
        ctx,
      ),
    ).session
    const list = changeItems(chain.doc.sketches, baseline, 'd1')
    const renamed = list.find(i => i.kind === 'renamed')!
    const asked = withdrawItem(chain, renamed, ctx, list)
    expect(asked.ok).toBe(false)
    if (!asked.ok) expect(asked.cascade?.length).toBeGreaterThan(0)
    expect(withdrawItem(chain, renamed, ctx, list, true).ok).toBe(true)
  })
})

describe('X7j 修订：合并只对重指向到结果的关系去重', () => {
  it('与合并无关、草图里本就并存的同对同类型关系不被删掉；重指向到结果后重复的照旧去重', () => {
    const def = seedFromBaseline('fe.ui', baseline, { id: 'd1' })
    def.modules = [...(def.modules ?? []), { id: 'fe.ui.x', name: 'X' }, { id: 'fe.ui.y', name: 'Y' }]
    def.relations = [
      ...(def.relations ?? []),
      { id: 'a1', from: 'fe.ui.form', to: 'fe.ui.list', type: 'commands' },
      { id: 'a2', from: 'fe.ui.form', to: 'fe.ui.list', type: 'commands' },
      { id: 'b1', from: 'fe.ui.x', to: 'fe.ui.form', type: 'queries' },
      { id: 'b2', from: 'fe.ui.y', to: 'fe.ui.form', type: 'queries' },
    ]
    const r = applyDesignEdit({ 'fe.ui': def }, { op: 'merge', sketch: 'fe.ui', ids: ['fe.ui.x', 'fe.ui.y'], name: 'XY', id: 'xy' }, ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const rels = r.design['fe.ui'].relations ?? []
    expect(rels.filter(x => x.id === 'a1' || x.id === 'a2')).toHaveLength(2)
    expect(rels.filter(x => x.from === 'fe.ui.xy' && x.to === 'fe.ui.form')).toHaveLength(1)
  })
})

describe('DL-19 对话在草图里', () => {
  it('进入草图画布缺省「改」，离开时「改」回到「问」；草图里不能切「重讲」，当前版本上不能切「改」', () => {
    const inSketch = dialogueTransition(EMPTY_DIALOGUE, { type: 'setPerspective', perspective: 'sketch', anchor: { kind: 'none' } })
    expect(inSketch.mode).toBe('edit')
    expect(dialogueTransition(inSketch, { type: 'setMode', mode: 'renarrate' }).mode).toBe('edit')
    const asking = dialogueTransition(inSketch, { type: 'setMode', mode: 'ask' })
    expect(asking.mode).toBe('ask')
    const out = dialogueTransition(inSketch, { type: 'setPerspective', perspective: 'structure', anchor: { kind: 'none' } })
    expect(out.mode).toBe('ask')
    expect(dialogueTransition(out, { type: 'setMode', mode: 'edit' }).mode).toBe('ask')
  })
  it('草图里的锚点总带当前张：选中框为框，没有选中为挂载点；锚点条写「当前张 …」', () => {
    expect(anchorOf(null, null, 'state.desk')).toEqual({ kind: 'module', module: 'state.desk', sheet: 'state.desk' })
    expect(anchorOf({ kind: 'module', id: 'state.desk.edit' }, null, 'state.desk')).toEqual({ kind: 'module', module: 'state.desk.edit', sheet: 'state.desk' })
    const name = (id: string) => ({ 'state.desk': 'DeskState', 'state.desk.edit': '编辑' })[id]
    expect(anchorText(null, { kind: 'module', module: 'state.desk', sheet: 'state.desk' }, name)).toBe('当前张 DeskState')
    expect(anchorText(null, { kind: 'module', module: 'state.desk.edit', sheet: 'state.desk' }, name)).toBe('当前张 DeskState · 编辑')
  })
  it('协调者：「改」的一轮说完时先把改动块交给编辑会话，结果写进提议卡并补记进设计的转录；请求带设计与草图上下文', async () => {
    let push: (e: AgentPush) => void = () => {}
    const sent: unknown[] = []
    const recorded: unknown[] = []
    const transport: AgentTransport = {
      turn: async (_p, req) => (sent.push(req), { ok: true }),
      stop: async () => {},
      outcome: async (p, r) => void recorded.push({ p, ...r }),
      subscribe: (_p, cb) => ((push = cb), () => {}),
    }
    const applied: string[] = []
    const d = createDialogue({
      project: 'p',
      index: shallowRef(null),
      selection: shallowRef(null),
      step: shallowRef(null),
      perspective: shallowRef('sketch'),
      transport,
      openTab: () => {},
      sketch: {
        active: () => true,
        design: () => 'd1',
        mount: () => 'fe.ui',
        context: () => ({
          design: 'd1',
          mount: 'fe.ui',
          current: { id: 'd1', mount: 'fe.ui' },
          others: [],
          baseline: { modules: [], relations: [] },
          changes: [],
          principle: null,
        }),
        apply: (_b, turn) => (
          applied.push(turn),
          { kind: 'proposal', applied: true, round: 1, numbers: [1], impact: { modules: 2, scenarios: 0, fresh: false } }
        ),
        nameOf: () => undefined,
      },
    })
    expect(d.state.value.mode).toBe('edit')
    d.send({ text: '合并', mode: 'edit', images: [] })
    await Promise.resolve()
    expect(sent[0]).toMatchObject({ mode: 'edit', design: 'd1', sketch: { mount: 'fe.ui' }, anchor: { kind: 'module', module: 'fe.ui', sheet: 'fe.ui' } })
    expect(d.editing()).toBe(true)
    const turn = (d.state.value.run as { turn: string }).turn
    push({ turn, type: 'done', blocks: [{ kind: 'edit', ops: [MERGE] }] })
    expect(applied).toEqual([turn])
    expect(d.state.value.transcript.at(-1)).toMatchObject({ role: 'agent', outcome: { kind: 'proposal', round: 1 } })
    // 收尾 S3（DL-51）：提议卡的结果随设计的转录落盘
    expect(recorded).toEqual([
      { p: 'p', design: 'd1', turn, outcome: { kind: 'proposal', applied: true, round: 1, numbers: [1], impact: { modules: 2, scenarios: 0, fresh: false } } },
    ])
    expect(d.editing()).toBe(false)
  })
})
