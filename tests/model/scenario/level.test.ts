/** 场景投影 · 帧的层次投影（P1–P5、P7、P10、P11、P14–P17、S9）与参与查询（V6） */
import { describe, expect, it } from 'vitest'
import {
  buildSequence,
  landing,
  loadModel,
  participation,
  planScenario,
  projectLevel,
  projectScenario,
  resolvePath,
  scenarioHome,
} from '../../../src/model'
import { scenarioFiles } from '../../fixtures/sample'
import { index, plan, take, stage, project } from './helpers'

describe('帧的层次投影', () => {
  it('P1、P7：分层总览中帧按结构投影映射，落在核心跨层边上；参与者映射为它自己', () => {
    const v = project('sys')
    const at = (f: string) => v.messages[v.messageOf.get(f)!].at
    expect(at('sc.play#start')).toMatchObject({ kind: 'edge', edgeId: 'actor.biz->infra.player:calls', core: true, from: 'actor.biz', to: 'infra.player' })
    expect(at('sc.play#2')).toMatchObject({ kind: 'edge', edgeId: 'infra.framework->app.solution:calls', core: true })
  })

  it('P2：一端在本层外 → 走到边界节点或参与者的边', () => {
    const v = project('infra')
    const at = (f: string) => v.messages[v.messageOf.get(f)!].at
    expect(at('sc.play#start')).toMatchObject({ kind: 'edge', edgeId: 'actor.biz->infra.player:calls' })
    expect(at('sc.play#2')).toMatchObject({ kind: 'edge', edgeId: 'infra.framework->boundary:app:calls', from: 'infra.framework', to: 'boundary:app' })
  })

  it('P3：两端在同一子模块 → 内部活动', () => {
    const v = project('infra')
    const m = v.messages[v.messageOf.get('sc.play#update')!]
    expect(m.at).toEqual({ kind: 'internal', node: 'infra.framework' })
    expect(m.kind).toBe('internal')
  })

  it('P3、P7、P14：分层总览先看核心模块——同一层的不同核心模块之间是泳道间的消息，结构图按层的内部活动', () => {
    const v = project('sys')
    const m = v.messages[v.messageOf.get('sc.play#1')!]
    // infra.player → infra.framework.sm：两个核心模块都在 Infrastructure 层
    expect(m.at).toEqual({ kind: 'internal', node: 'infra', lanes: { from: 'infra.player', to: 'infra.framework' } })
    expect(m.kind).toBe('call')
    // 两端在同一核心模块：该核心模块的内部活动
    const u = v.messages[v.messageOf.get('sc.play#update')!]
    expect(u.at).toEqual({ kind: 'internal', node: 'infra.framework' })
  })

  it('P4：两端都在本层外 → 本层不可见', () => {
    const v = project('infra')
    expect(v.hidden).toEqual(['sc.play#4/0', 'sc.play#4/1'])
    expect(project('infra.framework').hidden).toContain('sc.play#start')
  })

  it('P5：组合框边界与方向变化会断开合并（调用与其显式返回是两条消息）', () => {
    const v = project('sys')
    expect(v.messages.map(m => m.frameIds)).toEqual([
      ['sc.play#start'],
      ['sc.play#1'],
      ['sc.play#2'],
      ['sc.play#update'],
      ['sc.play#3.alt0.1.loop.0'],
      ['sc.play#4/0'],
      ['sc.play#4/1'],
      ['sc.play#done'],
    ])
  })

  it('P5：连续落在同一节点内部、或同一条边同方向的帧合并为一条可见消息', () => {
    const { index: idx } = loadModel(
      scenarioFiles({
        'scenarios/x.yaml': `scenario:
  id: sc.m
  name: M
  steps:
    - call: { id: a, from: infra.framework.sm, to: infra.framework.pipeline }
    - call: { id: b, from: infra.framework.pipeline, to: infra.framework.sm }
    - call: { id: c, from: infra.framework.sm, to: app.solution }
    - call: { id: d, from: infra.framework.sm, to: app.solution, label: again }`,
      }),
    )
    const p = planScenario(idx, 'sc.m')
    const v = project('sys', new Map(), p, idx)
    expect(v.messages.map(m => m.frameIds)).toEqual([['sc.m#a', 'sc.m#b'], ['sc.m#c', 'sc.m#d']])
    expect(v.messages[1].at).toMatchObject({ kind: 'edge', edgeId: 'infra.framework->app.solution:calls', core: true })
    expect(landing(v, 'sc.m#b')).toBe('sc.m#a')
    expect(project('infra.framework', new Map(), p, idx).messages.map(m => m.frameIds)).toEqual([['sc.m#a'], ['sc.m#b'], ['sc.m#c', 'sc.m#d']])
    // 分层总览中同一层的不同泳道之间不与内部活动合并（P14）
    const { index: i2 } = loadModel(
      scenarioFiles({
        'scenarios/y.yaml': `scenario:
  id: sc.n
  name: N
  steps:
    - call: { id: a, from: infra.player, to: infra.framework.sm }
    - call: { id: b, from: infra.framework.sm, to: infra.framework.pipeline }`,
      }),
    )
    expect(project('sys', new Map(), planScenario(i2, 'sc.n'), i2).messages.map(m => m.frameIds)).toEqual([['sc.n#a'], ['sc.n#b']])
  })

  it('P17：按帧绑定关系的类型选边——含该关系的边，其次同类型的边，没有同类型时经由上层；未绑定时同方向的运行时边优先', () => {
    const { index: idx } = loadModel(
      scenarioFiles({
        'p17.yaml': [
          'relations:',
          '  - { id: x2, from: infra.player, to: app.solution, type: calls }',
          '  - { id: xc, from: infra, to: app.solution, type: calls }',
          '  - { id: xu, from: infra, to: app.solution, type: dataflow }',
        ].join('\n'),
        'scenarios/p17.yaml': `scenario:
  id: sc.t
  name: T
  steps:
    - call: { id: own, from: infra.player, to: app.solution, relation: x2 }
    - call: { id: same, from: infra.player, to: app.solution, relation: xc }
    - async: { id: upper, from: infra.player, to: app.solution, relation: xu }
    - call: { id: free, from: infra.player, to: app.fragments }`,
      }),
    )
    const p = planScenario(idx, 'sc.t')
    const v = project('infra', new Map(), p, idx)
    const at = (f: string) => v.messages[v.messageOf.get(`sc.t#${f}`)!].at
    expect(at('own')).toMatchObject({ kind: 'edge', edgeId: 'infra.player->boundary:app:calls' })
    expect(at('same')).toMatchObject({ kind: 'edge', edgeId: 'infra.player->boundary:app:calls' })
    // 这对节点之间有 depends 与 calls 边，但没有 dataflow 边：经由上层，不借用其他类型的边
    expect(at('upper')).toMatchObject({ kind: 'upper', relationId: 'xu' })
    expect(at('free')).toMatchObject({ kind: 'edge', edgeId: 'infra.player->boundary:app:calls' })
  })

  it('P5：连续落在同一对节点之间、同方向的帧不论边的类型合并为一条可见消息，落在第一帧的边上', () => {
    const { index: idx } = loadModel(
      scenarioFiles({
        'p5.yaml': 'relations: [{ id: xd, from: infra.player, to: infra.framework.sm, type: dataflow }]',
        'scenarios/p5.yaml': `scenario:
  id: sc.p
  name: P
  steps:
    - call: { id: a, from: infra.player, to: infra.framework.sm, relation: rp }
    - async: { id: b, from: infra.player, to: infra.framework.sm, relation: xd }`,
      }),
    )
    const p = planScenario(idx, 'sc.p')
    const v = project('infra', new Map(), p, idx)
    expect(v.messages.map(m => m.frameIds)).toEqual([['sc.p#a', 'sc.p#b']])
    expect(v.messages[0].at).toMatchObject({ kind: 'edge', edgeId: 'infra.player->infra.framework:calls' })
  })

  it('P10：消息按步骤自己的方向流动，与边的箭头相反时标 reverse', () => {
    const v = project('infra')
    const done = v.messages[v.messageOf.get('sc.play#done')!].at
    expect(done).toMatchObject({ kind: 'edge', edgeId: 'infra.player->infra.framework:event', from: 'infra.framework', to: 'infra.player', reverse: true })
  })

  it('P11：本层两节点之间没有视图边时落点为「未建模」；舞台补齐结构上没有关系的边界节点', () => {
    const { index: idx } = loadModel(scenarioFiles({ 'scenarios/x.yaml': 'scenario: { id: sc.u, name: U, steps: [{ call: { from: infra.mus, to: app.fragments } }] }' }))
    const p = planScenario(idx, 'sc.u')
    const v = project('infra', new Map(), p, idx)
    expect(v.messages[0].at).toEqual({ kind: 'unmodeled', from: 'infra.mus', to: 'boundary:app' })
    // 结构上没有任何关系时，舞台照样补上边界节点
    const { index: bare } = loadModel(scenarioFiles({ 'relations.yaml': 'relations: []', 'actors.yaml': 'actors: []', 'scenarios/play.yaml': '', 'scenarios/x.yaml': 'scenario: { id: sc.u, name: U, steps: [{ call: { from: infra.mus, to: app.fragments } }] }' }))
    const bp = planScenario(bare, 'sc.u')
    expect(projectLevel(bare, 'infra').nodes.some(n => n.id === 'boundary:app')).toBe(false)
    expect(stage(bare, 'infra', bp).nodes.some(n => n.id === 'boundary:app')).toBe(true)
  })

  /** 关系 r9 的一端是 infra.framework 本身：在 infra.framework 层没有它的视图边 */
  const upperFiles = (steps: string) =>
    loadModel(
      scenarioFiles({
        'upper.yaml': 'relations: [{ id: r9, from: app.solution, to: infra.framework, type: calls }]',
        'scenarios/x.yaml': `scenario: { id: sc.v, name: V, steps: ${steps} }`,
      }),
    ).index

  it('P11、P15：本层没有视图边时，是否建模只看帧自身的关系绑定——显式或推断绑定了关系为「经由上层关系」，未绑定为「未建模」', () => {
    const idx = upperFiles(
      '[{ call: { id: a, from: app.solution, to: infra.framework.pipeline } }, { return: { id: b, from: infra.framework.pipeline, to: app.solution, relation: r9 } }, { call: { id: c, from: app.fragments, to: infra.framework.pipeline } }]',
    )
    const p = planScenario(idx, 'sc.v')
    expect(p.frames.get('sc.v#a')).toMatchObject({ relation: 'r9', relationInferred: true })
    const v = project('infra.framework', new Map(), p, idx)
    expect(v.messages.map(m => m.at)).toEqual([
      { kind: 'upper', from: 'boundary:app', to: 'infra.framework.pipeline', relationId: 'r9' },
      { kind: 'upper', from: 'infra.framework.pipeline', to: 'boundary:app', relationId: 'r9' },
      { kind: 'unmodeled', from: 'boundary:app', to: 'infra.framework.pipeline' },
    ])
    // 上一层关系有视图边：照常落在边上
    expect(project('sys', new Map(), p, idx).messages[0].at).toMatchObject({ kind: 'edge' })
    // 时序图：经由上层关系与未建模分别标出
    const view = stage(idx, 'infra.framework', p)
    const seq = buildSequence(idx, view, p, new Map(), projectScenario(idx, view, p, new Map()))
    expect(seq.messages.map(m => [m.temp, m.relationId])).toEqual([
      ['upper', 'r9'],
      ['upper', 'r9'],
      ['unmodeled', undefined],
    ])
  })

  it('P16：同一对节点上经由上层与未建模的帧照常合并（P5）；合并的帧中有未绑定的，整条为「未建模」，全部已绑定时为「经由上层关系」', () => {
    const a = '{ call: { id: a, from: app.solution, to: infra.framework.pipeline } }'
    const c = '{ call: { id: c, from: app.fragments, to: infra.framework.pipeline } }'
    const b = '{ call: { id: b, from: app.solution, to: infra.framework.sm, relation: r9 } }'
    for (const steps of [`[${a}, ${c}]`, `[${c}, ${a}]`]) {
      const idx = upperFiles(steps)
      const v = project('infra.framework', new Map(), planScenario(idx, 'sc.v'), idx)
      expect(v.messages).toHaveLength(1)
      expect(v.messages[0].frameIds).toHaveLength(2)
      expect(v.messages[0].at.kind).toBe('unmodeled')
    }
    const idx = upperFiles(`[${a}, ${a.replace('id: a', 'id: a2')}]`)
    const v = project('infra.framework', new Map(), planScenario(idx, 'sc.v'), idx)
    expect(v.messages).toHaveLength(1)
    expect(v.messages[0].at).toMatchObject({ kind: 'upper', relationId: 'r9' })
    // 到不同子模块的帧不合并
    const i2 = upperFiles(`[${a}, ${b}]`)
    expect(project('infra.framework', new Map(), planScenario(i2, 'sc.v'), i2).messages).toHaveLength(2)
  })

  it('舞台补齐参与者：结构上与本层无关系的参与者在场景中出现时也上舞台', () => {
    const { index: idx } = loadModel(scenarioFiles({ 'scenarios/x.yaml': 'scenario: { id: sc.t, name: T, steps: [{ async: { from: actor.timer, to: app.solution } }] }' }))
    const p = planScenario(idx, 'sc.t')
    expect(projectLevel(idx, 'app').nodes.some(n => n.id === 'actor.timer')).toBe(false)
    expect(stage(idx, 'app', p).nodes.find(n => n.id === 'actor.timer')).toMatchObject({ role: 'actor', actorKind: 'time' })
    expect(projectScenario(idx, stage(idx, 'app', p), p, new Map()).messages[0].at).toEqual({ kind: 'unmodeled', from: 'actor.timer', to: 'app.solution' })
  })

  it('S9：场景所在层次 = 所有帧端点的最近公共祖先；公共祖先本身是端点时取其父模块', () => {
    expect(scenarioHome(index, plan)).toBe('sys')
    const { index: idx } = loadModel(
      scenarioFiles({
        'scenarios/x.yaml': `scenarios:
  - { id: sc.in, name: In, steps: [{ call: { from: infra.framework.sm, to: infra.framework.pipeline } }] }
  - { id: sc.self, name: Self, steps: [{ call: { from: infra.mus, to: infra.mus } }] }`,
      }),
    )
    expect(scenarioHome(idx, planScenario(idx, 'sc.in'))).toBe('infra.framework')
    expect(scenarioHome(idx, planScenario(idx, 'sc.self'))).toBe('infra')
  })
})

describe('参与查询（V6）', () => {
  const frames = resolvePath(plan, take(0)).frames
  const v = project('infra')

  it('模块：子树内参与的帧及角色、本层消息、接口与数据', () => {
    const p = participation(index, frames, v, { kind: 'module', id: 'infra.framework' }, 'sc.play#done')
    expect(p.frames.map(f => [f.frameId, f.role])).toEqual([
      ['sc.play#1', 'to'],
      ['sc.play#2', 'from'],
      ['sc.play#update', 'internal'],
      ['sc.play#3.alt0.1.loop.0', 'from'],
      ['sc.play#done', 'from'],
    ])
    expect(p.messages).toEqual([1, 2, 3, 4, 5])
    expect(p.interfaces).toEqual(['if.sm'])
    expect(p.dataStructures).toEqual(['ds.cmd'])
    expect(p.nearest).toBe('sc.play#done')
  })

  it('关系（含推断绑定）、视图边、参与者', () => {
    expect(participation(index, frames, v, { kind: 'relation', id: 're1' }).frames.map(f => f.frameId)).toEqual(['sc.play#done'])
    expect(participation(index, frames, v, { kind: 'edge', id: 'infra.player->infra.framework:calls' }).frames.map(f => f.frameId)).toEqual(['sc.play#1'])
    expect(participation(index, frames, v, { kind: 'edge', id: 'infra.player->infra.framework:event' }).frames.map(f => f.frameId)).toEqual(['sc.play#done'])
    expect(participation(index, frames, v, { kind: 'actor', id: 'actor.biz' }).frames).toEqual([{ frameId: 'sc.play#start', seq: 0, role: 'from' }])
  })
})
