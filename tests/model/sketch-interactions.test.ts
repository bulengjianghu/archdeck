/**
 * 草图里的四类交互与端口（ADR-0029）：X23 连线类型与机制（编辑操作写 via / mode / pull，格式校验，迁移期 calls「待分类」只提示）、
 * X24 草图声明的端口实现者（implement 操作、引用校验），以及草图画布的端口记号与经端口的线（L12、L13 在草图里同画）。
 */
import { describe, expect, it } from 'vitest'
import { applyEdit, loadModel, validateSketch, type EditContext, type EditOp, type RawFile, type SketchDef } from '../../src/model'
import { sketchScene } from '../../src/layout/layout'

const SKELETON = `
sketch:
  id: skeleton
  mount: root
  lifetime: persistent
  modules:
    - id: fe
      name: Front
      kind: layer
      order: 1
      children:
        - { id: fe.ui, name: UI, kind: subsystem }
    - id: core
      name: Core
      kind: layer
      order: 2
      children:
        - { id: core.api, name: Api }
        - { id: core.bus, name: Bus, role: bus }
`
const MODULES = `
modules:
  - { id: fe.ui.view, name: View, parent: fe.ui, responsibility: 视图 }
  - { id: fe.ui.list, name: List, parent: fe.ui, responsibility: 列表 }
interfaces:
  - { id: if.api.get, name: get, owner: core.api }
`
const files = (): RawFile[] =>
  Object.entries({ 'system.yaml': 'system: { id: sys, name: S }', 'intent/skeleton.yaml': SKELETON, 'modules/all.yaml': MODULES }).map(([path, text]) => ({ path, text }))
const index = loadModel(files()).index
const persistent = index.model.sketches
const ctx: EditContext = { persistent, designSketch: true }
const FILE = 'designs/d1/sketches/fe.ui.yaml'
const base = (): SketchDef => ({
  id: 'd1',
  mount: 'fe.ui',
  modules: [
    { id: 'fe.ui.view', name: 'View' },
    { id: 'fe.ui.list', name: 'List' },
  ],
  interfaces: [{ id: 'if.ui.list.items', name: 'items', owner: 'fe.ui.list' }],
})
const ok = (def: SketchDef, op: EditOp) => {
  const r = applyEdit(def, op, ctx)
  if (!r.ok) throw new Error(`${r.code}: ${r.reason}`)
  return r.sketch
}
const check = (def: SketchDef) => validateSketch(def, { persistent, file: FILE, index })
const codes = (xs: { code: string }[]) => xs.map(x => x.code)

describe('X23 连线的类型与机制', () => {
  it('connect 写类型与修饰：经端口的委托、异步查询、拉取的流；mode 只留在查询 / 委托，pull 只留在流', () => {
    let def = ok(base(), { op: 'connect', from: 'fe.ui.view', to: 'core.api', type: 'commands', via: 'port:if.api.get' })
    expect(def.relations![0]).toMatchObject({ type: 'commands', via: 'port:if.api.get' })
    def = ok(def, { op: 'connect', from: 'fe.ui.view', to: 'fe.ui.list', type: 'queries', mode: 'async', via: 'channel:http' })
    expect(def.relations![1]).toMatchObject({ type: 'queries', mode: 'async', via: 'channel:http' })
    def = ok(def, { op: 'connect', from: 'fe.ui.list', to: 'core.api', type: 'streams', pull: true, mode: 'async' })
    expect(def.relations![2]).toMatchObject({ type: 'streams', pull: true })
    expect(def.relations![2]).not.toHaveProperty('mode')
    // 改类型后不再适用的修饰一并去掉；via 空串为直接
    const id = def.relations![1].id
    def = ok(def, { op: 'updateRelation', id, patch: { type: 'notifies', via: '' } })
    expect(def.relations![1]).toEqual(expect.not.objectContaining({ mode: expect.anything(), via: expect.anything() }))
    expect(def.relations![1].type).toBe('notifies')
    def = ok(def, { op: 'updateRelation', id: def.relations![0].id, patch: { mode: 'async' } })
    expect(def.relations![0].mode).toBe('async')
    def = ok(def, { op: 'updateRelation', id: def.relations![0].id, patch: { mode: '' } })
    expect(def.relations![0]).not.toHaveProperty('mode')
    expect(check(def).errors).toEqual([])
  })

  it('格式校验：四类之外的类型、坏的 via（schema）、未知端口 / 总线、mode 用在通知 / 流、pull 用在非流——格式错误拦保存', () => {
    const def = base()
    def.relations = [
      { id: 'r3', from: 'fe.ui.view', to: 'core.api', type: 'commands', via: 'port:if.ghost' },
      { id: 'r4', from: 'fe.ui.view', to: 'core.api', type: 'queries', via: 'bus:core.ghost' },
      { id: 'r5', from: 'fe.ui.view', to: 'core.api', type: 'notifies', mode: 'async' },
      { id: 'r6', from: 'fe.ui.view', to: 'fe.ui.list', type: 'queries', pull: true },
    ]
    const v = check(def)
    expect(v.ok).toBe(false)
    expect(v.errors.map(e => [e.target.relation, e.code])).toEqual([
      ['r3', 'sketch.ref'],
      ['r4', 'sketch.ref'],
      ['r5', 'sketch.relation-type'],
      ['r6', 'sketch.relation-type'],
    ])
    // 不合四形态的 via 与四类之外的类型（implements 已不是关系类型，M17）由 schema 拦下（格式错误）
    const bad = base()
    bad.relations = [{ id: 'r2', from: 'fe.ui.view', to: 'core.api', type: 'commands', via: 'pipe' }]
    expect(codes(check(bad).errors)).toEqual(['sketch.schema'])
    bad.relations = [{ id: 'r1', from: 'fe.ui.view', to: 'core.api', type: 'implements' as never }]
    expect(codes(check(bad).errors)).toEqual(['sketch.schema'])
    // 合法的四形态：经端口（草图或版本里的接口）、经总线（已知模块）、经通道
    def.relations = [
      { id: 'r7', from: 'fe.ui.view', to: 'fe.ui.list', type: 'commands', via: 'port:if.ui.list.items' },
      { id: 'r8', from: 'fe.ui.view', to: 'core.api', type: 'notifies', via: 'bus:core.bus' },
      { id: 'r9', from: 'fe.ui.list', to: 'core.api', type: 'queries', via: 'channel:ws' },
    ]
    expect(check(def).errors).toEqual([])
  })

  it('迁移期的 calls 标「待分类」、旧的平铺 via 提示改写——只提示（hint），不进两级校验', () => {
    const def = base()
    def.relations = [{ id: 'r1', from: 'fe.ui.view', to: 'core.api', type: 'calls', via: 'http' }]
    const v = check(def)
    expect(v.ok && v.ready).toBe(true)
    expect(codes(v.hints)).toEqual(expect.arrayContaining(['sketch.unclassified', 'sketch.via']))
  })
})

describe('X24 草图里的端口与实现者', () => {
  it('implement：写进本张接口的 implementedBy，可撤销；接口不在本张、定义模块自己、重复都拒绝', () => {
    let def = ok(base(), { op: 'implement', interface: 'if.ui.list.items', module: 'fe.ui.view' })
    expect(def.interfaces![0].implementedBy).toEqual(['fe.ui.view'])
    // 引用节点（外部模块）也可以是实现者
    def = ok(def, { op: 'implement', interface: 'if.ui.list.items', module: 'core.api' })
    expect(def.interfaces![0].implementedBy).toEqual(['fe.ui.view', 'core.api'])
    expect(applyEdit(def, { op: 'implement', interface: 'if.ui.list.items', module: 'fe.ui.view' }, ctx).ok).toBe(false)
    expect(applyEdit(def, { op: 'implement', interface: 'if.ui.list.items', module: 'fe.ui.list' }, ctx).ok).toBe(false)
    // 底稿不复制接口：版本里的接口不在本张，不能在这里声明实现者
    expect(applyEdit(def, { op: 'implement', interface: 'if.api.get', module: 'fe.ui.view' }, ctx).ok).toBe(false)
    def = ok(def, { op: 'implement', interface: 'if.ui.list.items', module: 'core.api', remove: true })
    def = ok(def, { op: 'implement', interface: 'if.ui.list.items', module: 'fe.ui.view', remove: true })
    expect(def.interfaces![0]).not.toHaveProperty('implementedBy')
  })

  it('校验：实现者是已知模块，否则格式错误', () => {
    const def = base()
    def.interfaces![0].implementedBy = ['fe.ui.view', 'core.ghost']
    expect(check(def).errors.map(e => [e.code, e.target.interface])).toEqual([['sketch.ref', 'if.ui.list.items']])
  })

  it('草图画布：定义了接口的模块带端口记号（实现者数）；经端口的线带插座，同时带机制「端口」（L12、L35）', () => {
    const def = ok(ok(base(), { op: 'implement', interface: 'if.ui.list.items', module: 'fe.ui.view' }), {
      op: 'connect',
      from: 'fe.ui.view',
      to: 'fe.ui.list',
      type: 'commands',
      via: 'port:if.ui.list.items',
    })
    const s = sketchScene({ def, nameOf: () => undefined })
    expect(s.nodes.find(n => n.id === 'fe.ui.list')!.data.ports).toEqual([{ id: 'if.ui.list.items', name: 'items', implementers: 1 }])
    expect(s.nodes.find(n => n.id === 'fe.ui.view')!.data.ports).toBeUndefined()
    expect(s.edges[0].data.port).toBe(true)
    expect(s.edges[0].data.mechs).toEqual({ 端口: 1 })
  })
})
