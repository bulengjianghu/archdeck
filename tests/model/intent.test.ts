/**
 * 意图：草图（docs/02-domain.md §2.19 X1–X6、B6）。按规则清单逐条穷举。
 */
import { describe, expect, it } from 'vitest'
import { isOwnedFile, isSketchFile, load, loadModel, type RawFile } from '../../src/model'
import { sampleFiles } from '../fixtures/sample'

const SKETCH = `
sketch:
  id: skeleton
  lifetime: persistent
  closed: [ui]
  modules:
    - id: ui
      name: UI
      kind: layer
      order: 1
      abstraction: 界面
      responsibility: 界面层
      mayDependOn: [core]
      children:
        - { id: ui.view, name: View, core: true, responsibility: 视图 }
    - id: core
      name: Core
      kind: layer
      order: 2
      abstraction: 内核
      responsibility: 内核层
  relations:
    - { id: rel.sk.view-core, from: ui.view, to: core, type: calls }
  interfaces:
    - { id: if.core.run, name: run, owner: core }
`
const files = (extra: Record<string, string>): RawFile[] =>
  Object.entries({ 'system.yaml': 'system: { id: sys, name: S }', 'intent/skeleton.yaml': SKETCH, ...extra }).map(([path, text]) => ({ path, text }))
const codes = (issues: { code: string }[]) => issues.map(i => i.code)

describe('X1 草图先入、其他文件只能补充', () => {
  it('草图文件先于其他文件进入 Loader（不论路径排序），内容既是普通实体又整份记入 sketches', () => {
    const { model, issues } = load(files({ 'a-first.yaml': 'modules: [{ id: core.api, name: Api, parent: core, responsibility: x }]' }))
    expect(issues).toEqual([])
    expect(model.modules.map(m => m.id)).toEqual(['ui', 'ui.view', 'core', 'core.api'])
    expect(model.sketches).toHaveLength(1)
    expect(model.sketches[0]).toMatchObject({ file: 'intent/skeleton.yaml', def: { id: 'skeleton', lifetime: 'persistent', closed: ['ui'] } })
    expect(model.sketches[0].src).toMatchObject({ file: 'intent/skeleton.yaml', path: 'sketch' })
    expect(model.relations.map(r => r.id)).toEqual(['rel.sk.view-core'])
    expect(model.interfaces[0].src.path).toBe('sketch.interfaces.0')
  })

  it('补充：往草图模块下挂子模块、补草图没写的字段都允许，不报问题', () => {
    const { index, issues } = loadModel(
      files({
        'modules/ui.yaml': 'module: { id: ui, name: UI, docRefs: [docs/ui.md], children: [{ id: ui.panel, name: Panel, responsibility: p }] }',
        'modules/if.yaml': 'interfaces: [{ id: if.core.run, name: run, signature: "run(): void" }]',
      }),
    )
    expect(codes(issues)).toEqual([])
    expect(index.modules.get('ui')).toMatchObject({ kind: 'layer', docRefs: ['docs/ui.md'] })
    expect(index.childrenOf.get('ui')).toEqual(['ui.view', 'ui.panel'])
    expect(index.interfaces.get('if.core.run')).toMatchObject({ owner: 'core', signature: 'run(): void' })
  })

  it('重定义：对草图已写的字段给出不同的值报 sketch-redefined，以草图为准；相同的值不算', () => {
    const { index, issues } = loadModel(
      files({
        'modules/ui.yaml': 'modules: [{ id: ui, name: UI, kind: package, order: 1, mayDependOn: [] }]',
        'modules/rel.yaml': 'relations: [{ id: rel.sk.view-core, from: ui.view, to: core, type: depends }]',
      }),
    )
    const redefined = issues.filter(i => i.code === 'sketch-redefined')
    expect(redefined.map(i => i.file)).toEqual(['modules/rel.yaml', 'modules/ui.yaml'])
    const ui = redefined[1]
    expect(ui).toMatchObject({ severity: 'error', line: 1 })
    expect(ui.message).toContain('kind、mayDependOn')
    expect(ui.message).not.toContain('order')
    expect(index.modules.get('ui')).toMatchObject({ kind: 'layer', mayDependOn: ['core'] })
    expect(index.relations.get('rel.sk.view-core')?.type).toBe('calls')
    expect(codes(issues)).not.toContain('duplicate-module')
  })

  it('父子关系由草图决定：把草图模块搬到别的父模块下也是重定义', () => {
    const { index, issues } = loadModel(files({ 'modules/move.yaml': 'module: { id: core, name: Core, children: [{ id: ui, name: UI }] }' }))
    expect(codes(issues)).toContain('sketch-redefined')
    expect(index.modules.get('ui')?.parentId).toBe('sys')
  })

  it('草图之间不算重定义：设计的草图在持久草图之后，对同一实体的不同值以后者为准（矛盾由核验报出）', () => {
    const { index, issues } = loadModel(files({ 'sketch.yaml': 'sketch: { id: d1, modules: [{ id: ui, name: UI, kind: layer, order: 1, abstraction: 界面, mayDependOn: [] }] }' }))
    expect(codes(issues)).not.toContain('sketch-redefined')
    expect(index.modules.get('ui')?.mayDependOn).toEqual([])
    expect(index.model.sketches.map(s => s.def.id)).toEqual(['skeleton', 'd1'])
  })

  it('没有骨架时退回从 modules/ 读层（兼容期）：旧描述照常加载，sketches 为空', () => {
    const { index, issues } = loadModel(sampleFiles())
    expect(issues).toEqual([])
    expect(index.model.sketches).toEqual([])
    expect(index.childrenOf.get(index.rootId)?.length).toBeGreaterThan(0)
  })

  it('草图写在别处时提醒 sketch-misplaced，仍照常加载', () => {
    const { model, issues } = load(files({ 'modules/odd.yaml': 'sketch: { id: odd, modules: [{ id: x, name: X }] }' }))
    expect(codes(issues)).toEqual(['sketch-misplaced'])
    expect(model.sketches.map(s => s.def.id)).toEqual(['skeleton', 'odd'])
  })

  it('isSketchFile：intent/*.yaml 与 sketch.yaml；isOwnedFile：草图、rules、source-ignore、design.yaml、reviewed.yaml（X6）', () => {
    expect(['intent/skeleton.yaml', 'intent/core.yml', 'sketch.yaml', 'designs/d/sketch.yaml'].every(isSketchFile)).toBe(true)
    expect(['modules/layers.yaml', 'intent/x/y.yaml', 'system.yaml'].some(isSketchFile)).toBe(false)
    expect(['intent/skeleton.yaml', 'designs/d/sketch.yaml', 'rules.yaml', 'source-ignore.yaml', 'designs/d/design.yaml', 'reviewed.yaml'].every(isOwnedFile)).toBe(true)
    expect(['modules/x.yaml', 'system.yaml', 'designs/d/r1/rules.yaml', 'actors.yaml'].some(isOwnedFile)).toBe(false)
  })
})

// ── X2–X5：核验与生命周期 ──
import { archiveVerdict, checkSketches, parseDesignSketches, sketchCheck, sketchLifetime, sketchModules, type SketchEntity } from '../../src/model'

const DESIGN_SKETCH = `
sketch:
  id: d1
  closed: [ui.view]
  modules:
    - id: ui.view
      parent: ui
      name: View
      core: true
      children:
        - { id: ui.view.list, name: List, responsibility: 列表 }
        - { id: ui.view.detail, name: Detail }
    - { id: core.api, parent: core, name: Api, kind: component }
  relations:
    - { id: rel.d1.view-api, from: ui.view, to: core.api, type: calls }
    - { id: rel.d1.api-view, from: core.api, to: ui.view, type: notifies }
  interfaces:
    - { id: if.api.run, name: run, owner: core.api }
    - { id: if.core.stop, name: stop }
`
/** r1：按草图展开、但有几处偏差的版本 */
const R1 = `
modules:
  - { id: ui.view.list, name: List, parent: ui.view, responsibility: 列表 }
  - { id: ui.view.detail, name: Detail, parent: ui.view, responsibility: 详情 }
  - { id: ui.view.extra, name: Extra, parent: ui.view, responsibility: 多出来的 }
  - { id: core.api, name: Api, parent: core, kind: package, responsibility: 接口 }
  - { id: core.api.impl, name: Impl, parent: core.api, responsibility: 实现 }
relations:
  - { id: rel.r1.list-impl, from: ui.view.list, to: core.api.impl, type: calls }
interfaces:
  - { id: if.api.run, name: run, owner: core.api.impl }
`
const design = (text = DESIGN_SKETCH): SketchEntity => parseDesignSketches([{ design: 'd1', file: { path: 'designs/d1/sketch.yaml', text } }])[0]
const keys = (c: { deviations: { severity: string; key: string }[] }) => c.deviations.map(d => `${d.severity} ${d.key}`)

describe('X4 核验 sketchCheck', () => {
  it('只比草图写了的：缺模块、封闭子树多出子模块、字段不一致为错误；关系没有对应（深层提升算对应）、接口不存在 / owner 不同为提醒', () => {
    const { index } = loadModel(files({ 'modules/r1.yaml': R1 }))
    const c = sketchCheck(design(), index)
    expect(c).toMatchObject({ sketch: 'd1', design: 'd1', lifetime: 'until-implemented', consistent: false, counts: { error: 2, warning: 3, info: 0 } })
    expect(keys(c)).toEqual([
      'error field:core.api',
      'error extra-child:ui.view.extra',
      'warning missing-relation:rel.d1.api-view',
      'warning interface-owner:if.api.run',
      'warning missing-interface:if.core.stop',
    ])
    // ui.view.list 的职责文字不同、ui.view.detail 没写职责：文字字段不判；core.api 下多出 impl：没封闭的子树开放
    expect(c.deviations.find(d => d.key === 'field:core.api')!.message).toContain('kind（草图 component，版本 package）')
    expect(c.deviations.find(d => d.key === 'extra-child:ui.view.extra')).toMatchObject({ rules: ['X2', 'X4'], target: { modules: ['ui.view.extra', 'ui.view'] } })
    expect(c.deviations.find(d => d.key === 'missing-relation:rel.d1.api-view')!.at).toEqual({ file: 'designs/d1/sketch.yaml', path: 'sketch.relations.1' })
  })

  it('X5 草图有、版本没有的模块是 error，父模块变了也是 error', () => {
    const { index } = loadModel(files({ 'modules/r1.yaml': 'modules:\n  - { id: core.api, name: Api, parent: ui, kind: component, responsibility: x }\n' }))
    const c = sketchCheck(design(), index)
    expect(keys(c).filter(k => k.startsWith('error'))).toEqual(['error missing-module:ui.view.list', 'error missing-module:ui.view.detail', 'error field:core.api'])
    expect(c.deviations[0]).toMatchObject({ rules: ['X4', 'X5'], target: { modules: ['ui.view'] } })
    expect(c.deviations.find(d => d.key === 'field:core.api')!.message).toContain('父模块（草图 core，版本 ui）')
  })

  it('一致：按草图展开的版本零偏差；认可的提醒降为 info 且不计入，error 不能认可', () => {
    const good = `
modules:
  - { id: ui.view.list, name: List, parent: ui.view, responsibility: 列表 }
  - { id: ui.view.detail, name: Detail, parent: ui.view, responsibility: 详情 }
  - { id: core.api, name: Api, parent: core, kind: component, responsibility: 接口 }
relations:
  - { id: rel.x1, from: ui.view.list, to: core.api, type: calls }
  - { id: rel.x2, from: core.api, to: ui.view.detail, type: notifies }
interfaces:
  - { id: if.api.run, name: run, owner: core.api }
  - { id: if.core.stop, name: stop, owner: core.api }
`
    const { index } = loadModel(files({ 'modules/good.yaml': good }))
    expect(sketchCheck(design(), index)).toMatchObject({ consistent: true, counts: { error: 0, warning: 0, info: 0 }, deviations: [] })
    const { index: r1 } = loadModel(files({ 'modules/r1.yaml': R1 }))
    const accepted = [
      { deviation: 'missing-relation:rel.d1.api-view', reason: '经注入', at: '2026-10-22' },
      { deviation: 'field:core.api', reason: '想认可 error' },
    ]
    const c = sketchCheck(design(), r1, { accepted })
    expect(c.counts).toEqual({ error: 2, warning: 2, info: 1 })
    expect(c.deviations.find(d => d.key === 'missing-relation:rel.d1.api-view')).toMatchObject({ severity: 'info', accepted: { reason: '经注入', at: '2026-10-22' } })
    expect(c.deviations.find(d => d.key === 'field:core.api')!.severity).toBe('error')
  })

  it('X4 与持久草图矛盾即 error（字段不一致、往封闭子树下加直接子模块），声明 supersedes 时跳过；X3 生命周期缺省', () => {
    const { index } = loadModel(files({}))
    const skeleton = index.model.sketches[0]
    expect(sketchLifetime(skeleton)).toBe('persistent')
    const bad = design('sketch:\n  id: d1\n  modules:\n    - { id: ui, name: UI, kind: layer, order: 1, abstraction: 界面, mayDependOn: [], responsibility: x }\n    - { id: ui.panel, parent: ui, name: Panel }\n')
    expect(sketchLifetime(bad)).toBe('until-implemented')
    const c = sketchCheck(bad, index, { persistent: [skeleton] })
    expect(keys(c).filter(k => k.includes('contradiction'))).toEqual(['error contradiction:ui', 'error contradiction:ui.panel'])
    expect(c.deviations[0].message).toContain('mayDependOn')
    expect(c.deviations[1].message).toContain('封闭的「ui」')
    const ok = design('sketch:\n  id: d1\n  supersedes: skeleton\n  modules:\n    - { id: ui, name: UI, kind: layer, order: 1, abstraction: 界面, mayDependOn: [], responsibility: x }\n    - { id: ui.panel, parent: ui, name: Panel }\n')
    expect(sketchCheck(ok, index, { persistent: [skeleton] }).deviations.filter(d => d.code === 'sketch.contradiction')).toEqual([])
  })

  it('checkSketches：持久草图约束版本（封闭的第二级），设计草图附带认可；草图版本里打开的那张不算', () => {
    const { index } = loadModel(files({ 'modules/x.yaml': 'modules: [{ id: ui.extra, name: E, parent: ui, responsibility: x }]', 'modules/r1.yaml': R1 }))
    const checks = checkSketches(index, [design()], new Map([['d1', [{ deviation: 'missing-interface:if.core.stop', reason: '后补' }]]]))
    expect(checks.map(c => c.sketch)).toEqual(['skeleton', 'd1'])
    expect(keys(checks[0])).toEqual(['error extra-child:ui.extra'])
    expect(checks[1].deviations.find(d => d.key === 'missing-interface:if.core.stop')!.severity).toBe('info')
    // 草图版本：打开的那张（非持久）在版本里，不算活动草图
    const { index: sv } = loadModel(files({ 'sketch.yaml': DESIGN_SKETCH }))
    expect(checkSketches(sv, []).map(c => c.sketch)).toEqual(['skeleton'])
  })
})

describe('X3 归档判定与确认记录', () => {
  it('一致才能归档；supersedes 为晋升；持久草图不归档', () => {
    const { index } = loadModel(files({ 'modules/r1.yaml': R1 }))
    const bad = archiveVerdict(sketchCheck(design(), index))
    expect(bad.ok).toBe(false)
    expect(bad.reason).toContain('2 个错误、3 个未认可的提醒')
    const consistent = { ...sketchCheck(design(), index), deviations: [], counts: { error: 0, warning: 0, info: 0 }, consistent: true }
    expect(archiveVerdict(consistent)).toMatchObject({ ok: true, outcome: 'archive' })
    expect(archiveVerdict({ ...consistent, supersedes: 'skeleton' })).toMatchObject({ ok: true, outcome: 'promote' })
    expect(archiveVerdict({ ...consistent, lifetime: 'persistent' })).toMatchObject({ ok: false, outcome: 'archive' })
  })

  it('确认记录的对象：草图覆盖的、版本里存在的模块（按草图顺序）；指纹与摘要由确认层算', () => {
    const { index } = loadModel(files({ 'modules/r1.yaml': R1 }))
    expect(sketchModules(design(), index)).toEqual(['ui.view', 'ui.view.list', 'ui.view.detail', 'core.api'])
  })
})
