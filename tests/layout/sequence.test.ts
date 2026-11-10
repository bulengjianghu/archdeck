/** 时序图排布：A7（参与者最左并隔出系统边界）、P9（泳道按层次顺序）、P13（同一父模块分组）、组合框包住子消息 */
import { describe, expect, it } from 'vitest'
import { buildSequence, compareKeys, loadModel, planScenario, projectLevel, projectScenario, stageEnds } from '../../src/model'
import { layoutView } from '../../src/layout/layout'
import { layoutSequence, textWidth } from '../../src/layout/sequence'
import { scenarioFiles } from '../fixtures/sample'

const { index } = loadModel(scenarioFiles())
const plan = planScenario(index, 'sc.play')
const choices = new Map([['sc.play#3', 0]])

async function setup(level: string) {
  const view = projectLevel(index, level, { showBoundaries: true, scenarioEnds: stageEnds(plan) })
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

  it('P9：同一父模块内的本层子模块按结构图横坐标排，其余按层次顺序', async () => {
    const { ps, structure, model } = await setup('infra.framework')
    const inner = [...ps.lanes.keys()].filter(id => model.participants.find(p => p.nodeId === id)!.kind !== 'actor')
    const parts = inner.map(id => model.participants.find(p => p.nodeId === id)!)
    // 本层子模块（byX）之间按横坐标
    const local = parts.filter(p => p.byX)
    const xs = local.map(p => structure.nodes.get(p.nodeId)!.x + structure.nodes.get(p.nodeId)!.w / 2)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
    // 跨父模块按层次顺序：排序键的父模块前缀单调不减
    for (let i = 1; i < parts.length; i++) {
      const a = parts[i - 1]
      const b = parts[i]
      if (!(a.byX && b.byX)) expect(compareKeys(a.key, b.key)).toBeLessThan(0)
    }
  })

  it('P13：父模块相同的连续泳道成一组，分组框覆盖这些泳道；有分组时泳道头下移', async () => {
    const { ps, model } = await setup('infra')
    expect(ps.groups.length).toBeGreaterThan(0)
    for (const g of ps.groups) {
      const members = model.participants.filter(p => p.parentId === g.parentId && ps.lanes.has(p.nodeId))
      expect(members.length).toBeGreaterThan(0)
      for (const p of members) {
        const lane = ps.lanes.get(p.nodeId)!
        if (lane.x >= g.x && lane.x + lane.w <= g.x + g.w) continue
        // 同一父模块的泳道不连续时会出现多个分组，至少落在其中一个里
        expect(ps.groups.some(o => o.parentId === g.parentId && lane.x >= o.x && lane.x + lane.w <= o.x + o.w)).toBe(true)
      }
    }
    expect(model.participants.filter(p => p.kind === 'actor').every(p => p.parentId === undefined)).toBe(true)
    expect(ps.headY).toBeGreaterThan(8)
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

  it('没有结构图坐标时按层次排序键排', async () => {
    const { model } = await setup('infra')
    const inner = model.participants.filter(p => p.kind !== 'actor').sort((a, b) => compareKeys(a.key, b.key))
    expect([...layoutSequence(model).lanes.keys()]).toEqual(
      model.participants
        .filter(p => p.kind === 'actor')
        .concat(inner)
        .map(p => p.nodeId),
    )
  })
})

describe('S17 消息的证据等级', () => {
  it('给了各帧等级时每条消息取合并帧中最弱的一档（有一帧无证据即无证据），没有等级的消息不标', async () => {
    const { model: base, structure } = await setup('infra')
    // 本层的可见消息都只有一帧：把第一条改成合并两帧的消息
    const first = base.messages.findIndex(m => m.kind !== 'empty')
    const model = { ...base, messages: base.messages.map((m, i) => (i === first ? { ...m, frameIds: [...m.frameIds, 'merged'] } : m)) }
    const visible = model.messages.map((m, i) => ({ m, i })).filter(({ m }) => m.kind !== 'empty')
    const a = visible[0]
    const b = visible[1]
    const levels = new Map<string, 'name' | 'module' | 'none' | 'skipped'>()
    a.m.frameIds.forEach((id, k) => levels.set(id, k === 0 ? 'name' : 'none'))
    b.m.frameIds.forEach(id => levels.set(id, 'module'))
    const ps = layoutSequence(model, structure, levels)
    expect(ps.messages[a.i].evidence).toBe('none')
    expect(ps.messages[b.i].evidence).toBe('module')
    expect(visible.filter(x => x !== a && x !== b).every(({ i }) => ps.messages[i].evidence === undefined)).toBe(true)
    expect(layoutSequence(model, structure).messages.every(m => !('evidence' in m))).toBe(true)
  })
})
