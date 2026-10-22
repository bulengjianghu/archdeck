/** 外部参与者与场景的加载、校验、索引（M3、S2、S5–S13、A1、A4、A6、R4） */
import { describe, expect, it } from 'vitest'
import { bindRelation, load, loadModel, triggerOf, type Issue, type MessageStep, type Step } from '../../src/model'
import { scenarioFiles } from '../fixtures/sample'

const codes = (issues: Issue[]) => issues.map(i => i.code)
const scenario = (extra: string) => scenarioFiles({ 'scenarios/x.yaml': extra })

describe('加载', () => {
  it('S2、S8：YAML 与 JSON 场景解析成同一份数据；步骤带路径与出处', () => {
    const { model, issues } = load(scenarioFiles())
    expect(issues).toEqual([])
    expect(model.scenarios.map(s => s.id)).toEqual(['sc.decide', 'sc.play'])
    const play = model.scenarios.find(s => s.id === 'sc.play')!
    expect(play.steps.map(s => s.kind)).toEqual(['call', 'call', 'call', 'alt', 'ref', 'async'])
    const alt = play.steps[3] as Extract<Step, { kind: 'alt' }>
    expect(alt.branches.map(b => b.when)).toEqual(['需要改图', '无需改图'])
    expect(alt.branches[0].steps[1]).toMatchObject({ kind: 'loop', path: '3.alt0.1', while: '每个 MU' })
    expect(alt.branches[0].steps[0]).toMatchObject({ path: '3.alt0.0', msg: { id: 'update', payload: ['ds.cmd'] } })
    expect(alt.src).toMatchObject({ file: 'scenarios/play.yaml', path: 'scenario.steps.3', line: 9 })
    const decide = model.scenarios.find(s => s.id === 'sc.decide')!
    expect(decide.src.file).toBe('scenarios/decide.json')
    expect(decide.steps[1]).toMatchObject({ kind: 'return', msg: { from: 'domain.services', label: '决策结果' } })
  })

  it('A1、A4：参与者单独声明，类别 user / system / time；未知类别是格式错误', () => {
    const { model } = load(scenarioFiles())
    expect(model.actors.map(a => [a.id, a.kind])).toEqual([
      ['actor.biz', 'system'],
      ['actor.viewer', 'user'],
      ['actor.timer', 'time'],
    ])
    expect(codes(load(scenarioFiles({ 'a.yaml': 'actors: [{ id: actor.x, name: X, kind: robot }]' })).issues)).toEqual(['schema'])
  })

  it('S2：未知步骤类型是格式错误，整份文件跳过', () => {
    const { model, issues } = load(scenario('scenario: { id: sc.x, name: X, steps: [{ jump: { from: a, to: b } }] }'))
    expect(codes(issues)).toEqual(['schema'])
    expect(model.scenarios.some(s => s.id === 'sc.x')).toBe(false)
  })
})

describe('校验', () => {
  it('样例场景没有问题', () => {
    expect(loadModel(scenarioFiles()).issues).toEqual([])
  })

  it('M3：参与者 ID 不与模块重复、自身唯一；场景 ID 唯一', () => {
    const r = loadModel(
      scenarioFiles({
        'z.yaml': 'actors: [{ id: infra.mus, name: X, kind: user }, { id: actor.biz, name: Dup, kind: user }]',
        'scenarios/zdup.yaml': 'scenario: { id: sc.play, name: Dup, steps: [] }',
      }),
    )
    expect(codes(r.issues).sort()).toEqual(['actor-id-conflict', 'duplicate-actor', 'duplicate-scenario'])
    expect(r.index.actors.get('actor.biz')!.name).toBe('业务方')
    expect(r.index.scenarios.get('sc.play')!.name).toBe('播放')
  })

  it('A1：参与者可作关系端点；两端都是参与者时报错', () => {
    const r = loadModel(scenarioFiles({ 'a.yaml': 'relations: [{ id: rx, from: actor.biz, to: actor.viewer, type: calls }]' }))
    expect(codes(r.issues)).toEqual(['actor-relation'])
    expect(r.index.relations.get('rc1')).toMatchObject({ from: 'actor.biz', to: 'infra.player' })
  })

  it('S5：步骤端点必须是模块或参与者，否则剔除该步骤', () => {
    const r = loadModel(scenario('scenario: { id: sc.x, name: X, steps: [{ call: { from: nope, to: infra.player } }, { call: { from: actor.biz, to: infra.player } }] }'))
    expect(codes(r.issues)).toEqual(['unknown-step-endpoint'])
    expect(r.index.scenarios.get('sc.x')!.steps).toHaveLength(1)
  })

  it('S5：步骤引用不存在的关系、接口、数据结构时提醒并去掉该引用', () => {
    const r = loadModel(scenario('scenario: { id: sc.x, name: X, steps: [{ call: { from: actor.biz, to: infra.player, relation: r-nope, interface: if-nope, payload: [ds-nope] } }] }'))
    expect(codes(r.issues).sort()).toEqual(['unknown-data-structure', 'unknown-interface', 'unknown-relation'])
    const s = r.index.scenarios.get('sc.x')!.steps[0] as MessageStep
    expect(s.msg).toMatchObject({ relation: undefined, interface: undefined, payload: [] })
  })

  it('S5a：引用了关系而端点不一致 → error，去掉引用', () => {
    const r = loadModel(scenario('scenario: { id: sc.x, name: X, steps: [{ call: { from: app.solution, to: infra.framework.sm, relation: r1 } }] }'))
    expect(codes(r.issues)).toEqual(['step-relation-mismatch'])
    expect(r.issues[0]).toMatchObject({ severity: 'error', file: 'scenarios/x.yaml', line: 1 })
  })

  it('S5a、S12：notifies 与消息同向比对（发布者 → 订阅者的消息对得上发布者 → 订阅者的关系），反向的消息报不一致', () => {
    const ok = loadModel(scenario('scenario: { id: sc.x, name: X, steps: [{ async: { from: infra.framework.sm, to: infra.player, relation: re1 } }] }'))
    expect(ok.issues).toEqual([])
    const bad = loadModel(scenario('scenario: { id: sc.x, name: X, steps: [{ async: { from: infra.player, to: infra.framework.sm, relation: re1 } }] }'))
    expect(codes(bad.issues)).toEqual(['step-relation-mismatch'])
  })

  it('S5a：推断不到且两端结构上无任何关系 → warning；有关系（哪怕是 depends）则不提醒', () => {
    const none = loadModel(scenario('scenario: { id: sc.x, name: X, steps: [{ call: { from: infra.mus, to: app.solution } }] }'))
    expect(none.issues.map(i => [i.code, i.severity])).toEqual([['step-unmodeled', 'warning']])
    const dep = loadModel(scenario('scenario: { id: sc.x, name: X, steps: [{ call: { from: infra.player, to: app.solution } }] }'))
    expect(dep.issues).toEqual([])
  })

  it('S6：ref 的目标必须存在、无循环引用', () => {
    const r = loadModel(
      scenarioFiles({
        'scenarios/x.yaml': 'scenarios: [{ id: sc.a, name: A, steps: [{ ref: sc.b }, { ref: sc.nope }] }, { id: sc.b, name: B, steps: [{ ref: sc.a }] }]',
      }),
    )
    expect(codes(r.issues).sort()).toEqual(['ref-cycle', 'unknown-ref'])
    const all = [...r.index.scenarios.values()].flatMap(s => s.steps.filter(x => x.kind === 'ref').map(x => `${s.id}->${(x as { scenario: string }).scenario}`))
    expect(all).toEqual(['sc.play->sc.decide', 'sc.a->sc.b'])
  })

  it('S11：步骤 id 场景内唯一，重复时去掉后者的 id', () => {
    const r = loadModel(scenario('scenario: { id: sc.x, name: X, steps: [{ call: { id: a, from: actor.biz, to: infra.player } }, { call: { id: a, from: actor.biz, to: infra.player } }] }'))
    expect(codes(r.issues)).toEqual(['duplicate-step-id'])
    const steps = r.index.scenarios.get('sc.x')!.steps as MessageStep[]
    expect(steps.map(s => s.msg.id)).toEqual(['a', undefined])
  })

  it('S12：引用 depends / implements 关系报错', () => {
    const r = loadModel(scenario('scenario: { id: sc.x, name: X, steps: [{ call: { from: infra.player, to: app.solution, relation: r3 } }] }'))
    expect(codes(r.issues)).toEqual(['step-relation-not-runtime'])
  })
})

describe('bindRelation', () => {
  const { index } = loadModel(scenarioFiles())

  it('S13：没写 relation 时，两端之间恰好一条运行时关系即认定，并标明推断', () => {
    expect(bindRelation(index, { kind: 'call', from: 'infra.framework.sm', to: 'infra.framework.pipeline' })).toEqual({ relation: 'r6', inferred: true, reverse: false })
    expect(bindRelation(index, { kind: 'async', from: 'infra.framework.pipeline', to: 'infra.mus' })).toEqual({ relation: 'r4', inferred: true, reverse: false })
  })

  it('S13：关系写在祖先上也能认定；两端之间有多条运行时关系时不推断', () => {
    expect(bindRelation(index, { kind: 'call', from: 'actor.biz', to: 'infra.player' }).relation).toBe('rc1')
    // infra.player ↔ infra.framework.sm 之间有 calls（rp）与 notifies（re1，sm → player）：call 只对得上 rp
    expect(bindRelation(index, { kind: 'call', from: 'infra.player', to: 'infra.framework.sm' })).toMatchObject({ relation: 'rp', inferred: true })
    // async 发布者 → 订阅者：只对得上 re1，与关系同向（S12）
    expect(bindRelation(index, { kind: 'async', from: 'infra.framework.sm', to: 'infra.player' })).toEqual({ relation: 're1', inferred: true, reverse: false })
  })

  it('return 沿调用关系反向；自己发给自己不对应关系', () => {
    expect(bindRelation(index, { kind: 'return', from: 'domain.services', to: 'app.solution' })).toEqual({ relation: 'r2', inferred: true, reverse: true })
    expect(bindRelation(index, { kind: 'call', from: 'app.solution', to: 'app.solution' })).toEqual({ inferred: false, reverse: false })
  })
})

describe('索引', () => {
  const { index } = loadModel(scenarioFiles())

  it('R4 · scenariosOf：有帧端点（含 ref 内联）在子树内的场景；根含全部', () => {
    expect(index.scenariosOf.get('sys')).toEqual(['sc.decide', 'sc.play'])
    expect(index.scenariosOf.get('domain')).toEqual(['sc.decide', 'sc.play'])
    expect(index.scenariosOf.get('infra.framework')).toEqual(['sc.play'])
    expect(index.scenariosOf.get('app.fragments')).toBeUndefined()
  })

  it('A6 · triggeredBy：第一条消息的发送方是参与者时记为由它触发', () => {
    expect(index.triggeredBy.get('actor.biz')).toEqual(['sc.play'])
    expect(index.triggeredBy.get('actor.viewer')).toBeUndefined()
    expect(triggerOf(index, 'sc.decide')).toBe('app.solution')
  })

  it('参与者的入口关系在出入边表中', () => {
    expect(index.outRelations.get('actor.biz')).toEqual(['rc1'])
    expect(index.actors.get('actor.timer')?.kind).toBe('time')
  })
})

describe('格式错误的报告', () => {
  it('步骤树中深处的错误只报最深处，不报外层各候选分支', () => {
    const { issues } = load(scenario('scenario: { id: sc.x, name: X, steps: [{ alt: [{ when: a, steps: [{ call: { from: a, to: b, lable: x } }] }] }] }'))
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('lable')
    expect(issues[0].path).toBe('scenario.steps.0.alt.0.steps.0.call')
  })

  it('不认识的步骤类型提示可用的步骤键', () => {
    const { issues } = load(scenario('scenario: { id: sc.x, name: X, steps: [{ jump: { from: a, to: b } }] }'))
    expect(issues.map(i => i.message).join('\n')).toContain('步骤必须是 call / async / return / alt / loop / par / ref 之一')
  })
})

describe('S15 证据文件字段', () => {
  it('evidence 是字符串数组，原样进入场景实体；写成别的形状是格式错误', () => {
    const ok = load(scenario('scenario: { id: sc.e, name: E, evidence: [tests/a.test.ts, e2e/b.spec.ts], steps: [{ call: { from: actor.biz, to: infra.player } }] }'))
    expect(ok.model.scenarios.find(s => s.id === 'sc.e')!.evidence).toEqual(['tests/a.test.ts', 'e2e/b.spec.ts'])
    expect(ok.model.scenarios.find(s => s.id === 'sc.play')!.evidence).toBeUndefined()
    const bad = load(scenario('scenario: { id: sc.e, name: E, evidence: tests/a.test.ts, steps: [] }'))
    expect(codes(bad.issues)).toContain('schema')
  })
})
