import { describe, expect, it } from 'vitest'
import { compareKeys, hierarchyKey, loadModel, mapEndpoint, nearestVisibleLevel, projectLevel, type LevelView, type ViewEdge } from '../../src/model'
import { sampleFiles, scenarioFiles } from '../fixtures/sample'

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
    // L4：边界节点按层次顺序——infra（order 1）下的 infra.mus 在 app（order 2）之前
    expect(nodeIds(view, 'boundary')).toEqual(['boundary:infra.mus', 'boundary:app'])
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

  it('L5：普通层次同一对模块之间不同类型的关系各成一条边，ID 带类型；同类型内聚合', () => {
    const { index: idx } = loadModel(sampleFiles({
      'z.yaml': [
        'relations:',
        '  - { id: x1, from: infra.framework.sm, to: infra.mus, type: calls }',
        '  - { id: x2, from: infra.framework.sm, to: infra.mus, type: event }',
        '  - { id: x3, from: infra.framework.sm, to: infra.mus, type: calls, mode: async }',
      ].join('\n'),
    }))
    const view = projectLevel(idx, 'infra', { showBoundaries: true })
    const pair = view.edges.filter(x => x.from === 'infra.framework' && x.to === 'infra.mus')
    expect(pair.map(e => [e.id, e.type, e.relationIds, e.mode])).toEqual([
      ['infra.framework->infra.mus:dataflow', 'dataflow', ['r4'], 'sync'],
      ['infra.framework->infra.mus:calls', 'calls', ['x1', 'x3'], 'mixed'],
      ['infra.framework->infra.mus:event', 'event', ['x2'], 'sync'],
    ])
    expect(pair.every(e => !('types' in e))).toBe(true)
    const root = projectLevel(idx, 'sys', { showBoundaries: true })
    expect(root.edges.some(x => x.id === 'infra->app:calls')).toBe(true)
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

describe('mapEndpoint', () => {
  it('local：落在子树内，映射到直接子模块，标明是否恰好是它', () => {
    expect(mapEndpoint(index, 'infra', 'infra.framework')).toEqual({ kind: 'local', node: 'infra.framework', exact: true })
    expect(mapEndpoint(index, 'infra', 'infra.framework.sm')).toEqual({ kind: 'local', node: 'infra.framework', exact: false })
  })

  it('external：提升为最近公共祖先下它那一侧的子模块', () => {
    expect(mapEndpoint(index, 'infra.framework', 'infra.mus')).toEqual({ kind: 'external', node: 'infra.mus', exact: true })
    expect(mapEndpoint(index, 'infra.framework', 'app.solution')).toEqual({ kind: 'external', node: 'app', exact: false })
  })

  it('skip：端点是父模块本身、其祖先或不存在', () => {
    expect(mapEndpoint(index, 'infra', 'infra')).toEqual({ kind: 'skip' })
    expect(mapEndpoint(index, 'infra.framework', 'infra')).toEqual({ kind: 'skip' })
    expect(mapEndpoint(index, 'infra', 'nope')).toEqual({ kind: 'skip' })
  })
})

describe('外部参与者（L6、A2）', () => {
  const { index: idx } = loadModel(scenarioFiles())

  it('mapEndpoint：参与者在任何层次都映射为它自己', () => {
    expect(mapEndpoint(idx, 'sys', 'actor.biz')).toEqual({ kind: 'actor', node: 'actor.biz', exact: true })
    expect(mapEndpoint(idx, 'infra.framework', 'actor.biz')).toEqual({ kind: 'actor', node: 'actor.biz', exact: true })
  })

  it('根层出现全部有关系的参与者，入口关系投影为到层的边；没有关系的参与者不出现', () => {
    const v = projectLevel(idx, 'sys')
    expect(nodeIds(v, 'actor')).toEqual(['actor.biz', 'actor.viewer'])
    expect(v.nodes.find(n => n.id === 'actor.biz')).toMatchObject({ role: 'actor', actorKind: 'system', hasChildren: false })
    expect(edgeSummary(v.edges).filter(e => e.startsWith('actor'))).toEqual(['actor.biz->infra:calls:aggregate:rc1', 'actor.viewer->infra:calls:aggregate:rc2'])
    // 入口落在核心模块上：核心跨层边连到核心模块
    expect(edgeSummary(v.coreEdges!).filter(e => e.startsWith('actor'))).toEqual(['actor.biz->infra.player:calls:direct:rc1', 'actor.viewer->infra.player:calls:direct:rc2'])
  })

  it('某一层只出现与本层子树有关系的参与者，不受边界节点开关影响', () => {
    const infra = projectLevel(idx, 'infra', { showBoundaries: false })
    expect(nodeIds(infra, 'actor')).toEqual(['actor.biz', 'actor.viewer'])
    expect(infra.edges.find(e => e.from === 'actor.biz')).toMatchObject({ to: 'infra.player', kind: 'direct' })
    expect(nodeIds(projectLevel(idx, 'infra.framework'), 'actor')).toEqual([])
    expect(nodeIds(projectLevel(idx, 'app'), 'actor')).toEqual([])
  })

  it('关系类型筛选同样作用于参与者的边', () => {
    expect(nodeIds(projectLevel(idx, 'sys', { showBoundaries: true, relationTypes: ['depends'] }), 'actor')).toEqual([])
  })
})

describe('nearestVisibleLevel（N12）', () => {
  const { index: idx } = loadModel(
    sampleFiles({ 'z.yaml': 'modules: [{ id: app.next, name: Next, parent: app, status: target, responsibility: x, children: [{ id: app.next.a, name: A, responsibility: x }] }]' }),
  )
  it('层次被「只看现状」隐藏时退到最近的可见祖先；未隐藏时不变', () => {
    expect(nearestVisibleLevel(idx, 'app.next.a', { currentOnly: true })).toBe('app')
    expect(nearestVisibleLevel(idx, 'app.next.a', { currentOnly: false })).toBe('app.next.a')
    expect(nearestVisibleLevel(idx, 'nope', { currentOnly: true })).toBe('sys')
  })
})

describe('层次顺序 hierarchyKey（P9、L4）', () => {
  const { index } = loadModel(sampleFiles())
  const sorted = (ids: string[]) => [...ids].sort((a, b) => compareKeys(hierarchyKey(index, a), hierarchyKey(index, b)))

  it('层按 order：上层在前，同一层下的模块相邻', () => {
    expect(sorted(['domain', 'app', 'infra.mus', 'infra'])).toEqual(['infra', 'infra.mus', 'app', 'domain'])
  })

  it('同一父模块下非层按描述顺序；祖先在后代之前', () => {
    const kids = index.childrenOf.get('infra')!
    expect(sorted([...kids].reverse())).toEqual(kids)
    expect(compareKeys(hierarchyKey(index, 'infra.framework'), hierarchyKey(index, 'infra.framework.sm'))).toBeLessThan(0)
  })

  it('参与者与未知 ID 没有排序键', () => {
    expect(hierarchyKey(index, 'nope')).toEqual([])
  })
})
