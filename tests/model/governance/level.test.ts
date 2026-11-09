/** 架构治理 · 本层投影（K9、K10、Y4、Y5）：证实标记、叠加线、本层环及其构成 */
import { describe, expect, it } from 'vitest'
import {
  assignFiles,
  depsBetween,
  governanceReport,
  levelFacts,
  loadModel,
  projectLevel,
} from '@/model'
import { files, SRC, CODE, setup } from './helpers'

describe('K9、K10、Y4、Y5 本层投影', () => {
  it('视图边的证实与违规，未描述依赖成为叠加线，本层的环', () => {
    const { index, report } = setup()
    const view = projectLevel(index, 'ui')
    const f = levelFacts(index, view, report)
    expect(f.edgeFacts.get(view.edges.find(e => e.from === 'ui.view' && e.to === 'ui.store')!.id)).toBe('confirmed')
    const toCore = view.edges.find(e => e.from === 'ui.store' && e.to === 'boundary:core')!
    expect(f.violatedEdges.has(toCore.id)).toBe(true)
    expect(f.overlays.map(o => `${o.id}:${o.undescribed}/${o.violations}`).sort()).toEqual(['dep:boundary:core->ui.view:2/1', 'dep:ui.view->boundary:core:1/1'])
    const o = f.overlays.find(x => x.from === 'ui.view')!
    expect([o.fromModule, o.toModule]).toEqual(['ui.view', 'core'])
    expect(new Set(f.cycles.values()).size).toBe(1)
    expect([...f.cycles.keys()].sort()).toEqual(['boundary:core', 'ui.store', 'ui.view'])
  })

  it('K9、L26：本层视图边上未证实的关系逐条记下（标签位按它计条数），带两端之间是否没有任何依赖（K6）', () => {
    const { index } = loadModel([...files(), { path: 'modules/z.yaml', text: 'relations: [{ id: rel.u, from: ui.store, to: ui.view, type: commands }]' }])
    const report = governanceReport(index, assignFiles(index, SRC, []), { files: SRC, packages: {} }, CODE, null)
    const view = projectLevel(index, 'ui')
    const f = levelFacts(index, view, report)
    const onLevel = new Set([...view.edges, ...(view.coreEdges ?? [])].flatMap(e => e.relationIds))
    const want = [...onLevel].filter(id => report.relations.get(id)?.status === 'unconfirmed').sort()
    expect(want.length).toBeGreaterThan(0)
    expect([...f.unconfirmed!.keys()].sort()).toEqual(want)
    for (const [id, u] of f.unconfirmed!) expect(u.isolated).toBe(!!report.relations.get(id)!.isolated)
    // 已证实与不判定的不在其中
    for (const id of onLevel) if (report.relations.get(id)?.status !== 'unconfirmed') expect(f.unconfirmed!.has(id)).toBe(false)
  })

  it('K9：画布只画基线外的违规——已知（基线内）与已豁免的不进叠加线与红晕，面板照常列出', () => {
    const { index, report: open } = setup()
    const all = open.violations.filter(v => v.status !== 'allowed').map(v => v.key)
    const { report } = setup(undefined, { createdAt: 't', violations: all, cyclicity: { modules: 99, files: 99 } })
    expect(report.violations.filter(v => v.status === 'known')).toHaveLength(all.length)
    const view = projectLevel(index, 'ui')
    const f = levelFacts(index, view, report)
    expect(f.violatedEdges.size).toBe(0)
    expect(f.overlays.every(o => o.violations === 0)).toBe(true)
    // 未描述依赖照常是叠加线
    expect(f.overlays.some(o => o.undescribed > 0)).toBe(true)
  })

  it('K9、Y5：同方向有多条视图边（L5 按类型分边）时，违规红晕与本层环的视图边只取类型声明顺序中的第一条', () => {
    const { index } = loadModel([...files(), { path: 'modules/z.yaml', text: 'relations: [{ id: rel.7, from: ui.store, to: core.util, type: queries }]' }])
    const own = assignFiles(index, SRC, [])
    const report = governanceReport(index, own, { files: SRC, packages: {} }, CODE, null)
    const view = projectLevel(index, 'ui')
    expect(view.edges.filter(e => e.from === 'ui.store' && e.to === 'boundary:core').map(e => e.type).sort()).toEqual(['calls', 'queries'])
    const f = levelFacts(index, view, report)
    // 声明顺序：queries、commands、notifies、streams、calls（未分类在最后）
    expect([...f.violatedEdges].filter(id => id.startsWith('ui.store->boundary:core'))).toEqual(['ui.store->boundary:core:queries'])
    const e = f.levelCycles[0].edges.find(x => x.from === 'ui.store' && x.to === 'boundary:core')!
    expect(e.edgeId).toBe('ui.store->boundary:core:queries')
  })

  it('Y5：本层环的节点按视图顺序，环内的本层依赖带同方向视图边与投影来的模块依赖', () => {
    const { index, report } = setup()
    const view = projectLevel(index, 'ui')
    const [c] = levelFacts(index, view, report).levelCycles
    expect(c.id).toBe(1)
    const order = view.nodes.map(n => n.id)
    expect(c.nodes.map(n => n.id)).toEqual(order.filter(id => ['ui.view', 'ui.store', 'boundary:core'].includes(id)))
    expect(c.nodes.find(n => n.id === 'boundary:core')!.module).toBe('core')
    const pairs = c.edges.map(e => `${e.from}->${e.to}`)
    expect([...pairs].sort()).toEqual(['boundary:core->ui.view', 'ui.store->boundary:core', 'ui.view->boundary:core', 'ui.view->ui.store'])
    expect(pairs).toEqual([...pairs].sort((a, b) => order.indexOf(a.split('->')[0]) - order.indexOf(b.split('->')[0]) || order.indexOf(a.split('->')[1]) - order.indexOf(b.split('->')[1])))
    const edge = (p: string) => c.edges.find(e => `${e.from}->${e.to}` === p)!
    expect(edge('ui.view->ui.store').edgeId).toBe(view.edges.find(e => e.from === 'ui.view' && e.to === 'ui.store')!.id)
    expect(edge('ui.view->boundary:core').edgeId).toBeUndefined()
    const back = edge('boundary:core->ui.view')
    expect([back.fromModule, back.toModule]).toEqual(['core', 'ui.view'])
    expect(back.deps.map(d => d.key).sort()).toEqual(['core.impl->ui.view', 'core.util->ui.view'])
    expect(back.deps.every(d => d.files.length > 0)).toBe(true)
  })

  it('视图边的关系全部未证实为 unconfirmed', () => {
    const { index, report } = setup()
    const view = projectLevel(index, 'core')
    const f = levelFacts(index, view, report)
    expect(f.edgeFacts.get(view.edges.find(e => e.from === 'core.impl' && e.to === 'core.util')!.id)).toBe('unconfirmed')
  })

  it('选中叠加线：列出投影到这对节点的模块依赖与违规', () => {
    const { index, report } = setup()
    const view = projectLevel(index, 'ui')
    const sel = depsBetween(index, view, report, 'core', 'ui.view')!
    expect(sel.deps.map(d => `${d.key}:${d.described}`).sort()).toEqual(['core.impl->ui.view:false', 'core.util->ui.view:false'])
    expect(sel.violations.map(v => v.status).sort()).toEqual(['allowed', 'open'])
    expect(depsBetween(index, view, report, 'ui.view', 'ui.view')).toBeNull()
  })
})
