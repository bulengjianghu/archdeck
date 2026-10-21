/** 路线与配对：F6e（直选任意分支点）、F6f（路线总览）、F7（调用与显式返回配对） */
import { describe, expect, it } from 'vitest'
import { choicesForBranch, loadModel, pairReturns, planScenario, pointPrefix, resolvePath, routeOf } from '../../src/model'
import { scenarioFiles } from '../fixtures/sample'

// 两个先后的 alt，第二个嵌在第一个的第 0 支里；返回跨越 alt 回应前面的调用
const NESTED = `scenario:
  id: sc.nested
  name: 嵌套分支
  steps:
    - call: { id: a, from: infra.player, to: infra.framework.sm, label: a }
    - call: { id: b, from: infra.framework.sm, to: app.solution, label: b }
    - alt:
        - when: X
          steps:
            - call: { id: x1, from: app.solution, to: domain.services, label: x1 }
            - alt:
                - when: Y
                  steps:
                    - return: { id: y1, from: domain.services, to: app.solution, label: y1 }
                - when: Z
                  steps: []
        - when: W
          steps:
            - async: { id: w1, from: app.solution, to: domain.services, label: w1 }
    - return: { id: rb, from: app.solution, to: infra.framework.sm, label: rb }
    - return: { id: ra, from: infra.framework.sm, to: infra.player, label: ra }
`

const { index } = loadModel(scenarioFiles({ 'scenarios/nested.yaml': NESTED }))
const plan = planScenario(index, 'sc.nested')
const outer = 'sc.nested#2'
const inner = [...plan.points.keys()].find(k => k !== outer)!
const id = (s: string) => `sc.nested#${s}`
const ids = (frames: { id: string }[]) => frames.map(f => f.id)

describe('F6e：直选任意分支点', () => {
  it('分支点在路径上：等同 chooseBranch', () => {
    const c = choicesForBranch(plan, new Map([[outer, 0]]), outer, 1)!
    expect([...c]).toEqual([[outer, 1]])
  })

  it('分支点不在路径上：先补齐到达它所需的选择，再选这一支', () => {
    // 外层选了 W，内层分支点不在路径上；直选内层 Z → 外层改为 X
    const c = choicesForBranch(plan, new Map([[outer, 1]]), inner, 1)!
    expect(c.get(outer)).toBe(0)
    expect(c.get(inner)).toBe(1)
    // 尚未到达（外层未选）同样补齐
    expect(choicesForBranch(plan, new Map(), inner, 0)!.get(outer)).toBe(0)
  })

  it('分支点或选项不存在时为 null', () => {
    expect(choicesForBranch(plan, new Map(), 'nope', 0)).toBeNull()
    expect(choicesForBranch(plan, new Map(), outer, 5)).toBeNull()
  })

  it('pointPrefix：路径上分支点之前的帧，不在路径上时为空', () => {
    expect(ids(pointPrefix(plan, new Map([[outer, 0]]), inner))).toEqual([id('a'), id('b'), id('x1')])
    expect(ids(pointPrefix(plan, new Map(), outer))).toEqual([id('a'), id('b')])
    expect(pointPrefix(plan, new Map([[outer, 1]]), inner)).toEqual([])
  })
})

describe('F6f：路线', () => {
  it('列出路径上依次经过的分支点与所选选项，以及截止处待选的分支点', () => {
    expect(routeOf(plan, new Map())).toEqual([{ pointId: outer, when: ['X', 'W'], chosen: null }])
    expect(routeOf(plan, new Map([[outer, 0]]))).toEqual([
      { pointId: outer, when: ['X', 'W'], chosen: 0 },
      { pointId: inner, when: ['Y', 'Z'], chosen: null },
    ])
    const full = routeOf(plan, new Map([[outer, 0], [inner, 1]]))
    expect(full.map(r => r.chosen)).toEqual([0, 1])
    expect(resolvePath(plan, new Map([[outer, 0], [inner, 1]])).pending).toBeUndefined()
  })
})

describe('F7：调用与显式返回配对', () => {
  const pairs = pairReturns(plan)

  it('返回匹配栈中最近的反向调用，双向可查', () => {
    expect(pairs.get(id('y1'))).toBe(id('x1'))
    expect(pairs.get(id('x1'))).toBe(id('y1'))
    expect(pairs.get(id('rb'))).toBe(id('b'))
    expect(pairs.get(id('ra'))).toBe(id('a'))
    expect(pairs.get(id('a'))).toBe(id('ra'))
  })

  it('async 不配对；分支内未配对的调用不影响分支之后的匹配', () => {
    expect(pairs.has(id('w1'))).toBe(false)
    expect(pairs.get(id('rb'))).toBe(id('b'))
  })

  it('跨 ref 内联照常匹配（样例 sc.play 引用 sc.decide）', () => {
    const p = planScenario(index, 'sc.play')
    const ret = [...p.frames.values()].find(f => f.kind === 'return')!
    const call = p.frames.get(pairReturns(p).get(ret.id)!)!
    expect([call.from, call.to]).toEqual([ret.to, ret.from])
  })

  it('返回找不到反向调用时不配对，也不弹栈', () => {
    const lone = `scenario:
  id: sc.lone
  name: 孤立返回
  steps:
    - call: { id: c, from: infra.player, to: infra.framework.sm }
    - return: { id: r0, from: app.solution, to: domain.services }
    - return: { id: r1, from: infra.framework.sm, to: infra.player }
`
    const { index: ix } = loadModel(scenarioFiles({ 'scenarios/lone.yaml': lone }))
    const pp = pairReturns(planScenario(ix, 'sc.lone'))
    expect(pp.has('sc.lone#r0')).toBe(false)
    expect(pp.get('sc.lone#r1')).toBe('sc.lone#c')
  })
})

describe('S14：步骤继承对应关系的接口与数据', () => {
  const sc = `scenario:
  id: sc.inh
  name: 继承
  steps:
    - call: { id: a, from: infra.framework.sm, to: app.solution }
    - call: { id: b, from: infra.framework.sm, to: infra.framework.pipeline }
    - return: { id: c, from: infra.framework.pipeline, to: infra.framework.sm }
    - call: { id: d, from: infra.framework.sm, to: infra.framework.pipeline, payload: ds.cmd, interface: if.sm }
`
  const { index: ix } = loadModel(scenarioFiles({ 'scenarios/inh.yaml': sc }))
  const p = planScenario(ix, 'sc.inh')
  const f = (id: string) => p.frames.get(`sc.inh#${id}`)!

  it('没写时取对应关系的接口与数据，并标明继承', () => {
    expect(f('a')).toMatchObject({ interface: 'if.sm', inherited: { interface: true } })
    expect(f('b')).toMatchObject({ payload: ['ds.cmd'], inherited: { payload: true } })
  })

  it('返回只继承接口，不继承数据；步骤写了就用步骤的，不标继承', () => {
    expect(f('c').payload).toEqual([])
    expect(f('c').inherited?.payload).toBeUndefined()
    expect(f('d').inherited).toBeUndefined()
  })
})
