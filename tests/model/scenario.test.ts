/** 场景投影：回放计划（F）、回放路径（F6）、帧的层次投影（P、R7、R13、S9）、参与查询（V6）、时序模型（P6、S10a） */
import { describe, expect, it } from 'vitest'
import {
  buildSequence,
  choiceList,
  choicesFor,
  choicesFromList,
  chooseBranch,
  currentMessage,
  landing,
  loadModel,
  participation,
  planScenario,
  projectLevel,
  projectScenario,
  resolvePath,
  scenarioHome,
  stageEnds,
  stepAfter,
  stepBefore,
  walkedCount,
  type ModelIndex,
  type ScenarioPlan,
} from '../../src/model'
import { scenarioFiles } from '../fixtures/sample'

const { index } = loadModel(scenarioFiles())
const plan = planScenario(index, 'sc.play')
const ALT = 'sc.play#3'
const take = (c: number) => new Map([[ALT, c]])
const ids = (p: ScenarioPlan, choices: Map<string, number>) => resolvePath(p, choices).frames.map(f => f.id)

const stage = (idx: ModelIndex, level: string, p: ScenarioPlan) =>
  projectLevel(idx, level, { showBoundaries: true, mergeTypes: true, scenarioEnds: stageEnds(p) })
const project = (level: string, choices = take(0), p = plan, idx = index) => projectScenario(idx, stage(idx, level, p), p, choices)

describe('回放计划', () => {
  it('F1、F2：一条消息步骤一帧；帧 ID = 场景 ID + 步骤 id，未写时用步骤路径', () => {
    expect(ids(plan, take(0))).toEqual(['sc.play#start', 'sc.play#1', 'sc.play#2', 'sc.play#update', 'sc.play#3.alt0.1.loop.0', 'sc.play#4/0', 'sc.play#4/1', 'sc.play#done'])
    expect(plan.frames.size).toBe(8)
  })

  it('F3：ref 内联，帧 ID 加引用处前缀，并标 ref 组合框', () => {
    const f = plan.frames.get('sc.play#4/0')!
    expect(f).toMatchObject({ scenarioId: 'sc.decide', stepPath: '0', from: 'app.solution', to: 'domain.services' })
    expect(f.fragments).toEqual([{ kind: 'ref', id: 'sc.play#4', label: '决策' }])
    // 同一子场景被引用两次也不冲突
    const { index: idx } = loadModel(scenarioFiles({ 'scenarios/x.yaml': 'scenario: { id: sc.twice, name: T, steps: [{ ref: sc.decide }, { ref: sc.decide }] }' }))
    expect(resolvePath(planScenario(idx, 'sc.twice'), new Map()).frames.map(x => x.id)).toEqual(['sc.twice#0/0', 'sc.twice#0/1', 'sc.twice#1/0', 'sc.twice#1/1'])
  })

  it('F4：loop 展开一遍并标注条件', () => {
    expect(plan.frames.get('sc.play#3.alt0.1.loop.0')!.fragments).toEqual([
      { kind: 'alt', id: ALT, label: '需要改图', branch: 0 },
      { kind: 'loop', id: 'sc.play#3.alt0.1', label: '每个 MU' },
    ])
  })

  it('F5：par 各分支按书写顺序串行，并标注并行', () => {
    const { index: idx } = loadModel(
      scenarioFiles({
        'scenarios/x.yaml': `scenario:
  id: sc.par
  name: P
  steps:
    - par:
        - steps: [{ call: { from: infra.player, to: infra.framework.sm } }]
        - steps: [{ call: { from: app.solution, to: domain.services } }]`,
      }),
    )
    const frames = resolvePath(planScenario(idx, 'sc.par'), new Map()).frames
    expect(frames.map(f => [f.id, f.fragments[0].kind, f.fragments[0].branch])).toEqual([
      ['sc.par#0.par0.0', 'par', 0],
      ['sc.par#0.par1.0', 'par', 1],
    ])
  })

  it('S13：帧绑定推断的关系并标明推断；显式引用不算推断；event 与 return 反向', () => {
    expect(plan.frames.get('sc.play#update')).toMatchObject({ relation: 'r6', relationInferred: true, reverse: false })
    expect(plan.frames.get('sc.play#2')).toMatchObject({ relation: 'r1', relationInferred: false })
    expect(plan.frames.get('sc.play#done')).toMatchObject({ relation: 're1', relationInferred: true, reverse: true })
    expect(plan.frames.get('sc.play#4/1')).toMatchObject({ kind: 'return', relation: 'r2', reverse: true })
  })
})

describe('回放路径', () => {
  it('F6：未选分支时路径在分支点截止，报告该分支点及全部选项', () => {
    const r = resolvePath(plan, new Map())
    expect(r.frames.map(f => f.id)).toEqual(['sc.play#start', 'sc.play#1', 'sc.play#2'])
    expect(r.pending?.id).toBe(ALT)
    expect(r.pending?.options.map(o => [o.when, o.first?.id])).toEqual([
      ['需要改图', 'sc.play#update'],
      ['无需改图', undefined],
    ])
  })

  it('F6：选择后路径延长；无效的选择被忽略', () => {
    expect(ids(plan, take(1))).toEqual(['sc.play#start', 'sc.play#1', 'sc.play#2', 'sc.play#4/0', 'sc.play#4/1', 'sc.play#done'])
    expect(ids(plan, new Map([[ALT, 5], ['nope', 0]]))).toEqual(['sc.play#start', 'sc.play#1', 'sc.play#2'])
  })

  describe('多个分支点', () => {
    const { index: idx } = loadModel(
      scenarioFiles({
        'scenarios/x.yaml': `scenario:
  id: sc.two
  name: Two
  steps:
    - alt:
        - when: A
          steps:
            - call: { id: a1, from: infra.player, to: infra.framework.sm }
            - alt:
                - when: A1
                  steps: [{ call: { id: a11, from: infra.framework.sm, to: app.solution } }]
                - when: A2
                  steps: [{ call: { id: a12, from: infra.framework.sm, to: infra.framework.pipeline } }]
        - when: B
          steps: [{ call: { id: b1, from: app.solution, to: domain.services } }]
    - alt:
        - when: X
          steps: [{ call: { id: x1, from: infra.player, to: infra.framework.sm } }]
        - when: Y
          steps: []
    - call: { id: end, from: infra.framework.sm, to: infra.player }`,
      }),
    )
    const p2 = planScenario(idx, 'sc.two')
    const [P0, P00, P1] = ['sc.two#0', 'sc.two#0.alt0.1', 'sc.two#1']

    it('F6b：改选会丢弃该分支点之后的选择；选同一项不丢弃', () => {
      const all = new Map([[P0, 0], [P00, 1], [P1, 1]])
      expect(chooseBranch(p2, all, P0, 0)).toEqual(all)
      expect([...chooseBranch(p2, all, P00, 0)]).toEqual([[P0, 0], [P00, 0]])
      expect([...chooseBranch(p2, all, P0, 1)]).toEqual([[P0, 1]])
      expect(chooseBranch(p2, all, P0, 9)).toEqual(all)
    })

    it('R13 · choicesFor：已在路径上时保留现有选择；在未选分支上时先改选所需的分支', () => {
      const all = new Map([[P0, 0], [P00, 1], [P1, 1]])
      expect(choicesFor(p2, all, 'sc.two#a12')).toEqual(all)
      expect([...choicesFor(p2, all, 'sc.two#a11')!]).toEqual([[P0, 0], [P00, 0]])
      expect([...choicesFor(p2, all, 'sc.two#b1')!]).toEqual([[P0, 1]])
      expect([...choicesFor(p2, new Map(), 'sc.two#x1')!]).toEqual([[P0, 0], [P00, 0], [P1, 0]])
      expect(choicesFor(p2, all, 'nope')).toBeNull()
    })

    it('F6c：已选分支按路径上分支点的先后有序编码，可往返', () => {
      const all = new Map([[P0, 0], [P00, 1], [P1, 1]])
      expect(choiceList(p2, all)).toEqual([0, 1, 1])
      expect(choicesFromList(p2, [0, 1, 1])).toEqual(all)
      expect(choicesFromList(p2, [1, 0])).toEqual(new Map([[P0, 1], [P1, 0]]))
      expect([...choicesFromList(p2, [0, 7, 1])]).toEqual([[P0, 0]])
    })
  })
})

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
    expect(at('sc.play#start')).toMatchObject({ kind: 'edge', edgeId: 'actor.biz->infra.player' })
    expect(at('sc.play#2')).toMatchObject({ kind: 'edge', edgeId: 'infra.framework->boundary:app', from: 'infra.framework', to: 'boundary:app' })
  })

  it('P3：两端在同一子模块 → 内部活动', () => {
    const v = project('sys')
    expect(v.messages[v.messageOf.get('sc.play#1')!].at).toEqual({ kind: 'internal', node: 'infra' })
    expect(v.messages[v.messageOf.get('sc.play#1')!].kind).toBe('internal')
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
    - call: { id: a, from: infra.player, to: infra.framework.sm }
    - call: { id: b, from: infra.framework.sm, to: infra.framework.pipeline }
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
  })

  it('P10：消息按步骤自己的方向流动，与边的箭头相反时标 reverse', () => {
    const v = project('infra')
    const done = v.messages[v.messageOf.get('sc.play#done')!].at
    expect(done).toMatchObject({ kind: 'edge', edgeId: 'infra.player->infra.framework', from: 'infra.framework', to: 'infra.player', reverse: true })
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

describe('单步与落点', () => {
  const v = project('sys')

  it('R7：单步按本层可见消息前进 / 后退，取消息覆盖的第一帧', () => {
    expect(stepAfter(v, null)).toBe('sc.play#start')
    expect(stepAfter(v, 'sc.play#3.alt0.1.loop.0')).toBe('sc.play#4/0')
    expect(stepAfter(v, 'sc.play#4/1')).toBe('sc.play#done')
    expect(stepAfter(v, 'sc.play#done')).toBeNull()
    expect(stepBefore(v, 'sc.play#done')).toBe('sc.play#4/1')
    expect(stepBefore(v, 'sc.play#4/1')).toBe('sc.play#4/0')
    expect(stepBefore(v, 'sc.play#start')).toBeNull()
  })

  it('R7：下钻后同一帧在更细的层次上步子更小；播放头在本层不可见时按路径顺序找前后', () => {
    const infra = project('infra')
    expect(currentMessage(infra, 'sc.play#4/1')).toBeNull()
    expect(stepAfter(infra, 'sc.play#4/1')).toBe('sc.play#done')
    expect(stepBefore(infra, 'sc.play#4/1')).toBe('sc.play#3.alt0.1.loop.0')
    expect(walkedCount(infra, 'sc.play#4/1')).toBe(5)
  })

  it('R13：指向某帧时落在其所在可见消息的第一帧；本层不可见时就是它自己', () => {
    expect(landing(v, 'sc.play#2')).toBe('sc.play#2')
    expect(landing(project('infra'), 'sc.play#4/1')).toBe('sc.play#4/1')
  })

  it('已走过的消息数 = 从头播放到播放头为止经过的消息', () => {
    expect(walkedCount(v, null)).toBe(0)
    expect(walkedCount(v, 'sc.play#4/1')).toBe(7)
    expect(currentMessage(v, 'sc.play#4/1')).toBe(6)
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
    expect(participation(index, frames, v, { kind: 'edge', id: 'infra.player->infra.framework' }).frames.map(f => f.frameId)).toEqual(['sc.play#1', 'sc.play#done'])
    expect(participation(index, frames, v, { kind: 'actor', id: 'actor.biz' }).frames).toEqual([{ frameId: 'sc.play#start', seq: 0, role: 'from' }])
  })
})

describe('时序模型', () => {
  const seq = (level: string, choices: Map<string, number>) => {
    const view = stage(index, level, plan)
    return buildSequence(index, view, plan, choices, projectScenario(index, view, plan, choices))
  }

  it('参与者为本层节点（含参与者、边界节点），消息与回放路径一一对应', () => {
    const s = seq('infra', take(0))
    expect(s.participants.map(p => [p.nodeId, p.kind])).toEqual([
      ['actor.biz', 'actor'],
      ['infra.player', 'module'],
      ['infra.framework', 'module'],
      ['boundary:app', 'boundary'],
      ['infra.mus', 'module'],
    ])
    expect(s.messages.filter(m => m.status === 'path').map(m => m.pathIndex)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('alt 列出全部分支：已选 / 未选 / 未到达；空分支有占位', () => {
    const chosen = seq('sys', take(1))
    const alt = chosen.fragments.find(f => f.kind === 'alt')!
    expect(alt.branches!.map(b => [b.label, b.chosen])).toEqual([
      ['需要改图', false],
      ['无需改图', true],
    ])
    expect(chosen.messages.find(m => m.kind === 'empty')).toMatchObject({ status: 'path', label: '（无步骤）' })
    expect(chosen.messages.filter(m => m.frameIds.includes('sc.play#update'))[0].status).toBe('unchosen')
    const pending = seq('sys', new Map())
    expect(pending.fragments.find(f => f.kind === 'alt')!.branches!.map(b => b.chosen)).toEqual([null, null])
    expect(pending.messages.find(m => m.frameIds.includes('sc.play#done'))!.status).toBe('unreached')
  })

  it('P6：组合框内的消息在本层全部是内部活动时折叠', () => {
    const s = seq('sys', take(0))
    expect(s.fragments.find(f => f.kind === 'loop')).toMatchObject({ collapsed: true, label: '每个 MU' })
    expect(seq('infra', take(0)).fragments.find(f => f.kind === 'loop')!.collapsed).toBe(false)
  })

  it('S10a：只画显式 return，call 隐含的返回不画', () => {
    const s = seq('app', take(0))
    expect(s.messages.filter(m => m.kind === 'return').map(m => m.frameIds)).toEqual([['sc.play#4/1']])
    // sc.play#2（infra → app.solution 的 call）没有显式 return：只有一条消息
    expect(s.messages.filter(m => m.to === 'app.solution' || m.from === 'app.solution').map(m => [m.kind, m.frameIds[0]])).toEqual([
      ['call', 'sc.play#2'],
      ['call', 'sc.play#4/0'],
      ['return', 'sc.play#4/1'],
    ])
  })

  it('ref 组合框显示被引用场景名；嵌套组合框有深度', () => {
    const s = seq('infra', take(0))
    expect(s.fragments.map(f => [f.kind, f.depth])).toEqual([
      ['alt', 0],
      ['loop', 1],
    ])
    expect(seq('sys', take(0)).fragments.find(f => f.kind === 'ref')).toMatchObject({ label: '决策', collapsed: false })
  })
})
