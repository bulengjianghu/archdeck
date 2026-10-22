/** 场景投影 · 回放计划（F1–F5、S13） */
import { describe, expect, it } from 'vitest'
import {
  loadModel,
  planScenario,
  resolvePath,
} from '../../../src/model'
import { scenarioFiles } from '../../fixtures/sample'
import { plan, ALT, take, ids } from './helpers'

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

  it('S13：帧绑定推断的关系并标明推断；显式引用不算推断；通知与关系同向、只有 return 反向（S12）', () => {
    expect(plan.frames.get('sc.play#update')).toMatchObject({ relation: 'r6', relationInferred: true, reverse: false })
    expect(plan.frames.get('sc.play#2')).toMatchObject({ relation: 'r1', relationInferred: false })
    expect(plan.frames.get('sc.play#done')).toMatchObject({ relation: 're1', relationInferred: true, reverse: false })
    expect(plan.frames.get('sc.play#4/1')).toMatchObject({ kind: 'return', relation: 'r2', reverse: true })
  })
})
