/**
 * 改动项与恢复操作（第二十一轮波 2，T2.1 / T2.2；CI-1、CI-2、CI-5、CI-6、CI-7，DL-1、DL-2、DL-3、DL-6、DL-7）：
 * 编辑操作的 JSON 往返与校验、改动项的血缘聚合（六类）、恢复到基线（六类 + 级联）、编号表、影响面估算、按轮快照、AI 新框安放。
 */
import { describe, expect, it } from 'vitest'
import {
  applyDesignEdit,
  baselineOrigins,
  changeItems,
  EMPTY_CHANGE_TABLE,
  estimateImpact,
  incomingByRelations,
  loadModel,
  numbered,
  parseBlock,
  parseChangeTable,
  parseDesignOps,
  reconcileChanges,
  restoreRoundOps,
  revertOps,
  revertPlan,
  seedFromBaseline,
  touchedBetween,
  validateEditBlock,
  laterTouched,
  type DesignEditContext,
  type DesignEditOp,
  type ModelIndex,
  type RawFile,
  type SketchSet,
} from '../../src/model'
import { placeNewBoxes } from '../../src/layout/placement'
import { SKETCH_NODE } from '../../src/layout/sketch'

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
  - { id: fe.ui.view.header, name: Header, parent: fe.ui.view }
relations:
  - { id: rel.view-api, from: fe.ui.view, to: core.api, type: queries }
  - { id: rel.list-api, from: fe.ui.list, to: core.api, type: queries }
  - { id: rel.view-list, from: fe.ui.view, to: fe.ui.list, type: queries }
  - { id: rel.form-store, from: fe.ui.form, to: core.store, type: commands }
`
const files: RawFile[] = Object.entries({ 'system.yaml': 'system: { id: sys, name: S }', 'intent/skeleton.yaml': SKELETON, 'modules/all.yaml': MODULES }).map(([path, text]) => ({
  path,
  text,
}))
const baseline: ModelIndex = loadModel(files).index
const ctx: DesignEditContext & { baseline: ModelIndex } = { design: 'd1', persistent: baseline.model.sketches, baseline }
const seed = (): SketchSet => ({ 'fe.ui': seedFromBaseline('fe.ui', baseline, { id: 'd1' }) })
const run = (set: SketchSet, ...ops: DesignEditOp[]): SketchSet =>
  ops.reduce<SketchSet>((s, op) => {
    const r = applyDesignEdit(s, op, ctx)
    if (!r.ok) throw new Error(r.reason)
    return r.design
  }, set)
const items = (set: SketchSet) => changeItems(set, baseline, 'd1')
const one = (set: SketchSet) => {
  const list = items(set)
  expect(list).toHaveLength(1)
  return list[0]
}

/** 六类改动各一种做法（相对基线） */
const SIX: Record<string, DesignEditOp[]> = {
  added: [{ op: 'edit', sketch: 'fe.ui', edit: { op: 'addModule', parent: 'fe.ui', name: 'Toast', id: 'toast' } }],
  changed: [{ op: 'edit', sketch: 'fe.ui', edit: { op: 'updateModule', id: 'fe.ui.list', patch: { name: 'Listing', responsibility: '列出条目' } } }],
  merged: [{ op: 'merge', sketch: 'fe.ui', ids: ['fe.ui.view', 'fe.ui.list'], name: 'Pane', id: 'pane' }],
  split: [{ op: 'split', sketch: 'fe.ui', id: 'fe.ui.form', parts: [{ name: 'Fields', id: 'fields' }, { name: 'Submit', id: 'submit' }] }],
  moved: [{ op: 'demote', sketch: 'fe.ui', id: 'fe.ui.list', target: 'fe.ui.view' }],
  renamed: [{ op: 'rename', sketch: 'fe.ui', id: 'fe.ui.list', newId: 'lst' }],
  removed: [{ op: 'remove', sketch: 'fe.ui', id: 'fe.ui.form' }],
}

describe('T2.1 编辑操作的外部表示（DA-9）', () => {
  const samples: DesignEditOp[] = [
    ...Object.values(SIX).flat(),
    { op: 'promote', sketch: 'fe.ui.view', id: 'fe.ui.view.header' },
    { op: 'moveIn', id: 'core.api', layer: 'fe' },
    { op: 'edit', sketch: 'fe.ui', edit: { op: 'connect', from: 'fe.ui.form', to: 'core.api', type: 'queries', description: '查', via: 'bus:x', mode: 'async' } },
    { op: 'edit', sketch: 'fe.ui', edit: { op: 'updateRelation', id: 'rel.view-api', patch: { type: 'commands', description: '' } } },
    { op: 'edit', sketch: 'fe.ui', edit: { op: 'removeRelation', id: 'rel.view-api' } },
    { op: 'edit', sketch: 'fe.ui', edit: { op: 'addInterface', owner: 'fe.ui.view', name: 'render', signature: '() => void' } },
    { op: 'edit', sketch: 'fe.ui', edit: { op: 'updateInterface', id: 'if.x', patch: { name: 'y' } } },
    { op: 'edit', sketch: 'fe.ui', edit: { op: 'removeInterface', id: 'if.x' } },
    { op: 'edit', sketch: 'fe.ui', edit: { op: 'implement', interface: 'if.x', module: 'fe.ui.view' } },
    { op: 'edit', sketch: 'fe.ui', edit: { op: 'setAbstraction', text: '只读派生' } },
    { op: 'edit', sketch: 'fe.ui', edit: { op: 'setClosed', id: 'fe.ui', closed: true } },
    { op: 'edit', sketch: 'fe.ui', edit: { op: 'moveModule', id: 'fe.ui.list', parent: 'fe.ui.view' } },
    { op: 'edit', sketch: 'fe.ui', edit: { op: 'renameModule', id: 'fe.ui.list', newId: 'fe.ui.lst' } },
    { op: 'edit', sketch: 'fe.ui', edit: { op: 'removeModule', id: 'fe.ui.list' } },
    { op: 'edit', sketch: 'fe.ui', edit: { op: 'setMeta', patch: { lifetime: 'until-implemented' } } },
    { op: 'edit', sketch: 'root', edit: { op: 'addLayer', name: 'X', at: 1 } },
    { op: 'edit', sketch: 'root', edit: { op: 'reorderLayer', id: 'fe', to: 1 } },
    { op: 'edit', sketch: 'root', edit: { op: 'setMayDependOn', id: 'fe', layers: ['core'] } },
    { op: 'edit', sketch: 'fe.ui', edit: { op: 'moveNode', positions: { 'fe.ui.view': { x: 1, y: 2 } } } },
    { op: 'edit', sketch: 'fe.ui', edit: { op: 'relabel', id: 'rel.view-api', label: null } },
    { op: 'edit', sketch: 'fe.ui', edit: { op: 'autoArrange' } },
    { op: 'edit', sketch: 'fe.ui', edit: { op: 'addReference', id: 'core.store' } },
    { op: 'edit', sketch: 'fe.ui', edit: { op: 'removeReference', id: 'core.store' } },
    { op: 'restore', remove: [{ sketch: 'fe.ui', id: 'fe.ui.pane' }], restore: ['fe.ui.view'] },
    { op: 'restoreEntities', snapshot: {}, modules: ['fe.ui.view'], relations: [] },
  ]
  it('每种操作 JSON 往返得到同样的值', () => {
    for (const op of samples) {
      const r = parseDesignOps(JSON.parse(JSON.stringify([op])))
      expect(r.ok, JSON.stringify(op)).toBe(true)
      if (r.ok) expect(r.value).toEqual([op])
    }
  })
  it('形状不对的一条让整串拒绝（多出的键、缺字段、不认识的操作、关系类型不对）', () => {
    const good = SIX.added[0]
    for (const bad of [
      { op: 'merge', sketch: 'fe.ui', ids: ['a'], name: 'N' },
      { op: 'edit', sketch: 'fe.ui', edit: { op: 'addModule', parent: 'fe.ui', name: 'X', color: 'red' } },
      { op: 'edit', sketch: 'fe.ui', edit: { op: 'fly' } },
      { op: 'edit', sketch: 'fe.ui', edit: { op: 'connect', from: 'a', to: 'b', type: 'pokes' } },
      { op: 'teleport' },
      { op: 'edit', sketch: 'fe.ui', edit: { op: 'updateModule', id: 'a', patch: { from: ['x'] } } },
    ]) {
      const r = parseDesignOps([good, bad])
      expect(r.ok, JSON.stringify(bad)).toBe(false)
    }
  })
  it('AI 不许出位置类与恢复类操作（DL-6：已有的框 AI 不动）', () => {
    for (const op of ['moveNode', 'relabel', 'autoArrange']) {
      const sample = samples.find(x => x.op === 'edit' && x.edit.op === op)!
      expect(parseDesignOps([sample], { agent: true }).ok).toBe(false)
      expect(parseDesignOps([sample]).ok).toBe(true)
    }
    expect(parseDesignOps([samples.find(x => x.op === 'restore')!], { agent: true }).ok).toBe(false)
  })
  it('薄协议的改动块：合法的交出操作与要撤回的号；非法操作、空块、多出的键整块拒绝', () => {
    const ok = parseBlock({ kind: 'edit', summary: '合并', ops: SIX.merged, withdraw: [2] })
    expect(ok).toEqual({ ok: true, value: { kind: 'edit', summary: '合并', ops: SIX.merged, withdraw: [2] } })
    expect(parseBlock({ kind: 'edit', ops: [] }).ok).toBe(false)
    // 协议只看形状；每条操作的校验与 AI 不许出的操作由改动项的模型判（接入层收块时调，DL-21）
    const moving = parseBlock({ kind: 'edit', ops: [{ op: 'edit', sketch: 'fe.ui', edit: { op: 'moveNode', positions: {} } }] })
    expect(moving.ok).toBe(true)
    if (moving.ok && moving.value.kind === 'edit') expect(validateEditBlock(moving.value).ok).toBe(false)
    expect(parseBlock({ kind: 'edit', ops: [{ nope: 1 }] }).ok).toBe(false)
    expect(parseBlock({ kind: 'edit', ops: SIX.added, files: [] }).ok).toBe(false)
    expect(parseBlock({ kind: 'edit', ops: SIX.added, withdraw: [0] }).ok).toBe(false)
  })
})

describe('CI-1 改动项按血缘聚合（六类）', () => {
  it('底稿相对基线没有改动项', () => expect(items(seed())).toEqual([]))
  it('新增：一项，标在新框上，映射不回基线（标「新」）', () => {
    const set = run(seed(), ...SIX.added)
    const i = one(set)
    expect(i).toMatchObject({ kind: 'added', key: 'added:module:fe.ui.toast', modules: ['fe.ui.toast'] })
    expect(baselineOrigins(i, set, baseline)).toEqual([])
  })
  it('修改：一个框改了几个字段仍是一项；映射回它自己', () => {
    const set = run(seed(), ...SIX.changed)
    const i = one(set)
    expect(i).toMatchObject({ kind: 'changed', fields: ['name', 'responsibility'] })
    expect(baselineOrigins(i, set, baseline)).toEqual(['fe.ui.list'])
  })
  it('合并：一项（重指向的关系并进来）；映射回两者', () => {
    const set = run(seed(), ...SIX.merged)
    const i = one(set)
    expect(i).toMatchObject({ kind: 'merged', id: 'fe.ui.pane', modules: ['fe.ui.pane'] })
    expect(baselineOrigins(i, set, baseline)).toEqual(['fe.ui.list', 'fe.ui.view'])
  })
  it('拆分：一项，标在拆出的框上；映射回原来的', () => {
    const set = run(seed(), ...SIX.split)
    const i = one(set)
    expect(i).toMatchObject({ kind: 'split', id: 'fe.ui.form', modules: ['fe.ui.fields', 'fe.ui.submit'] })
    expect(baselineOrigins(i, set, baseline)).toEqual(['fe.ui.form'])
  })
  it('移动（降级）：一项；映射回原来的', () => {
    const set = run(seed(), ...SIX.moved)
    const list = items(set)
    const i = list.find(x => x.kind === 'moved')!
    expect(i).toMatchObject({ id: 'fe.ui.view.list', mount: 'fe.ui.view' })
    expect(baselineOrigins(i, set, baseline)).toEqual(['fe.ui.list'])
  })
  it('改 ID：一项；映射回原来的', () => {
    const set = run(seed(), ...SIX.renamed)
    const i = one(set)
    expect(i).toMatchObject({ kind: 'renamed', id: 'fe.ui.lst' })
    expect(baselineOrigins(i, set, baseline)).toEqual(['fe.ui.list'])
  })
  it('删除：一项，连带删掉的关系并进来；清单悬停时的虚框取被删的基线 ID', () => {
    const set = run(seed(), ...SIX.removed)
    const i = one(set)
    expect(i).toMatchObject({ kind: 'removed', id: 'fe.ui.form', modules: [], removed: ['fe.ui.form', 'rel.form-store'] })
    expect(baselineOrigins(i, set, baseline)).toEqual(['fe.ui.form'])
  })
  it('改关系算两端：新增一条关系是一项，映射回两端', () => {
    const set = run(seed(), { op: 'edit', sketch: 'fe.ui', edit: { op: 'connect', from: 'fe.ui.form', to: 'fe.ui.view', type: 'queries' } })
    const i = one(set)
    expect(i).toMatchObject({ entity: 'relation', kind: 'added' })
    expect(baselineOrigins(i, set, baseline)).toEqual(['fe.ui.form', 'fe.ui.view'])
  })
})

describe('DL-2 恢复到基线（六类 + 修改 + 关系）', () => {
  for (const [kind, ops] of Object.entries(SIX))
    it(`${kind}：逆向操作应用后这一项消失、相对基线回到 0`, () => {
      const set = run(seed(), ...ops)
      const item = items(set).find(x => x.kind === kind)!
      const r = revertOps(item, set, baseline)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const after = run(set, ...r.ops)
      expect(items(after)).toEqual([])
    })
  it('关系的新增、删除、修改各自恢复', () => {
    for (const op of [
      { op: 'connect', from: 'fe.ui.form', to: 'fe.ui.view', type: 'queries' },
      { op: 'removeRelation', id: 'rel.view-list' },
      { op: 'updateRelation', id: 'rel.view-list', patch: { type: 'commands', description: '改过' } },
    ] as const) {
      const set = run(seed(), { op: 'edit', sketch: 'fe.ui', edit: op })
      const r = revertOps(one(set), set, baseline)
      if (!r.ok) throw new Error(r.reason)
      expect(items(run(set, ...r.ops)), op.op).toEqual([])
    }
  })
  it('只撤一项、别的项不动；被别的项依赖时列出级联', () => {
    // #1 改 ID view→vw，#2 把 list 降级到 vw 下：撤回 #1 时 #2 的 ID 跟着改回，列为级联
    const set = run(seed(), { op: 'rename', sketch: 'fe.ui', id: 'fe.ui.view', newId: 'vw' }, { op: 'demote', sketch: 'fe.ui', id: 'fe.ui.list', target: 'fe.ui.vw' })
    const list = items(set)
    const renamed = list.find(x => x.kind === 'renamed')!
    const moved = list.find(x => x.kind === 'moved')!
    const p = revertPlan(renamed, set, ctx, list)
    expect(p.ok).toBe(true)
    if (p.ok) expect(p.plan.dropped).toContain(moved.key)
    // 撤回一个独立的项：没有级联
    const set2 = run(seed(), ...SIX.added, ...SIX.removed)
    const list2 = items(set2)
    const p2 = revertPlan(list2.find(x => x.kind === 'added')!, set2, ctx, list2)
    expect(p2.ok && p2.plan.dropped.length + p2.plan.altered.length).toBe(0)
    if (p2.ok) expect(items(p2.plan.after).map(i => i.kind)).toEqual(['removed'])
  })
})

describe('DL-3 编号表', () => {
  const at = '2026-11-05T00:00:00Z'
  it('按产生顺序给号；撤回后留空不复用；同一处改动撤回后重做仍得新号', () => {
    const a = run(seed(), ...SIX.added)
    const b = run(a, ...SIX.removed)
    let t = reconcileChanges(EMPTY_CHANGE_TABLE, items(a), { round: 1, by: 'ai' }, at)
    t = reconcileChanges(t, items(b), { round: 2, by: 'human' }, at)
    expect(numbered(t, items(b)).map(i => [i.n, i.kind, i.round, i.by])).toEqual([
      [1, 'added', 1, 'ai'],
      [2, 'removed', 2, 'human'],
    ])
    // 撤回 #1：号留空
    const c = run(seed(), ...SIX.removed)
    t = reconcileChanges(t, items(c), { round: 2, by: 'human' }, at)
    expect(t.items.find(x => x.n === 1)?.withdrawnAt).toBe(at)
    expect(numbered(t, items(c)).map(i => i.n)).toEqual([2])
    // 同一处改动重做：新号 #3
    t = reconcileChanges(t, items(b), { round: 3, by: 'ai' }, at)
    expect(numbered(t, items(b)).map(i => i.n)).toEqual([2, 3])
    expect(t.nextNumber).toBe(4)
    // 没有变化时返回同一个值
    expect(reconcileChanges(t, items(b), { round: 3, by: 'ai' }, at)).toBe(t)
  })
  it('读文件：形状不对的条目丢掉，nextNumber 不小于最大号 + 1', () => {
    expect(parseChangeTable({ nextNumber: 1, items: [{ n: 5, key: 'k', summary: 's', kind: 'added', round: 1, by: 'ai' }, { n: 'x' }] })).toEqual({
      nextNumber: 6,
      items: [{ n: 5, key: 'k', summary: 's', kind: 'added', round: 1, by: 'ai' }],
    })
    expect(parseChangeTable(null)).toEqual(EMPTY_CHANGE_TABLE)
  })
})

describe('DL-7 影响面按当前描述估', () => {
  const incoming = incomingByRelations(baseline)
  it('映射回基线后取传入闭包：改 list 牵动 view（view 依赖它）', () => {
    const set = run(seed(), ...SIX.changed)
    expect(estimateImpact(items(set), set, baseline, baseline, incoming)).toMatchObject({ origins: ['fe.ui.list'], modules: ['fe.ui.list', 'fe.ui.view'], fresh: false })
  })
  it('合并算两者；全新的框标「新」不给数', () => {
    const set = run(seed(), ...SIX.merged)
    expect(estimateImpact(items(set), set, baseline, baseline, incoming).origins).toEqual(['fe.ui.list', 'fe.ui.view'])
    const fresh = run(seed(), ...SIX.added)
    expect(estimateImpact(items(fresh), fresh, baseline, baseline, incoming)).toMatchObject({ fresh: true, modules: [] })
  })
})

describe('DL-1 按轮快照', () => {
  it('撤回更早一轮：那一轮碰过的回到它开始前，后面轮次改的别处不动；后面也碰过的列出来', () => {
    const s0 = seed()
    const s1 = run(s0, ...SIX.removed) // 第 1 轮：删 form
    const s2 = run(s1, ...SIX.added) // 第 2 轮：加 toast
    const touched = touchedBetween(s0, s1)
    expect(touched.modules).toEqual(['fe.ui.form'])
    expect(touched.relations).toEqual(['rel.form-store'])
    const back = run(s2, ...restoreRoundOps(s0, touched))
    expect(items(back).map(i => i.kind)).toEqual(['added'])
    expect(laterTouched(touched, s1, s2)).toEqual({ modules: [], relations: [] })
    // 第 2 轮也碰了第 1 轮碰过的框：列出
    const t1 = touchedBetween(s0, run(s0, ...SIX.changed))
    const s1b = run(s0, ...SIX.changed)
    const s2b = run(s1b, { op: 'edit', sketch: 'fe.ui', edit: { op: 'updateModule', id: 'fe.ui.list', patch: { responsibility: '再改' } } })
    expect(laterTouched(t1, s1b, s2b).modules).toEqual(['fe.ui.list'])
  })
  it('撤回合并的一轮：合并结果与它的下一层草图去掉、来源放回', () => {
    const s0 = seed()
    const s1 = run(s0, ...SIX.merged)
    expect(Object.keys(s1).sort()).toEqual(['fe.ui', 'fe.ui.pane'])
    const back = run(s1, ...restoreRoundOps(s0, touchedBetween(s0, s1)))
    expect(Object.keys(back)).toEqual(['fe.ui'])
    expect(items(back)).toEqual([])
  })
})

describe('DL-6 AI 新框的安放', () => {
  const def = (rels: { from: string; to: string }[] = []) => ({
    ...seedFromBaseline('fe.ui', baseline, { id: 'd1' }),
    modules: [{ id: 'fe.ui.a', name: 'A' }, { id: 'fe.ui.b', name: 'B' }, { id: 'fe.ui.n', name: 'N' }],
    relations: rels.map((r, i) => ({ id: `r${i}`, type: 'queries' as const, ...r })),
  })
  const existing = { 'fe.ui.a': { x: 0, y: 0 }, 'fe.ui.b': { x: 440, y: 0 } }
  it('① 有关系的框旁最近的空位', () => {
    const p = placeNewBoxes(def([{ from: 'fe.ui.n', to: 'fe.ui.b' }]), existing, ['fe.ui.n'], { w: 1200, h: 600 })
    expect(p['fe.ui.n']).toMatchObject({ tier: 'near', y: 0 })
    expect(p['fe.ui.n'].x).toBeGreaterThan(440)
  })
  it('② 没有关系：中心区里的空位', () => {
    const p = placeNewBoxes(def(), existing, ['fe.ui.n'], { w: 1200, h: 600 })
    expect(p['fe.ui.n']).toMatchObject({ tier: 'free', x: 220, y: 0 })
  })
  it('③ 中心区放满：放到右侧', () => {
    const full = { 'fe.ui.a': { x: 0, y: 0 }, 'fe.ui.b': { x: 0, y: 120 } }
    const p = placeNewBoxes(def(), full, ['fe.ui.n'], { w: SKETCH_NODE.w, h: SKETCH_NODE.h + 120 })
    expect(p['fe.ui.n']).toMatchObject({ tier: 'right', x: 220, y: 0 })
  })
  it('已有的框一个不动（只给新框位置）', () => {
    const p = placeNewBoxes(def([{ from: 'fe.ui.n', to: 'fe.ui.a' }]), existing, ['fe.ui.n'])
    expect(Object.keys(p)).toEqual(['fe.ui.n'])
  })
})
