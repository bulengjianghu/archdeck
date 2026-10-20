/** 时序图排布：A7（参与者最左并隔出系统边界）、P9（泳道按结构图横坐标排序）、组合框包住子消息 */
import { describe, expect, it } from 'vitest'
import { buildSequence, loadModel, planScenario, projectLevel, projectScenario, stageEnds } from '../../src/model'
import { layoutView } from '../../src/layout/layout'
import { layoutSequence, textWidth } from '../../src/layout/sequence'
import { scenarioFiles } from '../fixtures/sample'

const { index } = loadModel(scenarioFiles())
const plan = planScenario(index, 'sc.play')
const choices = new Map([['sc.play#3', 0]])

async function setup(level: string) {
  const view = projectLevel(index, level, { showBoundaries: true, mergeTypes: true, scenarioEnds: stageEnds(plan) })
  const model = buildSequence(index, view, plan, choices, projectScenario(index, view, plan, choices))
  const structure = await layoutView(view)
  return { model, structure, ps: layoutSequence(model, structure) }
}

describe('layoutSequence', () => {
  it('A7：参与者泳道在最左，分隔线隔出系统边界', async () => {
    const { ps } = await setup('infra')
    const order = [...ps.lanes.keys()]
    expect(order[0]).toBe('actor.biz')
    const biz = ps.lanes.get('actor.biz')!
    expect(ps.boundaryX).toBeGreaterThan(biz.x + biz.w)
    for (const id of order.slice(1)) expect(ps.lanes.get(id)!.x).toBeGreaterThan(ps.boundaryX!)
  })

  it('P9：系统内泳道按结构图中节点的横坐标排序', async () => {
    const { ps, structure } = await setup('infra')
    const inner = [...ps.lanes.keys()].slice(1)
    const xs = inner.map(id => structure.nodes.get(id)!.x + structure.nodes.get(id)!.w / 2)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
  })

  it('泳道宽度按名称自适应，互不重叠；消息自上而下', async () => {
    const { ps } = await setup('infra')
    const lanes = [...ps.lanes.values()]
    for (let i = 1; i < lanes.length; i++) expect(lanes[i].x).toBeGreaterThanOrEqual(lanes[i - 1].x + lanes[i - 1].w)
    expect(textWidth('ab')).toBe(14)
    expect(textWidth('中文')).toBe(26)
    for (let i = 1; i < ps.messages.length; i++) expect(ps.messages[i].y).toBeGreaterThan(ps.messages[i - 1].y)
  })

  it('组合框包住其消息，内层框缩进；alt 第二个分支有分隔线', async () => {
    const { ps, model } = await setup('infra')
    model.fragments.forEach((f, k) => {
      const box = ps.fragments[k]
      for (let i = f.first; i <= f.last; i++) {
        expect(ps.messages[i].y).toBeGreaterThan(box.y)
        expect(ps.messages[i].y).toBeLessThan(box.y + box.h)
      }
    })
    const alt = model.fragments.findIndex(f => f.kind === 'alt')
    const loop = model.fragments.findIndex(f => f.kind === 'loop')
    expect(ps.fragments[loop].y).toBeGreaterThan(ps.fragments[alt].y)
    expect(ps.fragments[loop].y + ps.fragments[loop].h).toBeLessThanOrEqual(ps.fragments[alt].y + ps.fragments[alt].h)
    expect(ps.fragments[alt].branchY).toHaveLength(1)
    expect(ps.size.h).toBeGreaterThan(ps.messages[ps.messages.length - 1].y)
  })

  it('没有结构图坐标时按出现顺序排', async () => {
    const { model } = await setup('infra')
    expect([...layoutSequence(model).lanes.keys()]).toEqual(model.participants.filter(p => p.kind === 'actor').concat(model.participants.filter(p => p.kind !== 'actor')).map(p => p.nodeId))
  })
})
