import { describe, expect, it } from 'vitest'
import { loadModel, projectLevel } from '../../src/model'
import {
  BAND,
  PARALLEL_GAP,
  cacheKey,
  contentBounds,
  edgeLabel,
  edgeWeight,
  layoutLayered,
  layoutView,
  moreChipId,
  parallelOffsets,
  placeBoundaries,
  toElkGraph,
  type Box,
  type EdgeRoute,
} from '../../src/layout/layout'
import type { ViewEdge } from '../../src/model'
import { sampleFiles, scenarioFiles } from '../fixtures/sample'

const { index } = loadModel(sampleFiles())

describe('layoutLayered · 分层总览', () => {
  const view = projectLevel(index, 'sys')
  const pv = layoutLayered(view)

  it('带按层序自上而下排列，等宽且互不重叠', () => {
    const bands = ['infra', 'app', 'domain'].map(id => pv.nodes.get(id)!)
    expect(new Set(bands.map(b => b.w)).size).toBe(1)
    for (let i = 1; i < bands.length; i++) expect(bands[i].y).toBeGreaterThanOrEqual(bands[i - 1].y + bands[i - 1].h + BAND.gap)
  })

  it('核心模块与 +N 占位块落在所属带的中栏内', () => {
    for (const band of view.bands!) {
      const b = pv.nodes.get(band.layerId)!
      const chips = [...band.coreModuleIds, ...(band.hiddenCount ? [moreChipId(band.layerId)] : [])].map(id => pv.nodes.get(id)!)
      for (const c of chips) {
        expect(c.x).toBeGreaterThanOrEqual(BAND.left)
        expect(c.x + c.w).toBeLessThanOrEqual(b.w - BAND.right)
        expect(c.y).toBeGreaterThanOrEqual(b.y)
        expect(c.y + c.h).toBeLessThanOrEqual(b.y + b.h)
      }
    }
  })

  it('相邻层之间是竖直线段，跨层的边走右侧通道', () => {
    const adjacent = pv.edges.get('infra->app:calls')!
    expect(adjacent.points).toHaveLength(2)
    expect(adjacent.points[0].x).toBe(adjacent.points[1].x)
    const skip = pv.edges.get('infra->domain:depends')!
    expect(skip.points).toHaveLength(4)
    expect(skip.points[1].x).toBeGreaterThan(pv.nodes.get('infra')!.w)
  })

  it('同一空隙里的多条边横向错开', () => {
    const xs = ['infra->app:calls', 'infra->app:depends'].map(id => pv.edges.get(id)!.points[0].x)
    expect(xs[0]).not.toBe(xs[1])
  })

  it('核心跨层边是从上层底部到下层顶部的曲线', () => {
    const e = pv.coreEdges.get('infra.framework->app.solution:calls')!
    expect(e.curve).toBe(true)
    const from = pv.nodes.get('infra.framework')!
    const to = pv.nodes.get('app.solution')!
    expect(e.points[0].y).toBe(from.y + from.h)
    expect(e.points[1].y).toBe(to.y)
  })

  it('外框包含所有节点与右侧通道', () => {
    const b = contentBounds(pv)!
    const lane = pv.edges.get('infra->domain:depends')!.points[1].x
    expect(b.x).toBe(0)
    expect(b.x + b.w).toBeGreaterThanOrEqual(lane)
  })
})

describe('layoutView', () => {
  it('普通层次用 elk 排布：节点不重叠、每条边都有走线', async () => {
    const view = projectLevel(index, 'infra')
    const pv = await layoutView(view)
    const boxes = [...pv.nodes.values()]
    expect(boxes).toHaveLength(view.nodes.length)
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlap).toBe(false)
      }
    for (const e of view.edges) expect(pv.edges.get(e.id)!.points.length).toBeGreaterThanOrEqual(2)
  })

  it('同样的视图命中缓存，得到同样的坐标', async () => {
    const a = await layoutView(projectLevel(index, 'infra'))
    const b = await layoutView(projectLevel(index, 'infra'))
    expect([...b.nodes]).toEqual([...a.nodes])
  })

  it('空层次不调用布局', async () => {
    const pv = await layoutView(projectLevel(index, 'infra.mus'))
    expect(pv.nodes.size).toBe(0)
    expect(contentBounds(pv)).toBeNull()
  })

  it('缓存键随节点或边的变化而变化', () => {
    const full = projectLevel(index, 'infra')
    const noBoundary = projectLevel(index, 'infra', { showBoundaries: false })
    expect(cacheKey(full)).not.toBe(cacheKey(noBoundary))
  })
})

describe('边界节点', () => {
  it('普通层次：边界节点排在内部结构下方一行，边界边为曲线', async () => {
    const view = projectLevel(index, 'infra', { showBoundaries: true })
    const pv = await layoutView(view)
    const inner = view.nodes.filter(n => n.role !== 'boundary').map(n => pv.nodes.get(n.id)!)
    const bottom = Math.max(...inner.map(b => b.y + b.h))
    const boundaries = view.nodes.filter(n => n.role === 'boundary').map(n => pv.nodes.get(n.id)!)
    expect(boundaries.length).toBe(2)
    for (const b of boundaries) expect(b.y).toBeGreaterThan(bottom)
    expect(new Set(boundaries.map(b => b.y)).size).toBe(1)
    const e = view.edges.find(x => x.to === 'boundary:app')!
    expect(pv.edges.get(e.id)!.curve).toBe(true)
  })
})

describe('外部参与者（A7）', () => {
  const { index: idx } = loadModel(scenarioFiles())

  it('分层总览：用户在带的上方，外部系统在右侧通道之外；有边界框', async () => {
    const view = projectLevel(idx, 'sys')
    const pv = await layoutView(view)
    const firstBand = pv.nodes.get('infra')!
    const viewer = pv.nodes.get('actor.viewer')!
    const biz = pv.nodes.get('actor.biz')!
    expect(viewer.y + viewer.h).toBeLessThan(firstBand.y)
    expect(biz.x).toBeGreaterThan(firstBand.x + firstBand.w)
    expect(pv.frame).toBeDefined()
    for (const e of view.edges.filter(x => x.from.startsWith('actor'))) expect(pv.edges.get(e.id)!.curve).toBeTruthy()
  })

  it('普通层次：参与者不参与 elk 排布，排在边界框外；边界框只包住内部模块', async () => {
    const view = projectLevel(idx, 'infra', { showBoundaries: true })
    const pv = await layoutView(view)
    const f = pv.frame!
    for (const n of view.nodes.filter(x => x.role === 'module')) {
      const b = pv.nodes.get(n.id)!
      expect(b.x).toBeGreaterThanOrEqual(f.x)
      expect(b.x + b.w).toBeLessThanOrEqual(f.x + f.w)
    }
    const viewer = pv.nodes.get('actor.viewer')!
    expect(viewer.y + viewer.h).toBeLessThan(f.y)
    expect(pv.nodes.get('actor.biz')!.x).toBeGreaterThan(f.x + f.w)
    expect(pv.edges.get(view.edges.find(e => e.from === 'actor.biz')!.id)).toBeDefined()
  })

  it('没有参与者时没有边界框', async () => {
    expect((await layoutView(projectLevel(index, 'infra'))).frame).toBeUndefined()
  })
})

describe('L10：标签、线宽档、平行边', () => {
  const ve = (id: string, from: string, to: string, n: number, type: ViewEdge['type'] = 'calls'): ViewEdge => ({
    id,
    kind: n > 1 ? 'aggregate' : 'direct',
    from,
    to,
    type,
    relationIds: Array.from({ length: n }, (_, i) => `r${i}`),
    mode: 'sync',
  })

  it('标签只标聚合条数：含多条关系为 ×N，其余为空，不写类型名', () => {
    expect(edgeLabel(ve('a', 'x', 'y', 1))).toBe('')
    expect(edgeLabel(ve('a', 'x', 'y', 3, 'depends'))).toBe('×3')
  })

  it('线宽三档：1 / 2–4 / ≥5', () => {
    expect([1, 2, 4, 5, 12].map(n => edgeWeight(ve('a', 'x', 'y', n)))).toEqual([1, 2, 2, 3, 3])
  })

  it('同一对节点（不论方向）的多条边对称错开，单条为 0', () => {
    const o = parallelOffsets([ve('a', 'x', 'y', 1), ve('b', 'x', 'y', 1, 'depends'), ve('c', 'y', 'x', 1, 'event'), ve('d', 'x', 'z', 1)])
    expect([o.get('a'), o.get('b'), o.get('c'), o.get('d')]).toEqual([-PARALLEL_GAP, 0, PARALLEL_GAP, 0])
  })

  it('同一对节点按类型的平行边都交给 elk；边界边的曲线按序号错开', () => {
    const { index: idx } = loadModel(sampleFiles({ 'z.yaml': 'relations: [{ id: x1, from: infra.player, to: app.solution, type: calls }]' }))
    const view = projectLevel(idx, 'infra', { showBoundaries: true })
    const pair = view.edges.filter(e => e.from === 'infra.player' && e.to === 'boundary:app')
    expect(pair.map(e => e.type).sort()).toEqual(['calls', 'depends'])
    const inner = { ...view, edges: [ve('p:calls', 'infra.player', 'infra.framework', 1), ve('p:depends', 'infra.player', 'infra.framework', 2, 'depends')] }
    expect(toElkGraph(inner).edges!.map(e => [e.id, e.labels![0].text])).toEqual([
      ['p:calls', ''],
      ['p:depends', '×2'],
    ])
    const nodes = new Map<string, Box>(view.nodes.filter(n => n.role === 'module').map((n, i) => [n.id, { x: i * 240, y: 0, w: 208, h: 76 }]))
    const routes = new Map<string, EdgeRoute>()
    placeBoundaries(view, nodes, routes)
    const [a, b] = pair.map(e => routes.get(e.id)!.points[0].x)
    expect(Math.abs(a - b)).toBe(PARALLEL_GAP)
  })
})
