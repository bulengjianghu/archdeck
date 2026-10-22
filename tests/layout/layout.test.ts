import { describe, expect, it } from 'vitest'
import { loadModel, projectLevel } from '../../src/model'
import {
  BAND,
  bandColumnsFor,
  PARALLEL_GAP,
  cacheKey,
  portSide,
  edgeRoute,
  isBoundaryEdge,
  LAYOUT_VERSION,
  contentBounds,
  edgeLabel,
  edgeWeight,
  layoutLayered,
  layoutView,
  moreChipId,
  parallelOffsets,
  toElkGraph,
  fromElkGraph,
  LABEL_SLOT,
  spreadEnds,
  type EdgeRoute,
} from '../../src/layout/layout'
import type { ViewEdge } from '../../src/model'
import { sampleFiles, scenarioFiles } from '../fixtures/sample'

const { index } = loadModel(sampleFiles())

describe('layoutLayered · 分层总览', () => {
  const view = projectLevel(index, 'sys')
  const pv = layoutLayered(view)

  it('O7：带宽按画布宽度铺开——列数随宽度增加，至少 3、至多 maxColumns；缓存按列数区分', () => {
    expect(bandColumnsFor(400)).toBe(3)
    expect(bandColumnsFor(10_000)).toBe(BAND.maxColumns)
    const narrow = layoutLayered(view, { bandColumns: 3 }).nodes.get('infra')!.w
    const wide = layoutLayered(view, { bandColumns: 8 }).nodes.get('infra')!.w
    expect(wide).toBeGreaterThan(narrow)
    expect(cacheKey(view, { bandColumns: 3 })).not.toBe(cacheKey(view, { bandColumns: 8 }))
  })

  it('O6：展开的层的占位块变为「收起」，仍占一个位置', () => {
    const v = projectLevel(index, 'sys', { showBoundaries: true, expandedBands: ['app'] })
    expect(layoutLayered(v).nodes.has(moreChipId('app'))).toBe(true)
  })

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
  it('普通层次用 elk 排布：节点不重叠、每条边都有走线（边界边按需走线，edgeRoute）', async () => {
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
    for (const e of view.edges) expect(edgeRoute(pv, e)!.points.length).toBeGreaterThanOrEqual(2)
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
  it('普通层次（L4）：边界节点排在内部结构下方同一行、按层次顺序；边界边不参与布局，按需正交绕行、不穿节点、从目标上方进入', async () => {
    const view = projectLevel(index, 'infra', { showBoundaries: true })
    const pv = await layoutView(view)
    const inner = view.nodes.filter(n => n.role !== 'boundary').map(n => pv.nodes.get(n.id)!)
    const bottom = Math.max(...inner.map(b => b.y + b.h))
    const ids = view.nodes.filter(n => n.role === 'boundary').map(n => n.id)
    const boundaries = ids.map(id => pv.nodes.get(id)!)
    expect(boundaries.length).toBe(2)
    for (const b of boundaries) expect(b.y).toBeGreaterThan(bottom)
    expect(new Set(boundaries.map(b => b.y)).size).toBe(1)
    expect([...ids].sort((a, b) => pv.nodes.get(a)!.x - pv.nodes.get(b)!.x)).toEqual(ids)
    for (const e of view.edges.filter(isBoundaryEdge)) {
      expect(pv.edges.has(e.id)).toBe(false)
      const r = edgeRoute(pv, e)!
      expect(r.curve).toBeUndefined()
      expect(edgeRoute(pv, e)).toBe(r)
      r.points.slice(1).forEach((p, i) => expect(p.x === r.points[i].x || p.y === r.points[i].y).toBe(true))
      // 进入目标的最后一段自上而下
      const [p, q] = r.points.slice(-2)
      expect(q.y).toBe(pv.nodes.get(e.to)!.y)
      expect(p.y).toBeLessThan(q.y)
      // 除进出端口的首尾两段外，不穿过任何节点（含两端自身）；首尾两段不穿过两端以外的节点
      for (const [id, b] of pv.nodes) {
        r.points.slice(1).forEach((p2, i) => {
          if ((id === e.from || id === e.to) && (i === 0 || i === r.points.length - 2)) return
          const a = r.points[i]
          const hit = Math.max(a.x, p2.x) > b.x && Math.min(a.x, p2.x) < b.x + b.w && Math.max(a.y, p2.y) > b.y && Math.min(a.y, p2.y) < b.y + b.h
          expect(hit).toBe(false)
        })
      }
    }
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

  it('普通层次：参与者进 elk——用户在第一行、外部系统在最后一行，都在边界框外；边界框只包住内部模块', async () => {
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
    expect(pv.nodes.get('actor.biz')!.y).toBeGreaterThan(f.y + f.h)
    expect(pv.edges.get(view.edges.find(e => e.from === 'actor.biz')!.id)!.curve).toBeUndefined()
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

  it('同一对节点按类型的平行边都交给 elk，各有端口', () => {
    const { index: idx } = loadModel(sampleFiles({ 'z.yaml': 'relations: [{ id: x1, from: infra.player, to: app.solution, type: calls }]' }))
    const view = projectLevel(idx, 'infra', { showBoundaries: true })
    const pair = view.edges.filter(e => e.from === 'infra.player' && e.to === 'boundary:app')
    expect(pair.map(e => e.type).sort()).toEqual(['calls', 'depends'])
    const inner = { ...view, edges: [ve('p:calls', 'infra.player', 'infra.framework', 1), ve('p:depends', 'infra.player', 'infra.framework', 2, 'depends')] }
    expect(toElkGraph(inner).edges!.map(e => [e.id, e.labels![0].text])).toEqual([
      ['p:calls', ''],
      ['p:depends', '×2'],
    ])
  })
})

describe('边标签与终点（L10）', () => {
  // 取有两条以上直接边（交给 elk）的层次
  const view = ['sys', 'infra', 'infra.framework', 'app'].map(id => projectLevel(index, id)).find(v => toElkGraph(v).edges!.length >= 2)!

  it('每条直接边都申请至少放得下「?」/「×N」的标签槽', () => {
    for (const e of toElkGraph(view).edges!) {
      expect(e.labels![0].width).toBeGreaterThanOrEqual(LABEL_SLOT.w)
      expect(e.labels![0].height).toBe(LABEL_SLOT.h)
    }
  })

  it('elk 留在原点、离走线太远的标签坐标不用（画布按中点兜底），走线附近的照用', () => {
    const graph = toElkGraph(view)
    const [a, b] = graph.edges!
    const children = graph.children!.map((c, i) => ({ ...c, x: 300 + i * 260, y: 300 }))
    const sections = (y: number) => [{ id: 's', startPoint: { x: 400, y }, endPoint: { x: 400, y: y + 80 } }]
    const out = fromElkGraph(view, {
      ...graph,
      children,
      edges: [
        { ...a, sections: sections(400), labels: [{ ...a.labels![0], x: 0, y: 0 }] },
        { ...b, sections: sections(600), labels: [{ ...b.labels![0], x: 390, y: 630 }] },
      ],
    })
    expect(out.edges.get(a.id)!.label).toBeUndefined()
    expect(out.edges.get(b.id)!.label).toEqual({ x: 390 + b.labels![0].width! / 2, y: 630 + LABEL_SLOT.h / 2 })
  })

  it('平行边终点重合时沿目标节点边缘错开 PARALLEL_GAP，最后一段保持正交', () => {
    const edges = new Map<string, EdgeRoute>([
      [
        'p:calls',
        {
          points: [
            { x: 0, y: 0 },
            { x: 0, y: 40 },
            { x: 100, y: 40 },
            { x: 100, y: 80 },
          ],
        },
      ],
      [
        'p:depends',
        {
          points: [
            { x: 50, y: 0 },
            { x: 50, y: 30 },
            { x: 100, y: 30 },
            { x: 100, y: 80 },
          ],
        },
      ],
    ])
    const ve = (id: string): ViewEdge => ({ id, kind: 'direct', from: 'a', to: 'b', type: 'calls', relationIds: [], mode: 'sync' })
    spreadEnds([ve('p:calls'), ve('p:depends')], edges)
    const ends = [...edges.values()].map(r => r.points.slice(-2))
    expect(ends.map(([, e]) => e.x)).toEqual([100 - PARALLEL_GAP / 2, 100 + PARALLEL_GAP / 2])
    for (const [p, e] of ends) expect(p.x).toBe(e.x)
  })
})

describe('L11 端口方向', () => {
  const view = projectLevel(loadModel(scenarioFiles()).index, 'infra', { showBoundaries: true })
  const side = (g: ReturnType<typeof toElkGraph>, port: string) => {
    const owner = g.children!.find(c => c.ports?.some(p => p.id === port))!
    return owner.ports!.find(p => p.id === port)!.layoutOptions!['elk.port.side']
  }

  it('内部节点进边在上、出边在下（RIGHT：左进右出）；用户只朝下，边界节点与外部系统只朝上；端口固定边、各边各有端口', () => {
    const g = toElkGraph(view, 'DOWN')
    const inner = view.edges.find(
      e => !e.from.startsWith('boundary:') && !e.to.startsWith('boundary:') && !e.from.startsWith('actor.') && !e.to.startsWith('actor.'),
    )!
    expect([side(g, `${inner.id}#out`), side(g, `${inner.id}#in`)]).toEqual(['SOUTH', 'NORTH'])
    const r = toElkGraph(view, 'RIGHT')
    expect([side(r, `${inner.id}#out`), side(r, `${inner.id}#in`)]).toEqual(['EAST', 'WEST'])
    // 边界边不进 elk（按需走线）；边界节点的端口方向仍是朝上
    expect(g.edges!.some(e => e.id.includes('boundary:'))).toBe(false)
    expect(
      portSide(
        view.nodes.find(n => n.role === 'boundary')!,
        'in',
        'DOWN',
      ),
    ).toBe('NORTH')
    const fromUser = view.edges.find(e => e.from === 'actor.viewer')!
    expect(side(g, `${fromUser.id}#out`)).toBe('SOUTH')
    const fromBiz = view.edges.find(e => e.from === 'actor.biz')!
    expect(side(g, `${fromBiz.id}#out`)).toBe('NORTH')
    for (const c of g.children!) expect(c.layoutOptions!['elk.portConstraints']).toBe('FIXED_SIDE')
    const ports = g.children!.flatMap(c => c.ports!.map(p => p.id))
    expect(new Set(ports).size).toBe(view.edges.filter(e => !isBoundaryEdge(e)).length * 2)
  })

  it('用户第一行、边界节点与外部系统最后一行（层约束），最后一行按视图顺序给位置提示', () => {
    const g = toElkGraph(view, 'DOWN')
    const lc = (id: string) => g.children!.find(c => c.id === id)!.layoutOptions!['elk.layered.layering.layerConstraint']
    expect(lc('actor.viewer')).toBe('FIRST_SEPARATE')
    expect(lc('actor.biz')).toBe('LAST_SEPARATE')
    const bs = view.nodes.filter(n => n.role === 'boundary').map(n => n.id)
    for (const id of bs) expect(lc(id)).toBe('LAST_SEPARATE')
    expect(bs.map(id => g.children!.find(c => c.id === id)!.layoutOptions!['elk.position'])).toEqual(bs.map((_, i) => `(${i * 1000},0)`))
    expect(
      g.children!.find(c => c.id === view.nodes.find(n => n.role === 'module')!.id)?.layoutOptions?.['elk.layered.layering.layerConstraint'],
    ).toBeUndefined()
  })

  it('布局缓存键带布局算法版本；两级缓存——普通层次的边界边不进布局的键，走线按布局另行记忆', () => {
    expect(cacheKey(view)).toContain(LAYOUT_VERSION)
    const noBoundaryEdges = { ...view, edges: view.edges.filter(e => !isBoundaryEdge(e)) }
    expect(cacheKey(noBoundaryEdges)).toBe(cacheKey(view))
    expect(cacheKey({ ...view, edges: view.edges.slice(1) })).not.toBe(cacheKey(view))
  })
})
