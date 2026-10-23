/**
 * 草图格式 v2（docs/02-domain.md §2.21 X9–X20、X7b–X7k，ADR-0025）：挂载点、两级校验、底稿、合并 / 拆分 / 降级 / 升级 / 改 ID、
 * 前缀级联、待重连、位置与引用节点、按血缘的两个对比与版本对比。按规则清单逐条穷举。
 */
import { describe, expect, it } from 'vitest'
import {
  applyDesignEdit,
  applyEdit,
  changeSummary,
  compareDesign,
  compareSketch,
  deriveChildSketch,
  diffModels,
  dropOrphanReferences,
  gridLayout,
  load,
  loadModel,
  prefixMap,
  mapId,
  seedFromBaseline,
  sketchCheck,
  sketchLineage,
  validateSketch,
  type DesignEditContext,
  type DesignEditOp,
  type ModelIndex,
  type RawFile,
  type SketchDef,
  type SketchEntity,
  type SketchSet,
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
      order: 1
      abstraction: 界面
      mayDependOn: [core]
      children:
        - { id: fe.ui, name: UI, kind: subsystem, core: true, responsibility: 界面 }
    - id: core
      name: Core
      kind: layer
      order: 2
      abstraction: 内核
      children:
        - { id: core.api, name: Api, kind: subsystem, responsibility: 接口 }
        - { id: core.store, name: Store, kind: subsystem, responsibility: 存储 }
`
const MODULES = `
modules:
  - { id: fe.ui.view, name: View, parent: fe.ui, kind: component, core: true, responsibility: 视图 }
  - { id: fe.ui.list, name: List, parent: fe.ui, kind: component, responsibility: 列表 }
  - { id: fe.ui.form, name: Form, parent: fe.ui, kind: component, responsibility: 表单 }
  - { id: fe.ui.view.header, name: Header, parent: fe.ui.view, responsibility: 页头 }
  - { id: core.api.impl, name: Impl, parent: core.api, responsibility: 实现 }
  - { id: core.api.cache, name: Cache, parent: core.api, responsibility: 缓存 }
relations:
  - { id: rel.ui-api, from: fe.ui, to: core.api, type: calls }
  - { id: rel.view-api, from: fe.ui.view, to: core.api, type: calls, description: 取数 }
  - { id: rel.list-api, from: fe.ui.list, to: core.api, type: calls }
  - { id: rel.view-list, from: fe.ui.view, to: fe.ui.list, type: depends }
  - { id: rel.form-store, from: fe.ui.form, to: core.store, type: calls }
  - { id: rel.impl-cache, from: core.api.impl, to: core.api.cache, type: calls }
  - { id: rel.header-store, from: fe.ui.view.header, to: core.store, type: calls }
interfaces:
  - { id: if.api.get, name: get, owner: core.api }
`
const files = (extra: Record<string, string> = {}): RawFile[] =>
  Object.entries({ 'system.yaml': 'system: { id: sys, name: S }', 'intent/skeleton.yaml': SKELETON, 'modules/all.yaml': MODULES, ...extra }).map(([path, text]) => ({ path, text }))
const baseline: ModelIndex = loadModel(files()).index
const persistent = baseline.model.sketches
const entity = (def: SketchDef, design = 'd1'): SketchEntity => ({ def, file: `designs/${design}/sketches/${def.mount}.yaml`, src: { file: '', path: 'sketch' }, mount: def.mount, design })
const ctx = (extra: Partial<DesignEditContext> = {}): DesignEditContext => ({ design: 'd1', persistent, baseline, ...extra })
const run = (set: SketchSet, op: DesignEditOp, c = ctx()) => {
  const r = applyDesignEdit(set, op, c)
  if (!r.ok) throw new Error(r.reason)
  return r
}
const codes = (issues: { code: string }[]) => issues.map(i => i.code)
const seedUi = () => seedFromBaseline('fe.ui', baseline, { id: 'd1' })

describe('X9 挂载点：读取', () => {
  it('非根草图的模块挂在 mount 下；abstraction 落到挂载点模块；from、layout 不进索引；无 layout 标 needsLayout', () => {
    const sk = `sketch:\n  id: d1\n  mount: fe.ui.view\n  abstraction: 只读派生\n  modules:\n    - { id: fe.ui.view.body, name: Body, from: [fe.ui.view.header] }\n  layout:\n    modules: { fe.ui.view.body: { x: 1, y: 2 } }\n`
    const { index, issues } = loadModel(files({ 'sketches/fe.ui.view.yaml': sk }))
    expect(issues.filter(i => i.severity === 'error')).toEqual([])
    expect(index.modules.get('fe.ui.view.body')).toMatchObject({ parentId: 'fe.ui.view' })
    expect(index.modules.get('fe.ui.view.body')).not.toHaveProperty('from')
    expect(index.modules.get('fe.ui.view')?.abstraction).toBe('只读派生')
    const s = index.model.sketches.find(x => x.def.id === 'd1')!
    expect(s).toMatchObject({ mount: 'fe.ui.view', needsLayout: false })
    expect(index.model.sketches.find(x => x.def.id === 'skeleton')).toMatchObject({ mount: 'root', needsLayout: true })
  })

  it('非草图文件写了不同的原则即重定义（以草图为准）；挂载点不存在只提醒', () => {
    const sk = 'sketch: { id: d1, mount: core.api, abstraction: 薄, modules: [] }'
    const { index, issues } = loadModel(files({ 'sketches/core.api.yaml': sk, 'modules/x.yaml': 'modules: [{ id: core.api, name: Api, abstraction: 厚 }]' }))
    expect(codes(issues)).toContain('sketch-redefined')
    expect(index.modules.get('core.api')?.abstraction).toBe('薄')
    expect(codes(load(files({ 'sketches/nope.yaml': 'sketch: { id: d1, mount: nope, abstraction: x, modules: [] }' })).issues)).toContain('sketch-mount-missing')
  })

  it('一期骨架（intent/ 下没有 mount、顶层全是层）按根挂载读取并提醒；其余没有 mount 的草图是格式错误、整份跳过', () => {
    const legacy = SKELETON.replace('  mount: root\n', '')
    const { model, issues } = load(files({ 'intent/skeleton.yaml': legacy }))
    expect(model.sketches[0]).toMatchObject({ mount: 'root' })
    expect(codes(issues)).toContain('sketch-legacy-mount')
    const bad = load(files({ 'sketches/x.yaml': 'sketch: { id: d1, modules: [{ id: fe.ui.x, name: X, parent: fe.ui }] }' }))
    expect(codes(bad.issues)).toContain('schema')
    expect(bad.model.sketches.map(s => s.def.id)).toEqual(['skeleton'])
  })

  it('schema 拒绝未知字段（模块与 layout 里的）', () => {
    expect(codes(load(files({ 'sketches/fe.ui.yaml': 'sketch: { id: d1, mount: fe.ui, modules: [{ id: fe.ui.a, name: A, lineage: [x] }] }' })).issues)).toContain('schema')
    expect(codes(load(files({ 'sketches/fe.ui.yaml': 'sketch: { id: d1, mount: fe.ui, layout: { nodes: {} } }' })).issues)).toContain('schema')
  })
})

describe('X14 两级校验', () => {
  const v = (def: SketchDef, file = `designs/d1/sketches/${def.mount}.yaml`, design?: SketchSet) => validateSketch(def, { persistent, file, index: baseline, design })

  it('底稿合法：没有 error；超七、没写职责只是 hint，不进两级', () => {
    const r = v(seedFromBaseline('root', baseline, { id: 'd1' }))
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r).toMatchObject({ ok: true, ready: true })
    const many: SketchDef = { id: 'd1', mount: 'core.api', modules: Array.from({ length: 8 }, (_, i) => ({ id: `core.api.m${i}`, name: `M${i}` })) }
    const r8 = v(many)
    expect(r8.ready).toBe(true)
    expect(codes(r8.hints)).toContain('sketch.over-seven')
    expect(codes(r8.hints)).toContain('sketch.empty')
  })

  it('格式错误：ID 重复 / 格式、不在挂载点下（前缀、嵌套、parent）、挂载点是层、文件名与 mount 不一致、引用不存在、缺名称、关系不在本层', () => {
    const def: SketchDef = {
      id: 'd1',
      mount: 'core.api',
      modules: [
        { id: 'core.api.a', name: 'A' },
        { id: 'core.api.a', name: 'A2' },
        { id: 'core.store.x', name: 'X' },
        { id: 'core.api.b', name: 'B', parent: 'core' },
        { id: 'core.api.c', name: ' ', children: [{ id: 'core.api.c.d', name: 'D' }] },
      ],
      relations: [
        { id: 'rel.1', from: 'core.api.a', to: 'nowhere.x', type: 'calls' },
        { id: 'rel.2', from: 'fe.ui.view', to: 'core.store', type: 'calls' },
        { id: 'rel.3', from: 'core.api.a', to: 'core.api.impl', type: 'calls' },
      ],
    }
    const r = v(def)
    expect(r.ok).toBe(false)
    expect(new Set(codes(r.errors))).toEqual(new Set(['sketch.id-dup', 'sketch.id-prefix', 'sketch.parent', 'sketch.nested', 'sketch.name', 'sketch.ref', 'sketch.scope']))
    expect(codes(v({ id: 'd1', mount: 'fe', modules: [] }).errors)).toEqual(['sketch.mount'])
    expect(codes(v({ id: 'd1', mount: 'core.api', modules: [] }, 'designs/d1/sketches/core.yaml').errors)).toEqual(['sketch.file'])
    expect(codes(v({ id: 'd1', mount: 'root', abstraction: 'x', modules: [] }).errors)).toEqual(['sketch.mount'])
  })

  it('语义提示：根草图层依赖成环、本层 depends 成环、同挂载点矛盾、待重连——不拦保存（ok），拦交给 AI（ready 为假）', () => {
    const root = seedFromBaseline('root', baseline, { id: 'd1' })
    root.modules![1].mayDependOn = ['fe']
    const rr = v(root)
    expect(rr).toMatchObject({ ok: true, ready: false })
    expect(codes(rr.warnings)).toEqual(['sketch.layer-cycle'])
    const cyc: SketchDef = {
      id: 'd1',
      mount: 'core.api',
      modules: [
        { id: 'core.api.a', name: 'A' },
        { id: 'core.api.b', name: 'B' },
      ],
      relations: [
        { id: 'r1', from: 'core.api.a', to: 'core.api.b', type: 'depends' },
        { id: 'r2', from: 'core.api.b', to: 'core.api.a', type: 'depends' },
        { id: 'r3', from: 'core.api.gone', to: 'core.api.a', type: 'calls' },
      ],
    }
    const rc = v(cyc)
    expect(rc.ok).toBe(true)
    expect(codes(rc.warnings).sort()).toEqual(['sketch.depends-cycle', 'sketch.pending'])
    expect(rc.pending).toEqual(['r3'])
    const contra = v({ ...seedFromBaseline('root', baseline, { id: 'd1' }), supersedes: undefined })
    expect(codes(contra.warnings)).toEqual(['sketch.contradiction'])
  })
})

describe('X18 底稿从基线复制', () => {
  it('复制挂载点一层的 ID、名称、kind、core 与显式写在本层的关系（含跨边界），不复制职责、接口、原则；更深的关系不复制', () => {
    const s = seedFromBaseline('core.api', baseline, { id: 'd1' })
    expect(s).toEqual({
      id: 'd1',
      mount: 'core.api',
      lifetime: 'until-implemented',
      modules: [
        { id: 'core.api.impl', name: 'Impl' },
        { id: 'core.api.cache', name: 'Cache' },
      ],
      relations: [{ id: 'rel.impl-cache', from: 'core.api.impl', to: 'core.api.cache', type: 'calls' }],
    })
    const ui = seedUi()
    expect(ui.modules!.map(m => m.id)).toEqual(['fe.ui.view', 'fe.ui.list', 'fe.ui.form'])
    expect(ui.modules![0]).toEqual({ id: 'fe.ui.view', name: 'View', kind: 'component', core: true })
    // 跨边界：fe.ui.view → core.api（另一端在挂载点之外）；fe.ui.view.header → core.store 端点更深，不复制
    expect(ui.relations!.map(r => r.id)).toEqual(['rel.view-api', 'rel.list-api', 'rel.view-list', 'rel.form-store'])
    expect(ui.closed).toBeUndefined()
  })

  it('根挂载：层 + 第二级，supersedes skeleton；复制后相对基线为 0', () => {
    const root = seedFromBaseline('root', baseline, { id: 'd1' })
    expect(root.supersedes).toBe('skeleton')
    expect(root.modules!.map(m => [m.id, m.children?.map(c => c.id)])).toEqual([
      ['fe', ['fe.ui']],
      ['core', ['core.api', 'core.store']],
    ])
    expect(root.relations).toEqual([{ id: 'rel.ui-api', from: 'fe.ui', to: 'core.api', type: 'calls' }])
    expect(root.closed).toEqual(['fe', 'core'])
    for (const def of [root, seedUi(), seedFromBaseline('core.api', baseline, { id: 'd1' })]) {
      const c = compareSketch(entity(def), baseline, { mode: 'baseline' })
      expect(c.changes).toEqual([])
      expect(validateSketch(def, { persistent, file: `designs/d1/sketches/${def.mount}.yaml`, index: baseline }).errors).toEqual([])
    }
  })
})

describe('X7j 合并', () => {
  it('from 为基线 ID 闭包；来源降为新模块的子模块并写入下一层草图；关系重指向、同对同类型去重；位置取重心', () => {
    const ui = seedUi()
    ui.layout = { modules: { 'fe.ui.view': { x: 0, y: 0 }, 'fe.ui.list': { x: 100, y: 50 }, 'fe.ui.form': { x: 0, y: 200 } } }
    const r = run({ 'fe.ui': ui }, { op: 'merge', sketch: 'fe.ui', ids: ['fe.ui.view', 'fe.ui.list'], name: '展示', id: 'show' })
    const s = r.design['fe.ui']
    expect(s.modules!.map(m => m.id)).toEqual(['fe.ui.show', 'fe.ui.form'])
    expect(s.modules![0]).toMatchObject({ id: 'fe.ui.show', name: '展示', kind: 'component', from: ['fe.ui.view', 'fe.ui.list'] })
    // view→api 与 list→api 重指向为 show→api 后去重；view→list 成了内部关系，进下一层
    expect(s.relations!.map(r => [r.id, r.from, r.to])).toEqual([
      ['rel.view-api', 'fe.ui.show', 'core.api'],
      ['rel.form-store', 'fe.ui.form', 'core.store'],
    ])
    expect(s.layout!.modules!['fe.ui.show']).toEqual({ x: 50, y: 25 })
    const child = r.design['fe.ui.show']
    expect(child.modules!.map(m => [m.id, m.from])).toEqual([
      ['fe.ui.show.view', ['fe.ui.view']],
      ['fe.ui.show.list', ['fe.ui.list']],
    ])
    expect(child.relations).toEqual([{ id: 'rel.view-list', from: 'fe.ui.show.view', to: 'fe.ui.show.list', type: 'depends' }])
    expect(r.effects.sketches.sort()).toEqual(['fe.ui', 'fe.ui.show'])
    expect(r.effects.removed).toEqual(['rel.list-api'])
  })

  it('闭包展开：合并已合并过的结果，from 仍指向基线；闭包不足两个基线 ID 时不记 from（读作新增 + 移动）', () => {
    const once = run({ 'fe.ui': seedUi() }, { op: 'merge', sketch: 'fe.ui', ids: ['fe.ui.view', 'fe.ui.list'], name: 'S', id: 'show' })
    const twice = run(once.design, { op: 'merge', sketch: 'fe.ui', ids: ['fe.ui.show', 'fe.ui.form'], name: 'All', id: 'all' })
    expect(twice.design['fe.ui'].modules![0].from).toEqual(['fe.ui.view', 'fe.ui.list', 'fe.ui.form'])
    const added = run({ 'fe.ui': seedUi() }, { op: 'edit', sketch: 'fe.ui', edit: { op: 'addModule', parent: 'fe.ui', name: 'New', id: 'fe.ui.new' } })
    const m = run(added.design, { op: 'merge', sketch: 'fe.ui', ids: ['fe.ui.form', 'fe.ui.new'], name: 'Pair', id: 'pair' })
    expect(m.design['fe.ui'].modules!.find(x => x.id === 'fe.ui.pair')!.from).toBeUndefined()
    expect(m.design['fe.ui.pair'].modules!.map(x => [x.id, x.from])).toEqual([
      ['fe.ui.pair.form', ['fe.ui.form']],
      ['fe.ui.pair.new', undefined],
    ])
  })

  it('X12 前缀级联：来源已有下一层草图时同一步改挂载点与其中模块 ID，被改写的记 from；别的草图里的引用随之改写', () => {
    const set = { 'fe.ui': seedUi(), 'fe.ui.view': seedFromBaseline('fe.ui.view', baseline, { id: 'd1' }), 'core.store': { id: 'd1', mount: 'core.store', modules: [], relations: [] } as SketchDef }
    set['core.store'].modules = [{ id: 'core.store.db', name: 'DB' }]
    set['core.store'].relations = [{ id: 'rel.x', from: 'core.store.db', to: 'fe.ui.view', type: 'notifies' }]
    const r = run(set, { op: 'merge', sketch: 'fe.ui', ids: ['fe.ui.view', 'fe.ui.list'], name: 'S', id: 'show' })
    expect(r.design['fe.ui.view']).toBeUndefined()
    expect(r.design['fe.ui.show.view']).toMatchObject({ mount: 'fe.ui.show.view', modules: [{ id: 'fe.ui.show.view.header', name: 'Header', from: ['fe.ui.view.header'] }] })
    expect(r.effects.renamedSketches).toEqual([['fe.ui.view', 'fe.ui.show.view']])
    expect(r.design['core.store'].relations![0].to).toBe('fe.ui.show.view')
  })

  it('拒绝：少于两个、不同层、ID 已占用或不以挂载点为前缀', () => {
    const set = { 'fe.ui': seedUi() }
    const no = (op: DesignEditOp) => applyDesignEdit(set, op, ctx())
    expect(no({ op: 'merge', sketch: 'fe.ui', ids: ['fe.ui.view'], name: 'X', id: 'x' })).toMatchObject({ ok: false, code: 'too-few' })
    expect(no({ op: 'merge', sketch: 'fe.ui', ids: ['fe.ui.view', 'fe.ui.list'], name: 'X', id: 'fe.ui.form' })).toMatchObject({ ok: false, code: 'id-taken' })
    expect(no({ op: 'merge', sketch: 'fe.ui', ids: ['fe.ui.view', 'fe.ui.list'], name: 'X', id: 'core.x' })).toMatchObject({ ok: false, code: 'id-prefix' })
  })
})

describe('X7k 拆分与 X16 待重连', () => {
  it('同层生成若干模块、from 指向原模块的基线 ID；原模块删除，它的关系不自动分配、列为待重连；它的下一层草图随之删除', () => {
    const set = { 'fe.ui': seedUi(), 'fe.ui.view': seedFromBaseline('fe.ui.view', baseline, { id: 'd1' }) }
    const r = run(set, { op: 'split', sketch: 'fe.ui', id: 'fe.ui.view', parts: [{ name: 'Top', id: 'top' }, { name: 'Bottom', id: 'bottom' }] })
    const s = r.design['fe.ui']
    expect(s.modules!.map(m => [m.id, m.from])).toEqual([
      ['fe.ui.top', ['fe.ui.view']],
      ['fe.ui.bottom', ['fe.ui.view']],
      ['fe.ui.list', undefined],
      ['fe.ui.form', undefined],
    ])
    expect(r.effects.removedSketches).toEqual(['fe.ui.view'])
    const val = validateSketch(s, { persistent, file: 'designs/d1/sketches/fe.ui.yaml', index: baseline })
    expect(val.ok).toBe(true)
    expect(val.pending.sort()).toEqual(['rel.view-api', 'rel.view-list'])
    // 重连一条：改端点后不再待重连
    const fixed = applyEdit(s, { op: 'removeRelation', id: 'rel.view-list' }, { persistent, designSketch: true })
    expect(fixed.ok && validateSketch(fixed.sketch, { persistent, file: 'designs/d1/sketches/fe.ui.yaml', index: baseline }).pending).toEqual(['rel.view-api'])
  })
})

describe('X7d 降级 / 升级 / 移入', () => {
  it('降级：本层消失、写入目标的下一层草图（不存在则从基线推出），关系重指向目标并去重，记 from；一步改两张', () => {
    const r = run({ 'fe.ui': seedUi() }, { op: 'demote', sketch: 'fe.ui', id: 'fe.ui.list', target: 'fe.ui.view' })
    expect(r.design['fe.ui'].modules!.map(m => m.id)).toEqual(['fe.ui.view', 'fe.ui.form'])
    expect(r.design['fe.ui'].relations!.map(x => [x.id, x.from, x.to])).toEqual([
      ['rel.view-api', 'fe.ui.view', 'core.api'],
      ['rel.form-store', 'fe.ui.form', 'core.store'],
    ])
    expect(r.design['fe.ui.view'].modules!.map(m => [m.id, m.from])).toEqual([
      ['fe.ui.view.header', undefined],
      ['fe.ui.view.list', ['fe.ui.list']],
    ])
    expect(r.effects.createdSketches).toEqual(['fe.ui.view'])
    expect(r.effects.sketches.sort()).toEqual(['fe.ui', 'fe.ui.view'])
  })

  it('升级：成为父层的模块，下一层的关系不带上来、留作待重连；根草图里移入换层，前缀级联', () => {
    const child = seedFromBaseline('core.api', baseline, { id: 'd1' })
    const r = run({ 'core.api': child }, { op: 'promote', sketch: 'core.api', id: 'core.api.cache' })
    expect(r.design.root.modules![1].children!.map(m => [m.id, m.from])).toEqual([
      ['core.api', undefined],
      ['core.store', undefined],
      ['core.cache', ['core.api.cache']],
    ])
    expect(r.design['core.api'].relations).toEqual([{ id: 'rel.impl-cache', from: 'core.api.impl', to: 'core.api.cache', type: 'calls' }])
    expect(validateSketch(r.design['core.api'], { persistent, file: 'designs/d1/sketches/core.api.yaml', index: baseline }).pending).toEqual(['rel.impl-cache'])
    const m = run({ root: seedFromBaseline('root', baseline, { id: 'd1' }), 'fe.ui': seedUi() }, { op: 'moveIn', id: 'fe.ui', layer: 'core' })
    expect(m.design.root.modules![1].children!.at(-1)).toMatchObject({ id: 'core.ui', from: ['fe.ui'] })
    expect(m.design.root.relations!.find(x => x.id === 'rel.ui-api')).toMatchObject({ from: 'core.ui' })
    expect(m.effects.renamedSketches).toEqual([['fe.ui', 'core.ui']])
    expect(m.design['core.ui'].modules![0]).toMatchObject({ id: 'core.ui.view', from: ['fe.ui.view'] })
  })

  it('改 ID 记 from，子草图的挂载点与模块 ID 级联；删除模块连同挂在它与后代上的草图', () => {
    const set = { 'fe.ui': seedUi(), 'fe.ui.view': seedFromBaseline('fe.ui.view', baseline, { id: 'd1' }) }
    const r = run(set, { op: 'rename', sketch: 'fe.ui', id: 'fe.ui.view', newId: 'screen' })
    expect(r.design['fe.ui'].modules![0]).toMatchObject({ id: 'fe.ui.screen', from: ['fe.ui.view'] })
    expect(Object.keys(r.design).sort()).toEqual(['fe.ui', 'fe.ui.screen'])
    expect(r.design['fe.ui.screen'].modules![0]).toMatchObject({ id: 'fe.ui.screen.header', from: ['fe.ui.view.header'] })
    const back = run(r.design, { op: 'rename', sketch: 'fe.ui', id: 'fe.ui.screen', newId: 'view' })
    expect(back.design['fe.ui'].modules![0]).toEqual({ id: 'fe.ui.view', name: 'View', kind: 'component', core: true })
    const del = run(set, { op: 'remove', sketch: 'fe.ui', id: 'fe.ui.view' })
    expect(del.effects.removedSketches).toEqual(['fe.ui.view'])
    expect(del.design['fe.ui'].relations!.map(x => x.id)).toEqual(['rel.list-api', 'rel.form-store'])
  })
})

describe('X15 位置、X19 引用节点', () => {
  it('拖动节点、拖动标签、重新排列（网格）；改 ID 时位置跟着走', () => {
    let s = seedUi()
    const step = (op: Parameters<typeof applyEdit>[1]) => {
      const r = applyEdit(s, op, { persistent, designSketch: true, known: id => baseline.modules.has(id) })
      if (!r.ok) throw new Error(r.reason)
      s = r.sketch
    }
    step({ op: 'autoArrange' })
    expect(Object.keys(s.layout!.modules!)).toEqual(['fe.ui.view', 'fe.ui.list', 'fe.ui.form', 'core.api', 'core.store'])
    step({ op: 'moveNode', positions: { 'fe.ui.view': { x: 5, y: 6 } } })
    step({ op: 'relabel', id: 'rel.view-api', label: { x: 1, y: 1 } })
    expect(s.layout).toMatchObject({ modules: { 'fe.ui.view': { x: 5, y: 6 } }, relations: { 'rel.view-api': { label: { x: 1, y: 1 } } } })
    const r = run({ 'fe.ui': s }, { op: 'rename', sketch: 'fe.ui', id: 'fe.ui.view', newId: 'screen' })
    expect(r.design['fe.ui'].layout!.modules!['fe.ui.screen']).toEqual({ x: 5, y: 6 })
    expect(gridLayout(seedFromBaseline('root', baseline, { id: 'd1' })).modules!.core).toEqual({ x: 40, y: 180 })
    expect(gridLayout(seedFromBaseline('root', baseline, { id: 'd1' })).modules!['core.store']).toEqual({ x: 480, y: 180 })
  })

  it('引用外部模块：只是布局里的位置；保存时没有关系的引用丢弃并给出清单；两端都是引用的关系不能建', () => {
    const add = applyEdit(seedUi(), { op: 'addReference', id: 'core.api.impl' }, { persistent, designSketch: true, known: id => baseline.modules.has(id) })
    expect(add.ok).toBe(true)
    if (!add.ok) return
    expect(add.sketch.layout!.modules!['core.api.impl']).toBeDefined()
    const { sketch, dropped } = dropOrphanReferences(add.sketch)
    expect(dropped).toEqual(['core.api.impl'])
    expect(sketch.layout).toBeUndefined()
    const both = applyEdit(seedUi(), { op: 'connect', from: 'core.api', to: 'core.store', type: 'calls' }, { persistent, designSketch: true })
    expect(both).toMatchObject({ ok: false, code: 'invalid' })
  })
})

describe('X17 两个对比按血缘', () => {
  const design = (set: SketchSet) => Object.values(set).map(d => entity(d))

  it('相对基线：合并 / 拆分 / 改 ID / 移动 / 新增 / 删除；级联改 ID 与合并来源被吸收；关系重指向不计修改', () => {
    const set = run({ 'fe.ui': seedUi() }, { op: 'merge', sketch: 'fe.ui', ids: ['fe.ui.view', 'fe.ui.list'], name: 'S', id: 'show' }).design
    const c = compareDesign(design(set), baseline, 'baseline')
    expect(c.counts).toMatchObject({ merged: 1, added: 0, removed: 0, moved: 0, changed: 0, renamed: 0, split: 0 })
    expect(changeSummary(c.sketches)).toBe('- 合并 View、List 为 S')
    const split = run({ 'fe.ui': seedUi() }, { op: 'split', sketch: 'fe.ui', id: 'fe.ui.form', parts: [{ name: 'A', id: 'a' }, { name: 'B', id: 'b' }] }).design
    const cs = compareDesign(design(split), baseline, 'baseline')
    expect(cs.counts.split).toBe(1)
    expect(cs.sketches[0].changes[0]).toMatchObject({ kind: 'split', id: 'fe.ui.form', to: ['fe.ui.a', 'fe.ui.b'] })
    expect(cs.pending).toBe(1)
    const renamed = run({ 'fe.ui': seedUi() }, { op: 'rename', sketch: 'fe.ui', id: 'fe.ui.form', newId: 'input' }).design
    expect(compareDesign(design(renamed), baseline, 'baseline').sketches[0].changes.map(x => x.kind)).toEqual(['renamed'])
    const demoted = run({ 'fe.ui': seedUi() }, { op: 'demote', sketch: 'fe.ui', id: 'fe.ui.list', target: 'fe.ui.view' }).design
    const cd = compareDesign(design(demoted), baseline, 'baseline')
    expect(cd.counts).toMatchObject({ moved: 1, removed: 0, changed: 0, added: 0 })
    const removed = run({ 'fe.ui': seedUi() }, { op: 'remove', sketch: 'fe.ui', id: 'fe.ui.form' }).design
    expect(compareDesign(design(removed), baseline, 'baseline').counts).toMatchObject({ removed: 2 })
  })

  it('职责只参与相对基线，相对当前版本只比结构', () => {
    const s = seedUi()
    s.modules![1].responsibility = '新的列表职责'
    s.modules![2].core = true
    const b = compareSketch(entity(s), baseline, { mode: 'baseline' })
    expect(b.changes.map(c => [c.id, c.fields])).toEqual([
      ['fe.ui.list', ['responsibility']],
      ['fe.ui.form', ['core']],
    ])
    const cur = sketchCheck(entity(s), baseline)
    expect(cur.deviations.map(d => d.key)).toEqual(['field:fe.ui.form'])
  })

  it('相对当前版本：按挂载点取同一范围；合并未落实时报缺模块与来源仍在原处；根挂载范围 = 层 + 第二级', () => {
    const set = run({ 'fe.ui': seedUi() }, { op: 'merge', sketch: 'fe.ui', ids: ['fe.ui.view', 'fe.ui.list'], name: 'S', id: 'show' }).design
    const all = design(set)
    const c = sketchCheck(all.find(x => x.mount === 'fe.ui')!, baseline, { design: all })
    expect(c.deviations.map(d => d.key).sort()).toEqual(['missing-module:fe.ui.show', 'missing-relation:rel.view-api', 'not-applied:fe.ui.list', 'not-applied:fe.ui.view'])
    expect(c.deviations.find(d => d.key === 'missing-module:fe.ui.show')!.message).toContain('合并 View、List 为 S')
    const root = seedFromBaseline('root', baseline, { id: 'd1' })
    expect(compareSketch(entity(root), baseline, { mode: 'current' }).changes).toEqual([])
    const extra = loadModel(files({ 'modules/x.yaml': 'modules: [{ id: core.extra, name: E, parent: core, responsibility: x }]' })).index
    expect(sketchCheck(entity(root), extra).deviations.map(d => d.key)).toEqual(['extra-child:core.extra'])
    // 只比挂载点一层：更深的子模块不进 fe.ui 草图的范围
    expect(sketchCheck(entity(seedUi()), extra).consistent).toBe(true)
  })

  it('同挂载点矛盾：设计草图与持久草图挂在同一处、没有 supersedes 即矛盾；不同挂载点互不比对', () => {
    const root = { ...seedFromBaseline('root', baseline, { id: 'd1' }), supersedes: undefined }
    expect(sketchCheck(entity(root), baseline, { persistent }).deviations.map(d => d.key)).toEqual(['contradiction:root'])
    expect(sketchCheck(entity(seedFromBaseline('root', baseline, { id: 'd1' })), baseline, { persistent }).deviations).toEqual([])
    expect(sketchCheck(entity(seedUi()), baseline, { persistent }).deviations).toEqual([])
  })
})

describe('版本对比 diffModels 按血缘', () => {
  it('合并结果读作 merged（带 from），来源与级联改名的后代不计删除 / 新增，重指向的关系不计修改', () => {
    const AFTER = `
modules:
  - { id: fe.ui.show, name: Show, parent: fe.ui, kind: component, responsibility: 展示 }
  - { id: fe.ui.show.view, name: View, parent: fe.ui.show, kind: component, core: true, responsibility: 视图 }
  - { id: fe.ui.show.list, name: List, parent: fe.ui.show, kind: component, responsibility: 列表 }
  - { id: fe.ui.form, name: Form, parent: fe.ui, kind: component, responsibility: 表单 }
  - { id: fe.ui.show.view.header, name: Header, parent: fe.ui.show.view, responsibility: 页头 }
  - { id: core.api.impl, name: Impl, parent: core.api, responsibility: 实现 }
  - { id: core.api.cache, name: Cache, parent: core.api, responsibility: 缓存 }
relations:
  - { id: rel.ui-api, from: fe.ui, to: core.api, type: calls }
  - { id: rel.view-api, from: fe.ui.show, to: core.api, type: calls, description: 取数 }
  - { id: rel.view-list, from: fe.ui.show.view, to: fe.ui.show.list, type: depends }
  - { id: rel.form-store, from: fe.ui.form, to: core.store, type: calls }
  - { id: rel.impl-cache, from: core.api.impl, to: core.api.cache, type: calls }
  - { id: rel.header-store, from: fe.ui.show.view.header, to: core.store, type: calls }
interfaces:
  - { id: if.api.get, name: get, owner: core.api }
`
    const after = loadModel(files({ 'modules/all.yaml': AFTER })).index
    const lineage = new Map([['fe.ui.show', ['fe.ui.view', 'fe.ui.list']]])
    const d = diffModels(baseline, after, { lineage })
    expect(d.counts).toMatchObject({ merged: 1, added: 0, removed: 0, moved: 0, changed: 0 })
    expect(d.changes).toEqual([{ entity: 'module', id: 'fe.ui.show', kind: 'merged', name: 'Show', from: ['fe.ui.view', 'fe.ui.list'] }])
    // 不给血缘时同一对版本按 ID 增删
    expect(diffModels(baseline, after).counts.removed).toBeGreaterThan(0)
  })

  it('前缀映射：合并来源 → 结果.短名；改 ID / 移动 来源 → 结果；后代随前缀', () => {
    const map = prefixMap(sketchLineage([{ id: 'd', mount: 'fe.ui', modules: [{ id: 'fe.ui.show', name: 'S', from: ['fe.ui.view', 'fe.ui.list'] }, { id: 'fe.ui.in', name: 'I', from: ['fe.ui.form'] }] }]))
    expect(mapId(map, 'fe.ui.view.header')).toBe('fe.ui.show.view.header')
    expect(mapId(map, 'fe.ui.form.x')).toBe('fe.ui.in.x')
    expect(mapId(map, 'core.api')).toBe('core.api')
  })
})

describe('X18 推出下一层草图', () => {
  it('合并结果的下一层 = 来源（换新前缀、from 指向来源）与来源之间的关系；改 ID 的结果 = 基线对应模块的一层换前缀', () => {
    const merged: SketchSet = { 'fe.ui': { id: 'd1', mount: 'fe.ui', modules: [{ id: 'fe.ui.show', name: 'S', from: ['fe.ui.view', 'fe.ui.list'] }] } }
    expect(deriveChildSketch('fe.ui.show', baseline, merged, { id: 'd1' })).toMatchObject({
      mount: 'fe.ui.show',
      modules: [
        { id: 'fe.ui.show.view', from: ['fe.ui.view'] },
        { id: 'fe.ui.show.list', from: ['fe.ui.list'] },
      ],
      relations: [{ id: 'rel.view-list', from: 'fe.ui.show.view', to: 'fe.ui.show.list' }],
    })
    const renamed: SketchSet = { root: { id: 'd1', mount: 'root', modules: [{ id: 'core', name: 'Core', kind: 'layer', children: [{ id: 'core.gate', name: 'G', from: ['core.api'] }] }] } }
    const child = deriveChildSketch('core.gate', baseline, renamed, { id: 'd1' })
    expect(child.modules!.map(m => [m.id, m.from])).toEqual([
      ['core.gate.impl', ['core.api.impl']],
      ['core.gate.cache', ['core.api.cache']],
    ])
    expect(child.relations![0]).toMatchObject({ from: 'core.gate.impl', to: 'core.gate.cache' })
    expect(compareSketch(entity(child), baseline, { mode: 'baseline', lineage: sketchLineage([...Object.values(renamed), child]) }).changes).toEqual([])
  })
})
