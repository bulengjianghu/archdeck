/** 导航树用到的架构查询：步骤大纲（T6）、参与模块（T5） */
import { describe, expect, it } from 'vitest'
import { loadModel, outlineScenario, planScenario, scenarioModules, type OutlineNode } from '../../src/model'
import { scenarioFiles } from '../fixtures/sample'

const { index } = loadModel(scenarioFiles())
const plan = planScenario(index, 'sc.play')
const ALT = 'sc.play#3'

/** 便于断言的缩写：帧 → id@状态，分组 → 类型[子]，alt → 各分支 */
function shape(nodes: OutlineNode[]): unknown[] {
  return nodes.map(n =>
    n.kind === 'frame'
      ? `${n.frame.id.replace('sc.play#', '')}@${n.status}`
      : n.kind === 'group'
        ? { [n.tag.kind]: shape(n.children) }
        : { alt: n.options.map(o => ({ [`${o.when}@${o.status}`]: shape(o.children) })) },
  )
}

describe('步骤大纲（T6）', () => {
  it('按组合结构嵌套：alt 列出全部分支（空分支无子节点），loop 与 ref 成为分组；未选分支时其后为未到达', () => {
    expect(shape(outlineScenario(plan, new Map()))).toEqual([
      'start@path',
      '1@path',
      '2@path',
      {
        alt: [
          { '需要改图@unreached': ['update@unreached', { loop: ['3.alt0.1.loop.0@unreached'] }] },
          { '无需改图@unreached': [] },
        ],
      },
      { ref: ['4/0@unreached', '4/1@unreached'] },
      'done@unreached',
    ])
  })

  it('选了分支：已选的在路径上，未选的标 unchosen，其后回到路径上', () => {
    const o = outlineScenario(plan, new Map([[ALT, 1]]))
    const alt = o.find(n => n.kind === 'alt')
    expect(alt?.kind === 'alt' && alt.options.map(x => x.status)).toEqual(['unchosen', 'path'])
    expect(alt?.kind === 'alt' && alt.options[0].children[0]).toMatchObject({ kind: 'frame', status: 'unchosen' })
    expect(o.at(-1)).toMatchObject({ kind: 'frame', status: 'path' })
  })

  it('大纲覆盖计划中的全部帧，每帧恰好一次', () => {
    const ids: string[] = []
    const walk = (ns: OutlineNode[]) =>
      ns.forEach(n => (n.kind === 'frame' ? ids.push(n.frame.id) : n.kind === 'group' ? walk(n.children) : n.options.forEach(x => walk(x.children))))
    walk(outlineScenario(plan, new Map([[ALT, 0]])))
    expect(ids.sort()).toEqual([...plan.frames.keys()].sort())
  })

  it('par 的各分支是相邻的分组', () => {
    const { index: idx } = loadModel(
      scenarioFiles({
        'scenarios/p.yaml': `scenario: { id: sc.p, name: P, steps: [{ par: [{ steps: [{ call: { from: infra.player, to: app.solution } }] }, { steps: [{ call: { from: infra.player, to: domain.services } }] }] }] }`,
      }),
    )
    const o = outlineScenario(planScenario(idx, 'sc.p'), new Map())
    expect(o.map(n => n.kind === 'group' && [n.tag.kind, n.tag.branch])).toEqual([
      ['par', 0],
      ['par', 1],
    ])
  })
})

describe('参与模块（T5）', () => {
  it('计划中全部帧（含所有分支、ref）的模块端点及其祖先，不含系统根与参与者', () => {
    const m = scenarioModules(index, plan)
    for (const id of ['infra', 'infra.player', 'infra.framework', 'infra.framework.pipeline', 'infra.mus', 'app', 'app.solution', 'domain.services']) expect(m.has(id)).toBe(true)
    expect(m.has('sys')).toBe(false)
    expect(m.has('actor.biz')).toBe(false)
  })
})
