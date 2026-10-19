import { describe, expect, it } from 'vitest'
import { loadModel, projectLevel, type LevelView, type ViewEdge } from '../../src/model'
import { sampleFiles } from '../fixtures/sample'

const { index } = loadModel(sampleFiles())

const edgeSummary = (edges: ViewEdge[]) =>
  edges.map(e => `${e.from}->${e.to}:${e.type}:${e.kind}:${e.relationIds.join(',')}`).sort()
const nodeIds = (v: LevelView, role?: string) => v.nodes.filter(n => !role || n.role === role).map(n => n.id)

describe('projectLevel · 分层总览（根层）', () => {
  const view = projectLevel(index, 'sys')

  it('子模块全是层时用 layered 模式，带按 order 排列', () => {
    expect(view.mode).toBe('layered')
    expect(view.bands!.map(b => b.layerId)).toEqual(['infra', 'app', 'domain'])
  })

  it('每层露出核心模块，其余计入 hiddenCount', () => {
    expect(view.bands!.map(b => [b.coreModuleIds, b.hiddenCount])).toEqual([
      [['infra.player', 'infra.framework'], 1],
      [['app.solution'], 1],
      [['domain.services'], 1],
    ])
    expect(nodeIds(view, 'layer')).toEqual(['infra', 'app', 'domain'])
    expect(view.nodes.filter(n => n.role === 'core').map(n => [n.id, n.layerId, n.hasChildren])).toEqual([
      ['infra.player', 'infra', false],
      ['infra.framework', 'infra', true],
      ['app.solution', 'app', false],
      ['domain.services', 'domain', false],
    ])
  })

  it('层间边：同一对层、同一类型的关系聚合成一条，层内关系不画', () => {
    expect(edgeSummary(view.edges)).toEqual([
      'app->domain:calls:aggregate:r2',
      'app->domain:depends:aggregate:r5',
      'infra->app:calls:aggregate:r1',
      'infra->app:depends:aggregate:r3',
      'infra->domain:depends:aggregate:r7',
    ])
  })

  it('核心模块的跨层关系：端点落到核心模块，否则落到层；两端都不是核心模块的不记录', () => {
    expect(edgeSummary(view.coreEdges!)).toEqual([
      'app.solution->domain.services:calls:direct:r2',
      'infra.framework->app.solution:calls:aggregate:r1',
      'infra.player->app.solution:depends:direct:r3',
    ])
  })

  it('根层没有外部，不产生边界节点', () => {
    expect(nodeIds(view, 'boundary')).toEqual([])
  })
})

describe('projectLevel · 普通层次', () => {
  it('Infrastructure 层：子模块、层内聚合边、指向外部的边界节点', () => {
    const view = projectLevel(index, 'infra')
    expect(view.mode).toBe('graph')
    expect(nodeIds(view, 'module')).toEqual(['infra.player', 'infra.framework', 'infra.mus'])
    expect(nodeIds(view, 'boundary')).toEqual(['boundary:app', 'boundary:domain'])
    expect(edgeSummary(view.edges)).toEqual([
      'infra.framework->boundary:app:calls:aggregate:r1',
      'infra.framework->infra.mus:dataflow:aggregate:r4',
      'infra.mus->boundary:domain:depends:aggregate:r7',
      'infra.player->boundary:app:depends:aggregate:r3',
    ])
    expect(view.bands).toBeUndefined()
  })

  it('Framework 层：直接边；外部端点提升到最近公共祖先下它那一侧的模块', () => {
    const view = projectLevel(index, 'infra.framework')
    expect(nodeIds(view, 'boundary')).toEqual(['boundary:app', 'boundary:infra.mus'])
    expect(edgeSummary(view.edges)).toEqual([
      'infra.framework.pipeline->boundary:infra.mus:dataflow:direct:r4',
      'infra.framework.sm->boundary:app:calls:aggregate:r1',
      'infra.framework.sm->infra.framework.pipeline:calls:direct:r6',
    ])
  })

  it('叶子模块的层次为空', () => {
    const view = projectLevel(index, 'infra.mus')
    expect(view.nodes).toEqual([])
    expect(view.edges).toEqual([])
  })

  it('关闭边界节点后，指向外部的边一起隐藏', () => {
    const view = projectLevel(index, 'infra', { showBoundaries: false })
    expect(nodeIds(view, 'boundary')).toEqual([])
    expect(edgeSummary(view.edges)).toEqual(['infra.framework->infra.mus:dataflow:aggregate:r4'])
  })

  it('未知层次抛错', () => {
    expect(() => projectLevel(index, 'nope')).toThrow()
  })
})

describe('projectLevel · 过滤与汇总', () => {
  it('按关系类型过滤', () => {
    const view = projectLevel(index, 'sys', { showBoundaries: true, relationTypes: ['depends'] })
    expect(view.edges.every(e => e.type === 'depends')).toBe(true)
    expect(view.edges).toHaveLength(3)
  })

  it('只看现状时，target 模块及其后代、相关关系都隐藏', () => {
    const { index: idx } = loadModel(sampleFiles({
      'z.yaml': 'modules: [{ id: app.next, name: Next, parent: app, status: target, core: true, responsibility: x }]\nrelations: [{ id: x1, from: app.next, to: domain.services, type: calls }]',
    }))
    const all = projectLevel(idx, 'sys')
    expect(all.bands![1].coreModuleIds).toContain('app.next')
    const current = projectLevel(idx, 'sys', { showBoundaries: true, currentOnly: true })
    expect(current.bands![1].coreModuleIds).not.toContain('app.next')
    expect(current.edges.find(e => e.id === 'app->domain:calls')!.relationIds).toEqual(['r2'])
    expect(() => projectLevel(idx, 'app.next', { showBoundaries: true, currentOnly: true })).toThrow()
  })

  it('同一条边上同步与异步关系混合时 mode 为 mixed', () => {
    const { index: idx } = loadModel(sampleFiles({ 'z.yaml': 'relations: [{ id: x1, from: app.solution, to: domain.models, type: depends }]' }))
    const edge = projectLevel(idx, 'sys').edges.find(e => e.id === 'app->domain:depends')!
    expect(edge.relationIds).toEqual(['r5', 'x1'])
    expect(edge.mode).toBe('mixed')
  })

  it('单条关系、两端恰好是本层模块时才是直接边', () => {
    const view = projectLevel(index, 'app')
    expect(edgeSummary(view.edges)).toEqual([
      'app.fragments->boundary:domain:depends:aggregate:r5',
      'app.solution->boundary:domain:calls:aggregate:r2',
      'boundary:infra->app.solution:calls:aggregate:r1',
      'boundary:infra->app.solution:depends:aggregate:r3',
    ])
  })
})
