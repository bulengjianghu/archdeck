/** 舞台叠加：V5（参与的节点、走过的边）、P10（方向）、P11（未建模临时线）、R11（本层不可见）、分支预览 */
import { describe, expect, it } from 'vitest'
import { landFrame, loadModel, planScenario, projectLevel, projectScenario, stageEnds } from '../../src/model'
import { layoutView } from '../../src/layout/layout'
import { stageOverlay, unmodeledId } from '../../src/layout/stage'
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
