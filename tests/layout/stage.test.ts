/** 舞台叠加：V5（参与的节点、走过的边）、P10（方向）、P11（未建模临时线）、R11（本层不可见）、分支预览 */
import { describe, expect, it } from 'vitest'
import { landFrame, loadModel, planScenario, projectLevel, projectScenario, stageEnds } from '../../src/model'
import { layoutView } from '../../src/layout/layout'
import { stageDisplay, stageOverlay, unmodeledId } from '../../src/layout/stage'
import { scenarioFiles } from '../fixtures/sample'

async function setup(level: string, choices: Map<string, number>, files = scenarioFiles(), id = 'sc.play') {
  const { index } = loadModel(files)
  const plan = planScenario(index, id)
  const view = projectLevel(index, level, { showBoundaries: true, mergeTypes: true, scenarioEnds: stageEnds(plan) })
  const sv = projectScenario(index, view, plan, choices)
  return { index, plan, view, sv, pv: await layoutView(view) }
}

describe('stageOverlay', () => {
  it('V5：本层参与的节点；走过的边带步骤序号；当前消息带方向', async () => {
    const { sv, pv } = await setup('infra', new Map([['sc.play#3', 0]]))
    const o = stageOverlay(sv, pv, 'sc.play#done')
    expect([...o.active].sort()).toEqual(['actor.biz', 'boundary:app', 'infra.framework', 'infra.mus', 'infra.player'])
    expect(o.walked.get('infra.player->infra.framework')!.steps).toEqual([2, 6])
    expect(o.walked.get('node:infra.framework')!.steps).toEqual([4])
    expect(o.current).toMatchObject({ index: 5, at: { kind: 'edge', reverse: true } })
    expect(o.hiddenCurrent).toBe(false)
  })

  it('只标出到播放头为止走过的；尚未开始时什么都没走', async () => {
    const { sv, pv } = await setup('infra', new Map([['sc.play#3', 0]]))
    expect(stageOverlay(sv, pv, null).walked.size).toBe(0)
    expect([...stageOverlay(sv, pv, 'sc.play#1').walked.keys()]).toEqual(['actor.biz->infra.player', 'infra.player->infra.framework'])
  })

  it('R11：当前帧在本层不可见时标出，已走过的仍保留', async () => {
    const { sv, pv } = await setup('infra', new Map([['sc.play#3', 0]]))
    const o = stageOverlay(sv, pv, 'sc.play#4/0')
    expect(o.hiddenCurrent).toBe(true)
    expect(o.current).toBeNull()
    expect(o.walked.size).toBe(5)
  })

  it('P11：走过的未建模消息画临时线', async () => {
    const files = scenarioFiles({ 'scenarios/x.yaml': 'scenario: { id: sc.u, name: U, steps: [{ call: { from: infra.mus, to: app.fragments } }] }' })
    const { sv, pv } = await setup('infra', new Map(), files, 'sc.u')
    const o = stageOverlay(sv, pv, 'sc.u#0')
    expect(o.unmodeled).toHaveLength(1)
    expect(o.unmodeled[0]).toMatchObject({ edgeId: unmodeledId('infra.mus', 'boundary:app'), from: 'infra.mus', to: 'boundary:app' })
    expect(o.unmodeled[0].route.points).toHaveLength(2)
  })

  it('分支预览：各选项首条消息的落点与序号位置；空分支没有落点', async () => {
    const { index, plan, view, sv, pv } = await setup('infra', new Map())
    const point = plan.points.get('sc.play#3')!
    const options = point.options.map((o, k) => ({ option: k, label: o.when, landing: o.first ? landFrame(index, view, o.first) : null }))
    const o = stageOverlay(sv, pv, 'sc.play#2', options)
    expect(o.previews.map(p => [p.option, p.at?.kind])).toEqual([
      [0, 'internal'],
      [1, undefined],
    ])
    expect(o.previews[0].pos).toBeDefined()
  })
})

describe('stageDisplay（V5、V8、V9）', () => {
  const view = {
    mode: 'graph' as const,
    parentId: 'p',
    nodes: ['a', 'b', 'c', 'd'].map(id => ({ id, moduleId: id, role: 'module' as const, hasChildren: false })),
    edges: [
      { id: 'a->b', from: 'a', to: 'b' },
      { id: 'b->c', from: 'b', to: 'c' },
      { id: 'c->d', from: 'c', to: 'd' },
    ].map(e => ({ ...e, kind: 'direct' as const, type: 'calls' as const, types: [], relationIds: [], mode: 'sync' as const })),
  }
  const participants = new Map<string, 'path' | 'other'>([['a', 'path'], ['b', 'path'], ['c', 'other']])
  const base = { view, participants, playEdges: new Set(['a->b']), reveal: new Set<string>() }

  it('隐藏（默认）：参与路径的节点与回放边显示；只在未选分支处的节点淡化；其余节点与静态边隐藏', () => {
    const d = stageDisplay({ ...base, mode: 'hide' })
    expect(Object.fromEntries(d.nodes)).toEqual({ a: 'show', b: 'show', c: 'dim', d: 'hide' })
    expect(Object.fromEntries(d.edges)).toEqual({ 'a->b': 'show', 'b->c': 'hide', 'c->d': 'hide' })
  })

  it('淡显 / 全显', () => {
    const dim = stageDisplay({ ...base, mode: 'dim' })
    expect(dim.nodes.get('d')).toBe('dim')
    expect(dim.edges.get('b->c')).toBe('dim')
    const show = stageDisplay({ ...base, mode: 'show' })
    expect([...show.nodes.values()].every(v => v === 'show')).toBe(true)
    expect(show.edges.get('c->d')).toBe('show')
  })

  it('V9：在画布上显示的节点，其静态边及对端节点照常显示', () => {
    const d = stageDisplay({ ...base, mode: 'hide', reveal: new Set(['c']) })
    expect(d.edges.get('b->c')).toBe('show')
    expect(d.edges.get('c->d')).toBe('show')
    expect(d.nodes.get('d')).toBe('show')
    expect(d.nodes.get('c')).toBe('show')
  })

  it('V10：悬停可见节点——「隐藏」时它的静态边与对端节点淡显，「淡显」时它的静态边照常；悬停隐藏的节点或「全显」时不变', () => {
    const hide = stageDisplay({ ...base, mode: 'hide', hover: 'c' })
    expect(hide.edges.get('b->c')).toBe('dim')
    expect(hide.edges.get('c->d')).toBe('dim')
    expect(hide.nodes.get('d')).toBe('dim')
    expect(hide.edges.get('a->b')).toBe('show')
    const dim = stageDisplay({ ...base, mode: 'dim', hover: 'c' })
    expect(dim.edges.get('c->d')).toBe('show')
    expect(dim.edges.get('b->c')).toBe('show')
    // d 在「隐藏」时不渲染，悬停不到；即使给出也不展开
    expect(stageDisplay({ ...base, mode: 'hide', hover: 'd' })).toEqual(stageDisplay({ ...base, mode: 'hide' }))
    expect(stageDisplay({ ...base, mode: 'show', hover: 'c' })).toEqual(stageDisplay({ ...base, mode: 'show' }))
  })

  it('分层总览的带始终显示', () => {
    const layered = { ...view, mode: 'layered' as const, nodes: [{ id: 'L', moduleId: 'L', role: 'layer' as const, hasChildren: true }], edges: [] }
    expect(stageDisplay({ ...base, view: layered, mode: 'hide' }).nodes.get('L')).toBe('show')
  })
})
