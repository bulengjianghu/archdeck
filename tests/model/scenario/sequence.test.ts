/** 场景投影 · 时序模型（P6、P9、P13、S10a） */
import { describe, expect, it } from 'vitest'
import {
  buildSequence,
  compareKeys,
  loadModel,
  planScenario,
  projectLevel,
  projectScenario,
  stageEnds,
} from '../../../src/model'
import { scenarioFiles } from '../../fixtures/sample'
import { index, plan, take, stage } from './helpers'

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
    const { index: ix } = loadModel(
      scenarioFiles({
        'scenarios/z.yaml': `scenario:
  id: sc.z
  name: Z
  steps:
    - loop:
        while: 每一批
        steps:
          - call: { from: infra.framework.sm, to: infra.framework.pipeline }`,
      }),
    )
    const p = planScenario(ix, 'sc.z')
    const at = (level: string) => {
      const view = projectLevel(ix, level, { showBoundaries: true, scenarioEnds: stageEnds(p) })
      return buildSequence(ix, view, p, new Map(), projectScenario(ix, view, p, new Map()))
    }
    expect(at('sys').fragments.find(f => f.kind === 'loop')).toMatchObject({ collapsed: true, label: '每一批' })
    expect(at('infra.framework').fragments.find(f => f.kind === 'loop')!.collapsed).toBe(false)
    expect(seq('infra', take(0)).fragments.find(f => f.kind === 'loop')!.collapsed).toBe(false)
  })

  it('P13、P14：分层总览中有核心模块的层，其泳道为「<层名> · 其他」，归入该层分组、排在核心模块之后；泳道互不包含', () => {
    const s = seq('sys', take(0))
    const lane = s.participants.find(p => p.nodeId === 'infra')!
    expect(lane.name).toMatch(/ · 其他$/)
    expect(lane.parentId).toBe('infra')
    for (const core of s.participants.filter(p => p.parentId === 'infra' && p.nodeId !== 'infra')) expect(compareKeys(core.key, lane.key)).toBeLessThan(0)
    const ids = s.participants.filter(p => p.kind !== 'actor').map(p => p.nodeId)
    // 除「其他」泳道外，没有一条泳道是另一条泳道的祖先
    for (const a of ids) for (const b of ids) if (a !== b && !s.participants.find(p => p.nodeId === a)!.name.endsWith(' · 其他')) expect(index.pathOf.get(b)?.includes(a) ?? false).toBe(false)
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
