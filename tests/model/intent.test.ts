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
