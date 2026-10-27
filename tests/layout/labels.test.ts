/** 标签位（L26，ADR-0035）：词表与合并次序、聚合边的条数、分层总览只给计数、运行视角走过的边不标条数而标签照写、代码事实的逐条证实（levelFacts） */
import { describe, expect, it } from 'vitest'
import { loadModel, planScenario, projectLevel, projectScenario, stageEnds, type LevelFacts } from '../../src/model'
import { layoutView } from '../../src/layout/layout'
import { stageOverlay } from '../../src/layout/stage'
import { EDGE_TAGS, canvasScene, composeLabel, hasWarnTag, type CanvasInput } from '../../src/layout/canvas'
import { scenarioFiles } from '../fixtures/sample'

const { index } = loadModel(scenarioFiles())

async function level(id: string): Promise<CanvasInput> {
  return {
    positioned: await layoutView(projectLevel(index, id, { showBoundaries: true })),
    index,
    selection: null,
    hover: null,
    stage: null,
    scenarioView: null,
    emphasis: null,
    participants: new Map(),
    mode: 'hide',
    reveal: [],
    diff: null,
    fileHits: null,
    branchPointId: null,
  }
}

const facts = (over: Partial<LevelFacts>): LevelFacts => ({
  edgeFacts: new Map(),
  violatedEdges: new Set(),
  overlays: [],
  cycles: new Map(),
  levelCycles: [],
  ...over,
})

describe('L26 ①② 词表与合并', () => {
  it('词表次序：违规 > 未证实 > 未解释 > 缺段 > 回调 > 混合 > 经上层 > 未建模；每个 ≤ 3 字', () => {
    expect([...EDGE_TAGS]).toEqual(['违规', '未证实', '未解释', '缺段', '回调', '混合', '经上层', '未建模'])
    for (const t of EDGE_TAGS) expect(t.length).toBeLessThanOrEqual(3)
  })

  it('一个 pill：×N 与把手在前，标签按词表次序用 ` · ` 连接；同一标签只写一次', () => {
    expect(composeLabel('×5 · 2 把手', [{ tag: '混合' }, { tag: '回调', count: 1, total: 5 }, { tag: '未证实', count: 2, total: 5 }, { tag: '违规' }])).toBe(
      '×5 · 2 把手 · 违规 · 未证实 2 · 回调 1 · 混合',
    )
    expect(composeLabel('', [{ tag: '回调' }, { tag: '回调' }])).toBe('回调')
    expect(composeLabel('×3', [null, false, undefined])).toBe('×3')
  })

  it('聚合边上标签后的 M 为带该标签的条数，全部都带时省略；没有 total 的（叠加线）照写条数；单条边没有 ×N', () => {
    expect(composeLabel('×4', [{ tag: '未证实', count: 4, total: 4 }])).toBe('×4 · 未证实')
    expect(composeLabel('×4', [{ tag: '未证实', count: 3, total: 4 }])).toBe('×4 · 未证实 3')
    expect(
      composeLabel('', [
        { tag: '违规', count: 1 },
        { tag: '未解释', count: 2 },
      ]),
    ).toBe('违规 1 · 未解释 2')
    expect(composeLabel('', [{ tag: '未证实', count: 1, total: 1 }])).toBe('未证实')
  })

  it('异常（违规、未证实、未解释、缺段、未建模）画成警示色；回调、混合、经上层不是异常', () => {
    for (const tag of ['违规', '未证实', '未解释', '缺段', '未建模'] as const) expect(hasWarnTag([{ tag }])).toBe(true)
    for (const tag of ['回调', '混合', '经上层'] as const) expect(hasWarnTag([{ tag }])).toBe(false)
  })
})

describe('L26 ③ 分层总览只给计数', () => {
  it('未证实只写在聚合边上、总带条数；单条的边不写；违规照写', async () => {
    const { index: idx } = loadModel(scenarioFiles({ 'z.yaml': 'relations: [{ id: x1, from: infra.player, to: app.solution, type: calls }]' }))
    const v = projectLevel(idx, 'sys', { showBoundaries: true })
    expect(v.mode).toBe('layered')
    const input = { ...(await level('sys')), index: idx, positioned: await layoutView(v) }
    const agg = v.edges.find(e => e.id === 'infra->app:calls')!
    const single = v.edges.find(e => e.id === 'app->domain:calls')!
    expect(agg.relationIds.length).toBe(2)
    expect(single.relationIds.length).toBe(1)
    const unconfirmed = new Map([...agg.relationIds, ...single.relationIds].map(id => [id, { isolated: false }]))
    const s = canvasScene({ ...input, facts: facts({ unconfirmed, violatedEdges: new Set([agg.id, single.id]) }) })
    // 全部未证实也写条数（总览只给计数）
    expect(s.edges.find(e => e.id === agg.id)!.data.label).toBe('×2 · 违规 · 未证实 2')
    // 单条的边不写未证实，违规照写
    expect(s.edges.find(e => e.id === single.id)!.data.label).toBe('违规')
    // 普通层次的单条边照写（对照）
    const inf = await level('infra')
    const one = inf.positioned!.view.edges.find(x => x.relationIds.length === 1 && !x.from.startsWith('boundary:') && !x.to.startsWith('boundary:'))!
    const infra = canvasScene({ ...inf, facts: facts({ unconfirmed: new Map([[one.relationIds[0], { isolated: false }]]) }) })
    expect(infra.edges.find(x => x.id === one.id)!.data.label).toBe('未证实')
  })
})

describe('L26 ④ 运行视角', () => {
  it('走过的边不标条数，代码事实不叠加（没有未证实、违规）', async () => {
    const plan = planScenario(index, 'sc.play')
    const view = projectLevel(index, 'infra', { showBoundaries: true, scenarioEnds: stageEnds(plan) })
    const sv = projectScenario(index, view, plan, new Map([['sc.play#3', 0]]))
    const positioned = await layoutView(view)
    const stage = stageOverlay(sv, positioned, 'sc.play#done')
    const s = canvasScene({ ...(await level('infra')), positioned, scenarioView: sv, stage })
    const walked = s.edges.filter(e => e.data.play === 'walked' || e.data.play === 'current')
    expect(walked.length).toBeGreaterThan(0)
    for (const e of walked) {
      expect(e.data.label).not.toMatch(/×\d/)
      expect(e.data.label).not.toMatch(/未证实|违规/)
    }
  })
})
