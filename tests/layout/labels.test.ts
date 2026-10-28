/** 标签位（L26，ADR-0035、ADR-0041）：两段与上限、机制标签（L35）、「混合」只表同步 / 异步（L23）、「向上」（K22），词表与合并次序、聚合边的条数、分层总览只给计数、运行视角走过的边不标条数而标签照写、代码事实的逐条证实（levelFacts） */
import { describe, expect, it } from 'vitest'
import { loadModel, planScenario, projectLevel, projectScenario, stageEnds, type LevelFacts } from '../../src/model'
import { layoutView } from '../../src/layout/layout'
import { stageOverlay } from '../../src/layout/stage'
import { EDGE_TAGS, canvasScene, composeLabel, composePill, hasWarnTag, pillWidth, labelWidth, PILL_GAP, type CanvasInput } from '../../src/layout/canvas'
import { labelSize } from '../../src/layout/routes'
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
  it('词表次序：异常（违规 > 向上 > 未证实 > 未解释 > 缺段 > 未建模）在前，修饰（机制九词 > 混合 > 经上层）在后；每个 ≤ 3 字', () => {
    expect([...EDGE_TAGS]).toEqual([
      '违规',
      '向上',
      '未证实',
      '未解释',
      '缺段',
      '未建模',
      '回调',
      '端口',
      '总线',
      '注入',
      '跨进程',
      '路由',
      '事件',
      '通道',
      '拉取',
      '混合',
      '经上层',
    ])
    for (const t of EDGE_TAGS) expect(t.length).toBeLessThanOrEqual(3)
  })

  it('一个 pill：×N 与把手在前，标签按词表次序用 ` · ` 连接；同一标签只写一次', () => {
    expect(composeLabel('×5 · 2 把手', [{ tag: '混合' }, { tag: '回调', count: 1, total: 5 }, { tag: '未证实', count: 2, total: 5 }, { tag: '违规' }])).toBe(
      '×5 · 2 把手 · 违规 · 未证实 2 · 回调 1 · 混合',
      // composeLabel 不分段、不设上限（结构边用）；交互边用 composePill
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

  it('异常（违规、向上、未证实、未解释、缺段、未建模）画成警示色；机制、混合、经上层是修饰', () => {
    for (const tag of ['违规', '向上', '未证实', '未解释', '缺段', '未建模'] as const) expect(hasWarnTag([{ tag }])).toBe(true)
    for (const tag of ['回调', '端口', '总线', '注入', '跨进程', '路由', '事件', '通道', '拉取', '混合', '经上层'] as const)
      expect(hasWarnTag([{ tag }])).toBe(false)
  })
})

describe('L26② 两段与上限（ADR-0041 裁决 3）', () => {
  it('没有异常：一段中性，×N 与把手在其中', () => {
    expect(composePill('×3', [{ tag: '端口', count: 2, total: 3 }])).toEqual({
      segments: [{ text: '×3 · 端口 2', warn: false }],
      hidden: [],
      text: '×3 · 端口 2',
    })
    expect(composePill('', [{ tag: '回调' }]).segments).toEqual([{ text: '回调', warn: false }])
    expect(composePill('', []).segments).toEqual([])
  })

  it('有异常：异常段（含 ×N 与把手，警示色）在前，修饰段（中性）在后', () => {
    const p = composePill('×5 · 2 把手', [
      { tag: '端口', count: 1, total: 5 },
      { tag: '未证实', count: 4, total: 5 },
    ])
    expect(p.segments).toEqual([
      { text: '×5 · 2 把手 · 未证实 4', warn: true },
      { text: '端口 1', warn: false },
    ])
    expect(p.text).toBe('×5 · 2 把手 · 未证实 4 · 端口 1')
  })

  it('标签至多两个（不含 ×N 与把手），按词表次序取前两个，其余写「+k」接在最后一段末尾', () => {
    const p = composePill('×5 · 2 把手', [{ tag: '混合' }, { tag: '端口', count: 1, total: 5 }, { tag: '未证实', count: 4, total: 5 }])
    expect(p.segments).toEqual([
      { text: '×5 · 2 把手 · 未证实 4', warn: true },
      { text: '端口 1 · +1', warn: false },
    ])
    expect(p.hidden).toEqual([{ tag: '混合' }])
    // 两个都是异常：「+k」接在异常段末尾
    const q = composePill('×4', [
      { tag: '违规' },
      { tag: '向上', count: 2, total: 4 },
      { tag: '注入', count: 1, total: 4 },
      { tag: '回调', count: 1, total: 4 },
    ])
    expect(q.segments).toEqual([{ text: '×4 · 违规 · 向上 2 · +2', warn: true }])
    expect(q.hidden.map(x => x.tag)).toEqual(['回调', '注入'])
  })

  it('L33：估宽按两段的实际文字——各段各加内边距，段间加间距；视图边的机制与混合进估宽', () => {
    const segs = composePill('×5', [
      { tag: '未证实', count: 2, total: 5 },
      { tag: '端口', count: 1, total: 5 },
    ]).segments
    expect(pillWidth(segs)).toBe(labelWidth('×5 · 未证实 2') + labelWidth('端口 1') + PILL_GAP)
    const e = {
      id: 'a->b:commands',
      kind: 'aggregate' as const,
      from: 'a',
      to: 'b',
      type: 'commands' as const,
      relationIds: ['r1', 'r2'],
      mode: 'mixed' as const,
    }
    expect(labelSize(e)!.w).toBe(labelWidth('×2 · 2 把手 · 混合'))
    expect(labelSize({ ...e, mechs: { 端口: 2, 注入: 1 } })!.w).toBe(labelWidth('×2 · 2 把手 · 端口 · 注入 1 · +1'))
    // 单条边：只有机制时也占位；什么都不写时不占位
    expect(labelSize({ ...e, relationIds: ['r1'], mode: 'sync', mechs: { 回调: 1 } })!.w).toBe(labelWidth('回调'))
    expect(labelSize({ ...e, relationIds: ['r1'], mode: 'sync' })).toBeNull()
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

describe('L35 机制标签与「向上」在画布上（ADR-0041）', () => {
  const extra = {
    'z.yaml': `relations:
  - { id: x1, from: infra.player, to: infra.mus, type: commands, via: 'channel:inject' }
  - { id: x2, from: infra.player, to: infra.mus, type: commands, mode: async, via: 'channel:http' }
  - { id: x3, from: infra.player, to: infra.mus, type: commands }
  - { id: y1, from: infra.player, to: app.solution, type: commands, via: 'port:if.plan' }
`,
  }
  const { index: idx } = loadModel(scenarioFiles(extra))
  const at = async (id: string): Promise<CanvasInput> => {
    const v = projectLevel(idx, id, { showBoundaries: true })
    return { ...(await level('infra')), index: idx, positioned: await layoutView(v) }
  }
  const ID = 'infra.player->infra.mus:commands'

  it('机制写在修饰段、中性色，聚合边带条数；同步 / 异步不一致才写「混合」；超过两个写「+k」，悬停逐条列出', async () => {
    const s = canvasScene(await at('infra'))
    const d = s.edges.find(e => e.id === ID)!.data
    expect(d.label).toBe('×3 · 注入 1 · 跨进程 1 · +1')
    expect(d.warn).toBeFalsy()
    expect(d.mixed).toBe(true)
    expect(d.title).toContain('另 1 个标签')
    expect(d.title).toContain('· 混合')
  })

  it('「混合」不因 via 不一致出现（L23）', async () => {
    const { index: i2 } = loadModel(
      scenarioFiles({
        'z.yaml': `relations:
  - { id: x1, from: infra.player, to: infra.mus, type: commands, via: 'channel:inject' }
  - { id: x3, from: infra.player, to: infra.mus, type: commands }
`,
      }),
    )
    const v = projectLevel(i2, 'infra', { showBoundaries: true })
    const s = canvasScene({ ...(await level('infra')), index: i2, positioned: await layoutView(v) })
    expect(s.edges.find(e => e.id === ID)!.data.label).toBe('×2 · 注入 1')
  })

  it('向上（K22）：交互朝上又没有机制的写进异常段，机制在其后的中性段', async () => {
    const s = canvasScene({ ...(await at('infra')), upward: new Map([[ID, ['x3']]]) })
    const d = s.edges.find(e => e.id === ID)!.data
    expect(d.segments).toEqual([
      { text: '×3 · 向上 1', warn: true },
      { text: '注入 1 · +2', warn: false },
    ])
    expect(d.warn).toBe(true)
    expect(d.title).toContain('向上（K22）')
  })

  it('分层总览照写机制（L26③）；经端口的边同时有插座（L12）', async () => {
    const s = canvasScene(await at('sys'))
    const e = s.edges.find(x => x.id === 'infra->app:commands')!
    expect(e.data.label).toBe('端口')
    expect(e.data.port).toBe(true)
  })
})
