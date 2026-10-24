/**
 * 按设计的编辑会话（desk.edit，X7a、X7g、X7h、X7i、X13、X14、X16–X20，ADR-0025）：会话是一个值、设计级撤销 / 重做、按设计的脏与保存、
 * 推出的草图未改动不算脏、冲突与重放；DeskState 上打开草图即进入、下钻与面包屑、两个对比、两级校验、保存并交给 AI、新建设计的底稿。
 */
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { load, loadModel, seedFromBaseline, sketchCheck, sketchText, type DesignEditContext, type SketchDef } from '../../src/model'
import { createDeskState, type DesignSketchWrite, type ModelPayload, type ModelWriter } from '../../src/state/useDeskState'
import { NO_WRITER } from '../../src/state/sync/writer'
import {
  UNDO_LIMIT,
  apply,
  begin,
  discard,
  isDirty,
  open,
  redo,
  reloaded,
  replay,
  saved,
  sketchDirty,
  splitImpact,
  renameImpact,
  renameHasImpact,
  undo,
  type ReadSketch,
} from '../../src/state/desk/edit/session'
import { saveRequest } from '../../src/state/desk/edit/save'

const SYSTEM = { path: 'system.yaml', text: 'system: { id: sys, name: S }' }
const BASE = {
  path: 'modules.yaml',
  text: `modules:
  - id: core
    name: Core
    kind: layer
    order: 1
    children:
      - id: core.a
        name: A
        children:
          - { id: core.a.x, name: X }
          - { id: core.a.y, name: Y }
          - { id: core.a.z, name: Z }
      - id: core.b
        name: B
        children:
          - { id: core.b.q, name: Q }
relations:
  - { id: r.xy, from: core.a.x, to: core.a.y, type: calls }
  - { id: r.xb, from: core.a.x, to: core.b, type: calls }
`,
}
const baseline = loadModel([SYSTEM, BASE]).index
const SEED = seedFromBaseline('core.a', baseline, { id: 'd' })
const SKETCH = { path: 'sketches/core.a.yaml', text: sketchText(SEED) }
const ctx: DesignEditContext = { design: 'd', persistent: [], baseline }
const target = { kind: 'design' as const, design: 'd' }
const read = (def: SketchDef = SEED, hash = 'h0'): Record<string, ReadSketch> => ({ [def.mount]: { file: `sketches/${def.mount}.yaml`, hash, def } })
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error(JSON.stringify(r))
  return r as Extract<T, { ok: true }>
}

describe('编辑会话的纯函数（X7g、X7i、X20）', () => {
  const s0 = begin(target, 'd', read())

  it('begin：文档即读到的各张草图，当前张为主草图（根挂载在前），不脏', () => {
    expect(s0.mount).toBe('core.a')
    expect(s0.doc.sketches['core.a']).toEqual(SEED)
    expect(isDirty(s0, baseline)).toBe(false)
    const both = begin(target, 'd', { ...read(), ...read({ id: 'd', mount: 'root', modules: [] }) })
    expect(both.mount).toBe('root')
  })

  it('apply：一步压撤销栈、清空重做栈；几个操作原子地成一步；任一被拒绝时会话不变', () => {
    const a = ok(apply(s0, { op: 'edit', sketch: 'core.a', edit: { op: 'addModule', parent: 'core.a', name: 'W', id: 'w' } }, ctx))
    expect([a.session.past.length, isDirty(a.session, baseline)]).toEqual([1, true])
    const two = ok(
      apply(
        s0,
        [
          { op: 'edit', sketch: 'core.a', edit: { op: 'addModule', parent: 'core.a', name: 'W', id: 'w' } },
          { op: 'edit', sketch: 'core.a', edit: { op: 'moveNode', positions: { 'core.a.w': { x: 9, y: 9 } } } },
        ],
        ctx,
      ),
    )
    expect(two.session.past).toHaveLength(1)
    expect(two.session.doc.sketches['core.a'].layout?.modules?.['core.a.w']).toEqual({ x: 9, y: 9 })
    const bad = apply(
      a.session,
      [
        { op: 'edit', sketch: 'core.a', edit: { op: 'addModule', parent: 'core.a', name: 'V', id: 'v' } },
        { op: 'edit', sketch: 'core.a', edit: { op: 'removeModule', id: 'nope' } },
      ],
      ctx,
    )
    expect(bad.ok).toBe(false)
  })

  it('X7g 设计级撤销：降级一步改两张草图，撤销一步回滚两张，重做恢复；新操作清空重做栈', () => {
    const a = ok(apply(s0, { op: 'demote', sketch: 'core.a', id: 'core.a.y', target: 'core.a.x' }, ctx))
    expect(a.effects.sketches.sort()).toEqual(['core.a', 'core.a.x'])
    expect(Object.keys(a.session.doc.sketches).sort()).toEqual(['core.a', 'core.a.x'])
    const u = undo(a.session)!
    expect(u.session.doc).toBe(s0.doc)
    expect(isDirty(u.session, baseline)).toBe(false)
    const r = redo(u.session)!
    expect(r.session.doc).toBe(a.session.doc)
    const again = ok(apply(u.session, { op: 'edit', sketch: 'core.a', edit: { op: 'autoArrange' } }, ctx))
    expect(again.session.future).toEqual([])
    expect(undo(s0)).toBeNull()
  })

  it('X7g：撤销的一步在别的草图上时切到那张；重做切到那一步做完后所在的草图', () => {
    const a = ok(apply(s0, { op: 'edit', sketch: 'core.a', edit: { op: 'autoArrange' } }, ctx))
    const child = ok(open(a.session, 'core.a.x', ctx))
    expect(child.session.mount).toBe('core.a.x')
    const u = undo(child.session)!
    expect(u.session.mount).toBe('core.a')
    expect(redo(u.session)!.session.mount).toBe('core.a')
  })

  it('X7g：撤销栈深度上限', () => {
    let s = s0
    for (let k = 0; k < UNDO_LIMIT + 5; k++)
      s = ok(apply(s, { op: 'edit', sketch: 'core.a', edit: { op: 'moveNode', positions: { 'core.a.x': { x: k, y: 0 } } } }, ctx)).session
    expect(s.past).toHaveLength(UNDO_LIMIT)
  })

  it('X18、X20：下钻时推出的草图只在会话里、不进撤销栈、未改动不算脏；改了才脏、作为新文件写出', () => {
    const c = ok(open(s0, 'core.a.x', ctx)).session
    expect(c.doc.sketches['core.a.x']).toMatchObject({ mount: 'core.a.x', modules: [] })
    expect([c.past.length, isDirty(c, baseline)]).toEqual([0, false])
    const m = ok(apply(c, { op: 'edit', sketch: 'core.a.x', edit: { op: 'addModule', parent: 'core.a.x', name: 'K', id: 'k' } }, ctx)).session
    expect(sketchDirty(m, 'core.a.x', baseline)).toBe(true)
    expect(saveRequest(m, baseline).sketches).toEqual([{ mount: 'core.a.x', sketch: m.doc.sketches['core.a.x'], baseHash: null }])
  })

  it('T1 裁决 5：合并时写入的下一层草图与推出结果相同（只差位置）不算脏、不写文件', () => {
    const m = ok(apply(s0, { op: 'merge', sketch: 'core.a', ids: ['core.a.x', 'core.a.y'], name: 'XY', id: 'xy' }, ctx)).session
    expect(Object.keys(m.doc.sketches).sort()).toEqual(['core.a', 'core.a.xy'])
    expect(sketchDirty(m, 'core.a.xy', baseline)).toBe(false)
    expect(saveRequest(m, baseline).sketches.map(w => w.mount)).toEqual(['core.a'])
  })

  it('X12、X20：级联改名的草图写到新挂载点并带 renamedFrom；删掉的草图带读取时的指纹列入 removed', () => {
    const two = { ...read(), ...read({ id: 'd', mount: 'core.a.x', modules: [{ id: 'core.a.x.k', name: 'K' }] }, 'hx') }
    const s = begin(target, 'd', two)
    const r = ok(apply(s, { op: 'rename', sketch: 'core.a', id: 'core.a.x', newId: 'ex' }, ctx)).session
    const req = saveRequest(r, baseline)
    expect(req.sketches.find(w => w.mount === 'core.a.ex')).toMatchObject({ baseHash: 'hx', renamedFrom: 'core.a.x' })
    const d = ok(apply(s, { op: 'remove', sketch: 'core.a', id: 'core.a.x' }, ctx)).session
    expect(saveRequest(d, baseline).removed).toEqual([{ mount: 'core.a.x', baseHash: 'hx' }])
  })

  it('X22：引用节点的位置不写回——旧草图里记下的引用坐标保存时去掉，有关系的引用不算丢掉', () => {
    const def = s0.doc.sketches['core.a']
    const old = { ...def, layout: { modules: { 'core.a.x': { x: 1, y: 2 }, 'core.b': { x: 900, y: 40 } } } }
    const r = ok(apply(s0, { op: 'edit', sketch: 'core.a', edit: { op: 'moveNode', positions: { 'core.a.y': { x: 5, y: 6 } } } }, ctx)).session
    const withOld = {
      ...r,
      doc: { ...r.doc, sketches: { ...r.doc.sketches, 'core.a': { ...old, layout: { modules: { ...old.layout.modules, 'core.a.y': { x: 5, y: 6 } } } } } },
    }
    const req = saveRequest(withOld, baseline)
    expect(req.sketches[0].sketch.layout!.modules).toEqual({ 'core.a.x': { x: 1, y: 2 }, 'core.a.y': { x: 5, y: 6 } })
    expect(req.dropped).toEqual([])
  })

  it('X19：保存前丢掉没有关系的引用节点，并列出', () => {
    const r = ok(apply(s0, { op: 'edit', sketch: 'core.a', edit: { op: 'addReference', id: 'core.b.q' } }, ctx)).session
    const req = saveRequest(r, baseline)
    expect(req.dropped).toEqual([{ mount: 'core.a', ids: ['core.b.q'] }])
    expect(req.sketches[0].sketch.layout?.modules?.['core.b.q']).toBeUndefined()
  })

  it('X7h：当前张被删除（或改名）时当前张跟着走——删除回到父草图', () => {
    const c = ok(open(s0, 'core.a.x', ctx)).session
    const m = ok(apply(c, { op: 'edit', sketch: 'core.a.x', edit: { op: 'addModule', parent: 'core.a.x', name: 'K', id: 'k' } }, ctx)).session
    const d = ok(apply(m, { op: 'remove', sketch: 'core.a', id: 'core.a.x' }, ctx)).session
    expect(d.mount).toBe('core.a')
    const r = ok(apply(m, { op: 'rename', sketch: 'core.a', id: 'core.a.x', newId: 'ex' }, ctx)).session
    expect(r.mount).toBe('core.a.ex')
  })

  it('X7k：拆分前的二次确认——原模块有下一层草图（设计里的，或基线子树推出的）时列出、需确认；没有或保留原 ID 时不需确认；不成立时为原因', () => {
    const split = (id: string, ids = ['p1', 'p2'], sketch = 'core.a') => ({
      op: 'split' as const,
      sketch,
      id,
      parts: ids.map(x => ({ name: x.toUpperCase(), id: x })),
    })
    expect(splitImpact(s0, split('core.a.x'), ctx)).toEqual({ ok: true, sketches: [] })
    // 只下钻没改：推出的空草图不算
    const opened = ok(open(s0, 'core.a.x', ctx)).session
    expect(splitImpact(opened, split('core.a.x'), ctx)).toEqual({ ok: true, sketches: [] })
    // 下一层草图改过：随拆分删除，需确认；会话不变
    const c = ok(apply(opened, { op: 'edit', sketch: 'core.a.x', edit: { op: 'addModule', parent: 'core.a.x', name: 'K', id: 'k' } }, ctx)).session
    expect(splitImpact(c, split('core.a.x'), ctx)).toEqual({ ok: true, sketches: [{ mount: 'core.a.x', modules: 1, derived: false }] })
    expect(c.doc.sketches['core.a.x']).toBeDefined()
    expect(splitImpact(c, split('core.a.x', ['x', 'p2']), ctx)).toEqual({ ok: true, sketches: [] })
    expect(splitImpact(c, split('core.a.x', ['p1']), ctx)).toMatchObject({ ok: false })
    // 基线里有子树、下一层还没打开：按基线推出并计入
    const root = begin(target, 'd', read(seedFromBaseline('root', baseline, { id: 'd' })))
    expect(splitImpact(root, split('core.b', ['p1', 'p2'], 'root'), ctx)).toEqual({ ok: true, sketches: [{ mount: 'core.b', modules: 1, derived: true }] })
  })

  it('X7d 表单改 ID 的影响（提交前预览，不改会话）：后代数、关系数、随之改名的下一层草图文件、当前版本里的引用；没有影响时直接应用', () => {
    const rename = (id: string, newId: string, sketch = 'core.a') => ({ op: 'rename' as const, sketch, id, newId })
    // 基线模块、有关系：本张关系两条，当前版本里模块 1 + 关系 2
    const a = ok(renameImpact(s0, rename('core.a.x', 'xx'), ctx, baseline)).impact!
    expect(a).toMatchObject({ to: 'core.a.xx', descendants: 0, sketches: [] })
    expect(a.relations).toBe(2)
    expect(a.current).toBe(3)
    expect(renameHasImpact(a)).toBe(true)
    // 下一层草图里有子模块：后代 1 个，下一层草图随之改名（会话里推出、未读自文件）；会话不变
    const opened = ok(open(s0, 'core.a.x', ctx)).session
    const c = ok(apply(opened, { op: 'edit', sketch: 'core.a.x', edit: { op: 'addModule', parent: 'core.a.x', name: 'K', id: 'k' } }, ctx)).session
    const b = ok(renameImpact({ ...c, mount: 'core.a' }, rename('core.a.x', 'xx'), ctx, baseline)).impact!
    expect(b.descendants).toBe(1)
    expect(b.sketches).toEqual([{ from: 'core.a.x', to: 'core.a.xx', file: false }])
    expect(c.doc.sketches['core.a.x']).toBeDefined()
    // 新建的模块、没有关系与下一层、当前版本里没有：没有影响
    const n = ok(apply(s0, { op: 'edit', sketch: 'core.a', edit: { op: 'addModule', parent: 'core.a', name: 'N', id: 'n' } }, ctx)).session
    const fresh = ok(renameImpact(n, rename('core.a.n', 'm'), ctx, baseline)).impact!
    expect(fresh).toEqual({ to: 'core.a.m', descendants: 0, relations: 0, sketches: [], current: 0 })
    expect(renameHasImpact(fresh)).toBe(false)
    // 新旧相同为 null；重复的 ID 不成立
    expect(ok(renameImpact(s0, rename('core.a.x', 'x'), ctx, baseline)).impact).toBeNull()
    expect(renameImpact(s0, rename('core.a.x', 'y'), ctx, baseline)).toMatchObject({ ok: false })
  })

  it('持久草图只有这一张：不能下钻、不能做改动下一层草图的操作', () => {
    const p = begin({ kind: 'persistent', id: 'skeleton' }, 'skeleton', read())
    expect(open(p, 'core.a.x', ctx).ok).toBe(false)
    expect(apply(p, { op: 'merge', sketch: 'core.a', ids: ['core.a.x', 'core.a.y'], name: 'XY', id: 'xy' }, ctx).ok).toBe(false)
  })

  it('保存即清空两个栈、接上新指纹；重新加载：指纹相同不变，内容与会话一致接上新指纹，否则标为已过时', () => {
    const a = ok(apply(s0, { op: 'edit', sketch: 'core.a', edit: { op: 'autoArrange' } }, ctx)).session
    const def = a.doc.sketches['core.a']
    const sv = saved(a, { 'core.a': def }, { 'core.a': { file: 'sketches/core.a.yaml', hash: 'h1' } })
    expect(sv).toMatchObject({ past: [], future: [], read: { 'core.a': { hash: 'h1' } } })
    expect(isDirty(sv, baseline)).toBe(false)
    expect(reloaded(a, read())).toBe(a)
    expect(reloaded(a, read(def, 'h1'))).toMatchObject({ stale: false, read: { 'core.a': { hash: 'h1' } }, past: [] })
    expect(reloaded(a, read(SEED, 'h9')).stale).toBe(true)
  })

  it('X7i：把本次的每一步重放到新文件上；失败的列出、仍为已过时；放弃本次改动以新文件重新开始', () => {
    let a = ok(apply(s0, { op: 'edit', sketch: 'core.a', edit: { op: 'addModule', parent: 'core.a', name: 'W', id: 'w' } }, ctx)).session
    a = ok(apply(a, { op: 'edit', sketch: 'core.a', edit: { op: 'updateModule', id: 'core.a.z', patch: { name: 'Z2' } } }, ctx)).session
    const external: SketchDef = { ...SEED, modules: [...SEED.modules!, { id: 'core.a.v', name: 'V' }] }
    const good = replay(a, read(external, 'h2'), ctx)
    expect(good.failed).toEqual([])
    expect(good.session.doc.sketches['core.a'].modules!.map(m => m.id)).toEqual(['core.a.x', 'core.a.y', 'core.a.z', 'core.a.v', 'core.a.w'])
    expect(good.session).toMatchObject({ stale: false, read: { 'core.a': { hash: 'h2' } } })
    const gone: SketchDef = { ...SEED, modules: SEED.modules!.filter(m => m.id !== 'core.a.z') }
    const bad = replay(a, read(gone, 'h3'), ctx)
    expect(bad.failed).toEqual([{ op: 'edit', sketch: 'core.a', edit: { op: 'updateModule', id: 'core.a.z', patch: { name: 'Z2' } } }])
    expect(bad.session.stale).toBe(true)
    const fresh = discard(bad.session, read(gone, 'h3'))
    expect([fresh.stale, isDirty(fresh, baseline), fresh.past.length]).toEqual([false, false, 0])
  })
})

// ── DeskState 上的草图画布 ──

function fakeWriter(over: Partial<ModelWriter> = {}) {
  const designs: { design: string; sketches: DesignSketchWrite[]; removed?: unknown[] }[] = []
  const saves: { sketch: SketchDef; baseHash: string }[] = []
  const created: { id: string; mount?: string; sketch?: SketchDef }[] = []
  const writer: ModelWriter = {
    ...NO_WRITER,
    saveSketch: async b => (saves.push(b), { ok: true, file: 'x', hash: 'k1' }),
    saveDesignSketches: async b => (
      designs.push(b),
      { ok: true, files: b.sketches.map(w => ({ mount: w.mount, file: `designs/d/sketches/${w.mount}.yaml`, hash: `n-${w.mount}` })), removed: [], dropped: [] }
    ),
    createDesign: async b => (created.push(b), { ok: true, file: 'y' }),
    ...over,
  }
  return { writer, designs, saves, created }
}

const SKELETON = {
  path: 'intent/skeleton.yaml',
  text: 'sketch:\n  id: skeleton\n  mount: root\n  lifetime: persistent\n  modules:\n    - { id: core, name: Core, kind: layer, order: 1, children: [{ id: core.a, name: A }, { id: core.b, name: B }] }\n',
}

async function setup(version: { design: string; revision: string } | { intent: string } | undefined, writer: ModelWriter, extra: Partial<ModelPayload> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push('/')
  let payload: ModelPayload = {
    dir: 'x',
    files: version ? [SYSTEM, SKELETON, SKETCH] : [SYSTEM, BASE, SKELETON],
    compare: { current: { label: '当前版本', dir: 'x', files: [SYSTEM, BASE] } },
    sketch: { file: 'designs/d/sketches/core.a.yaml', path: 'sketches/core.a.yaml', hash: 'h0' },
    sketchFiles: [{ mount: 'core.a', file: 'designs/d/sketches/core.a.yaml', path: 'sketches/core.a.yaml', hash: 'h0' }],
    sketchPrompt: 'PROMPT',
    designs: [{ id: 'd', name: 'D', status: 'draft', revisions: [], problems: [] }],
    ...extra,
  }
  const desk = createDeskState(async () => payload, { version, writer })
  desk.attachRouter(router)
  await desk.init()
  return { desk, setPayload: (p: Partial<ModelPayload>) => (payload = { ...payload, ...p }) }
}

const SKETCH_VERSION = { design: 'd', revision: 'sketch' }

describe('desk.edit：草图画布与 DeskState', () => {
  it('X7a：打开草图版本即进入草图画布（层次 = 当前张的挂载点）；当前版本与设计轮次上没有会话', async () => {
    const { writer } = fakeWriter()
    expect((await setup(undefined, writer)).desk.edit.active.value).toBe(false)
    expect((await setup({ design: 'd', revision: 'r1' }, writer)).desk.edit.active.value).toBe(false)
    const { desk } = await setup(SKETCH_VERSION, writer)
    expect(desk.edit.active.value).toBe(true)
    expect(desk.state.value.editing).toEqual({ kind: 'design', design: 'd' })
    expect(desk.levelId.value).toBe('core.a')
    expect(desk.view.value).toBeNull()
  })

  it('派生：index 为设计的索引（含引用的外部模块）；画布数据含引用节点与直线边、无 layout 时网格布局一次且不算脏', async () => {
    const { desk } = await setup(SKETCH_VERSION, fakeWriter().writer)
    expect(desk.index.value!.modules.has('core.a.x')).toBe(true)
    expect(desk.index.value!.modules.has('core.b')).toBe(true)
    const scene = desk.edit.scene.value!
    expect(scene.nodes.filter(n => n.data.kind === 'frame').map(n => n.data.frame)).toEqual(['system', 'center', 'column'])
    expect(scene.nodes.filter(n => n.data.kind !== 'frame').map(n => [n.id, n.data.kind])).toEqual([
      ['core.a.x', 'module'],
      ['core.a.y', 'module'],
      ['core.a.z', 'module'],
      ['core.b', 'reference'],
    ])
    expect(scene.edges.map(e => e.id)).toEqual(['r.xy', 'r.xb'])
    expect([desk.edit.needsLayout.value, desk.edit.dirty.value]).toEqual([true, false])
  })

  it('X22：「隐藏外部引用」只改会话里的显示——引用与引用线不画、中心区变宽，草图不变、不算脏', async () => {
    const { desk } = await setup(SKETCH_VERSION, fakeWriter().writer)
    const before = desk.edit.scene.value!
    const def = desk.edit.sketch.value
    desk.edit.toggleReferences()
    const after = desk.edit.scene.value!
    expect(after.nodes.some(n => n.data.kind === 'reference')).toBe(false)
    expect(after.edges.map(e => e.id)).toEqual(['r.xy'])
    expect(after.center!.w).toBeGreaterThan(before.center!.w)
    expect([desk.edit.sketch.value, desk.edit.dirty.value, desk.edit.session.value!.past.length]).toEqual([def, false, 0])
    desk.edit.toggleReferences()
    expect(desk.edit.scene.value!.nodes.some(n => n.data.kind === 'reference')).toBe(true)
  })

  it('X15：第一次拖动落下整张的初始布局，一步；新建（双击空白）与落位是一步并选中新模块', async () => {
    const { desk } = await setup(SKETCH_VERSION, fakeWriter().writer)
    ok(desk.edit.moveNode({ 'core.a.x': { x: 500, y: 500 } }))
    expect(Object.keys(desk.edit.sketch.value!.layout!.modules!).sort()).toEqual(['core.a.x', 'core.a.y', 'core.a.z'])
    expect(desk.edit.session.value!.past).toHaveLength(1)
    ok(desk.edit.addModule('Wide', 'wide', { x: 10, y: 20 }))
    expect(desk.edit.sketch.value!.layout!.modules!['core.a.wide']).toEqual({ x: 10, y: 20 })
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'core.a.wide' })
    expect(desk.edit.session.value!.past).toHaveLength(2)
    expect(desk.edit.addModule('中文', '').ok).toBe(false)
  })

  it('X17：底稿复制后相对基线 0；合并两个后「合并 1」，图上标出变更时合并结果带角标', async () => {
    const { desk } = await setup(SKETCH_VERSION, fakeWriter().writer)
    const zero = desk.edit.vsBaseline.value!.counts
    expect(Object.values(zero).every(n => n === 0)).toBe(true)
    ok(desk.edit.merge(['core.a.x', 'core.a.y'], 'XY', 'xy'))
    expect(desk.edit.vsBaseline.value!.counts.merged).toBe(1)
    expect(desk.edit.vsBaseline.value!.sheet?.mount).toBe('core.a')
    expect(desk.edit.scene.value!.nodes.find(n => n.id === 'core.a.xy')?.data.change).toBe('merged')
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'core.a.xy' })
    // 相对当前版本：只比结构
    expect(desk.edit.vsCurrent.value!.mode).toBe('current')
  })

  it('F-27：下钻打开挂在它身上的草图（会话里推出），面包屑返回；下钻与返回改层次、清空选中', async () => {
    const { desk } = await setup(SKETCH_VERSION, fakeWriter().writer)
    ok(desk.edit.merge(['core.a.x', 'core.a.y'], 'XY', 'xy'))
    ok(desk.edit.openChild('core.a.xy'))
    expect([desk.edit.mount.value, desk.levelId.value, desk.selection.value]).toEqual(['core.a.xy', 'core.a.xy', null])
    expect(desk.edit.scene.value!.nodes.filter(n => n.data.kind === 'module').map(n => n.id)).toEqual(['core.a.xy.x', 'core.a.xy.y'])
    expect(desk.edit.breadcrumb.value.map(b => b.mount)).toEqual(['root', 'core.a', 'core.a.xy'])
    expect(desk.edit.dirty.value).toBe(true) // 本层的合并
    ok(desk.edit.openMount('core.a'))
    expect(desk.levelId.value).toBe('core.a')
    expect(desk.edit.openChild('nope').ok).toBe(false)
  })

  it('F-26：降级（拖到同层节点上）一步改两张、撤销回滚两张；升级（在下一层拖到面包屑父级）', async () => {
    const { desk } = await setup(SKETCH_VERSION, fakeWriter().writer)
    ok(desk.edit.demote('core.a.z', 'core.a.x'))
    expect(desk.edit.session.value!.doc.sketches['core.a.x'].modules!.map(m => m.id)).toEqual(['core.a.x.z'])
    expect(desk.edit.vsBaseline.value!.counts.moved).toBe(1)
    desk.edit.undo()
    expect(Object.keys(desk.edit.session.value!.doc.sketches)).toEqual(['core.a'])
    desk.edit.redo()
    ok(desk.edit.openChild('core.a.x'))
    ok(desk.edit.promote('core.a.x.z'))
    expect(desk.edit.sketch.value!.modules).toEqual([])
    expect(desk.edit.session.value!.doc.sketches['core.a'].modules!.map(m => m.id)).toContain('core.a.z')
  })

  it('X14、X13、X16：两级校验（本张与全设计）；超七只是提示；拆分后待重连为语义提示', async () => {
    const { desk } = await setup(SKETCH_VERSION, fakeWriter().writer)
    for (const k of ['a', 'b', 'c', 'd', 'e']) ok(desk.edit.addModule(k.toUpperCase(), k))
    expect(desk.edit.overSeven.value?.message).toContain('8 个模块')
    expect(desk.edit.designWarnings.value).toEqual([])
    ok(
      desk.edit.split('core.a.x', [
        { name: 'X1', id: 'x1' },
        { name: 'X2', id: 'x2' },
      ]),
    )
    expect(desk.edit.pending.value.sort()).toEqual(['r.xb', 'r.xy'])
    expect(desk.edit.designWarnings.value.map(w => w.code)).toContain('sketch.pending')
    expect(desk.edit.designErrors.value).toEqual([])
  })

  it('X19：删引用节点 = 删它的关系；删模块前可预览级联', async () => {
    const { desk } = await setup(SKETCH_VERSION, fakeWriter().writer)
    expect(desk.edit.previewRemove(['core.a.x'])).toMatchObject({ removed: expect.arrayContaining(['core.a.x', 'r.xy', 'r.xb']) })
    ok(desk.edit.remove(['core.b']))
    expect(desk.edit.sketch.value!.relations!.map(r => r.id)).toEqual(['r.xy'])
    expect(desk.edit.scene.value!.nodes.some(n => n.id === 'core.b')).toBe(false)
  })

  it('X20：保存整个设计——改过的草图带读取时的指纹；成功后停留在草图、清空撤销栈、不脏；有未保存改动时离开要确认', async () => {
    const { writer, designs } = fakeWriter()
    const { desk } = await setup(SKETCH_VERSION, writer)
    ok(desk.edit.connect('core.a.y', 'core.a.z', 'calls', '连一条'))
    expect(desk.edit.canLeave()).toBe('confirm')
    expect(desk.edit.exit()).toBe('confirm')
    expect(await desk.edit.save()).toMatchObject({ ok: true })
    expect(designs[0]).toMatchObject({ design: 'd', sketches: [{ mount: 'core.a', baseHash: 'h0' }] })
    expect([desk.edit.active.value, desk.edit.canUndo.value, desk.edit.dirty.value, desk.edit.canLeave()]).toEqual([true, false, false, 'free'])
    expect(desk.edit.exit()).toBe('done')
    expect(desk.state.value.editing).toBeNull()
  })

  it('X7i：任一文件指纹不符即整次拒绝、已过时；重新加载并重放；放弃本次改动', async () => {
    const { writer } = fakeWriter({ saveDesignSketches: async () => ({ ok: false, error: '文件已变', conflict: true }) })
    const { desk, setPayload } = await setup(SKETCH_VERSION, writer)
    ok(desk.edit.updateModule('core.a.z', { name: 'Z2' }))
    expect(await desk.edit.save()).toMatchObject({ ok: false, conflict: true })
    expect(desk.edit.stale.value).toBe(true)
    const changed: SketchDef = { ...SEED, modules: SEED.modules!.filter(m => m.id !== 'core.a.z') }
    setPayload({
      files: [SYSTEM, SKELETON, { path: 'sketches/core.a.yaml', text: sketchText(changed) }],
      sketchFiles: [{ mount: 'core.a', file: 'designs/d/sketches/core.a.yaml', path: 'sketches/core.a.yaml', hash: 'h5' }],
    })
    expect((await desk.edit.replayOnReload()).failed).toHaveLength(1)
    expect(desk.edit.stale.value).toBe(true)
    await desk.edit.discard()
    expect([desk.edit.stale.value, desk.edit.dirty.value, desk.edit.session.value!.read['core.a'].hash]).toEqual([false, false, 'h5'])
  })

  it('保存期间到达的重新加载（本次写回触发的热更新）推迟到保存完再比对，不把自己的写回认成外部改动（第五轮 T4）', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    const { writer } = fakeWriter({
      saveDesignSketches: async b => {
        await gate
        return {
          ok: true,
          files: b.sketches.map(w => ({ mount: w.mount, file: `designs/d/sketches/${w.mount}.yaml`, hash: 'h-saved' })),
          removed: [],
          dropped: [],
        }
      },
    })
    const { desk, setPayload } = await setup(SKETCH_VERSION, writer)
    ok(desk.edit.updateModule('core.a.z', { name: 'Z2' }))
    const written = desk.edit.sketch.value!
    const saving = desk.edit.save()
    // 保存进行中继续编辑，同时热更新送来刚写下的文件
    ok(desk.edit.updateModule('core.a.y', { name: 'Y2' }))
    setPayload({
      files: [SYSTEM, SKELETON, { path: 'sketches/core.a.yaml', text: sketchText(written) }],
      sketchFiles: [{ mount: 'core.a', file: 'designs/d/sketches/core.a.yaml', path: 'sketches/core.a.yaml', hash: 'h-saved' }],
    })
    await desk.reload()
    expect(desk.edit.stale.value).toBe(false)
    release()
    expect(await saving).toMatchObject({ ok: true })
    expect([desk.edit.stale.value, desk.edit.session.value!.read['core.a'].hash, desk.edit.dirty.value]).toEqual([false, 'h-saved', true])
  })

  it('F-52：保存并交给 AI——有语义提示时不做并说明；有未保存改动先保存，再给出指令', async () => {
    const { writer, designs } = fakeWriter()
    const { desk } = await setup(SKETCH_VERSION, writer)
    ok(
      desk.edit.split('core.a.z', [
        { name: 'Z1', id: 'z1' },
        { name: 'Z2', id: 'z2' },
      ]),
    )
    ok(desk.edit.connect('core.a.z1', 'core.a.x', 'calls'))
    expect(await desk.edit.saveAndHandToAi()).toMatchObject({ ok: true, prompt: 'PROMPT' })
    expect(designs).toHaveLength(1)
    ok(
      desk.edit.split('core.a.x', [
        { name: 'X1', id: 'x1' },
        { name: 'X2', id: 'x2' },
      ]),
    )
    expect(await desk.edit.saveAndHandToAi()).toMatchObject({ ok: false, reason: expect.stringContaining('语义提示') })
  })

  it('持久草图版本：只有这一张，单张写回；不能下钻', async () => {
    const { writer, saves } = fakeWriter()
    const { desk } = await setup({ intent: 'skeleton' }, writer, {
      files: [SYSTEM, SKELETON],
      sketch: { file: 'intent/skeleton.yaml', path: 'intent/skeleton.yaml', hash: 'k0' },
      sketchFiles: undefined,
    })
    expect([desk.edit.active.value, desk.edit.mount.value]).toEqual([true, 'root'])
    ok(desk.edit.addModule('Share', 'share'))
    expect(desk.edit.openChild('core.a').ok).toBe(false)
    await desk.edit.save()
    expect(saves[0]).toMatchObject({ target: { kind: 'persistent', id: 'skeleton' }, baseHash: 'k0' })
  })

  it('X17：持久草图只有「相对当前版本」——偏差与 sketchCheck 同一口径（骨架与当前版本一致时为 0）；交给 AI 的改动摘要另算，对象是去掉这张草图贡献后的当前版本（同服务端）', async () => {
    const LEAF = { path: 'modules/leaf.yaml', text: 'modules:\n  - { id: core.a.x, name: X, parent: core.a }\n' }
    const { desk } = await setup({ intent: 'skeleton' }, fakeWriter().writer, {
      files: [SYSTEM, SKELETON],
      compare: { current: { label: '当前版本', dir: 'x', files: [SYSTEM, SKELETON, LEAF] } },
      sketch: { file: 'intent/skeleton.yaml', path: 'intent/skeleton.yaml', hash: 'k0' },
      sketchFiles: undefined,
    })
    expect([desk.edit.twoBases, desk.edit.compareMode.value, desk.edit.vsBaseline.value]).toEqual([false, 'current', null])
    desk.edit.setCompareMode('baseline')
    expect(desk.edit.compareMode.value).toBe('current')
    expect(desk.edit.baselineFallback.value).toBe(false)
    // 偏差：骨架与当前版本一致（当前版本里的骨架就是这张草图本身），页面侧计数与本张清单都为 0，同命令行 sketch-check
    const zero = { added: 0, changed: 0, renamed: 0, merged: 0, split: 0, moved: 0, removed: 0 }
    expect(desk.edit.vsCurrent.value!.counts).toMatchObject(zero)
    expect(desk.edit.vsCurrent.value!.sheet!.changes).toEqual([])
    expect(sketchCheck(load([SKELETON]).model.sketches[0], desk.edit.currentIndex.value!).consistent).toBe(true)
    expect(desk.edit.comparison.value).toBe(desk.edit.vsCurrent.value)
    // 交给 AI 时的改动摘要：去掉这张草图之后层与第二级都不在，全部计为新增；不进计数（comparison 仍是偏差）
    expect(desk.edit.handoff.value!.counts.added).toBeGreaterThan(0)
    // 名称与位置仍取完整的当前版本
    expect(desk.edit.currentIndex.value!.modules.has('core.a')).toBe(true)
  })

  it('X21 根草图的层带：带内新建与落位一步（y 记相对带顶）；拖到另一条带 = 移入，与落位是一步（y 相对目标带顶）；层带按 order、带内模块数', async () => {
    const { desk } = await setup({ intent: 'skeleton' }, fakeWriter().writer, {
      files: [SYSTEM, SKELETON],
      sketch: { file: 'intent/skeleton.yaml', path: 'intent/skeleton.yaml', hash: 'k0' },
      sketchFiles: undefined,
    })
    ok(desk.edit.addModule('Share', 'share'))
    expect(desk.edit.scene.value!.bands.map(b => b.id)).toEqual(['core', 'share'])
    const coreTop = desk.edit.scene.value!.bands.find(b => b.id === 'core')!.y
    ok(desk.edit.addModule('N', 'n', { x: 520, y: coreTop + 40 }, 'core'))
    expect(desk.edit.sketch.value!.layout!.modules!['core.n']).toEqual({ x: 520, y: 40 })
    const past = desk.edit.session.value!.past.length
    const shareTop = desk.edit.scene.value!.bands.find(b => b.id === 'share')!.y
    ok(desk.edit.moveIn('core.b', 'share', { x: 300, y: shareTop + 30 }))
    expect(desk.edit.session.value!.past.length).toBe(past + 1)
    expect(desk.edit.sketch.value!.layout!.modules!['share.b']).toEqual({ x: 300, y: 30 })
    const band = desk.edit.scene.value!.bands.find(b => b.id === 'share')!
    expect(desk.edit.scene.value!.nodes.find(n => n.id === 'share.b')!.position).toMatchObject({ x: 300 })
    expect(desk.edit.scene.value!.nodes.find(n => n.id === 'share.b')!.position.y).toBeGreaterThan(band.y)
    expect(desk.edit.scene.value!.nodes.find(n => n.id === 'core')!.data.count).toBe(2)
    desk.edit.undo()
    expect(desk.edit.sketch.value!.layout!.modules!['share.b']).toBeUndefined()
  })

  it('F-40、F-41、#3：面板的父模块（上一层没写职责时取当前版本并标出、现有原则）、血缘读法、各张草图（推出的标出）', async () => {
    const cur = {
      path: 'modules.yaml',
      text: BASE.text.replace('        name: A\n', '        name: A\n        responsibility: 甲的职责\n        abstraction: 甲的原则\n'),
    }
    const { desk } = await setup(SKETCH_VERSION, fakeWriter().writer, { compare: { current: { label: '当前版本', dir: 'x', files: [SYSTEM, cur] } } })
    expect(desk.edit.parent.value).toMatchObject({ id: 'core.a', name: 'A', responsibility: '甲的职责', fromCurrent: true, currentAbstraction: '甲的原则' })
    expect(desk.edit.principleOf('core.a')).toEqual({ text: '甲的原则', from: 'current' })
    ok(desk.edit.setAbstraction('本张的原则'))
    expect(desk.edit.principleOf('core.a')).toEqual({ text: '本张的原则', from: 'sketch' })
    ok(desk.edit.merge(['core.a.x', 'core.a.y'], 'XY', 'xy'))
    expect([desk.edit.lineageOf('core.a.xy'), desk.edit.lineageOf('core.a.z')]).toEqual(['merged', null])
    expect(desk.edit.sheets.value.map(x => [x.mount, x.file, x.dirty])).toEqual([
      ['core.a', true, true],
      ['core.a.xy', false, false],
    ])
    expect(desk.edit.baselineFallback.value).toBe(true)
  })

  it('F-11、05 裁决 3：新建设计只发挂载点（底稿由服务端从基线复制）；挂载点不能是层', async () => {
    const { writer, created } = fakeWriter()
    const { desk } = await setup(undefined, writer)
    await desk.edit.createDesign({ id: 'n', name: 'N', mount: 'core.a' })
    expect(created[0]).toEqual({ id: 'n', name: 'N', mount: 'core.a' })
    expect(await desk.edit.createDesign({ id: 'm', name: 'M', mount: 'core' })).toMatchObject({ ok: false })
    expect(created).toHaveLength(1)
  })

  it('X11：设计版本的差异按血缘表述（versions.diff 带设计草图的 from）', async () => {
    const merged = load([SKETCH]).model.sketches[0].def
    const def: SketchDef = {
      ...merged,
      modules: [
        { id: 'core.a.xy', name: 'XY', from: ['core.a.x', 'core.a.y'] },
        { id: 'core.a.z', name: 'Z' },
      ],
    }
    const r1 = `modules:\n  - id: core\n    name: Core\n    kind: layer\n    order: 1\n    children:\n      - { id: core.a, name: A, children: [{ id: core.a.xy, name: XY, children: [{ id: core.a.xy.x, name: X }, { id: core.a.xy.y, name: Y }] }, { id: core.a.z, name: Z }] }\n      - { id: core.b, name: B, children: [{ id: core.b.q, name: Q }] }\n`
    const { desk } = await setup({ design: 'd', revision: 'r1' }, fakeWriter().writer, {
      files: [SYSTEM, { path: 'modules.yaml', text: r1 }],
      sketches: [{ design: 'd', file: { path: 'designs/d/sketches/core.a.yaml', text: sketchText(def) } }],
    })
    expect(desk.versions.diff.value!.counts.merged).toBe(1)
  })
})
