import { describe, expect, it } from 'vitest'
import { loadModel, projectLevel } from '../../src/model'
import type { Box } from '../../src/layout/geometry'
import {
  BAND,
  bandColumnsFor,
  PARALLEL_GAP,
  cacheKey,
  portSide,
  edgeRoute,
  isBoundaryEdge,
  isOutsideEdge,
  outsideRoutes,
  compassOf,
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
  RESERVED,
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
    const skip = pv.edges.get('infra->domain:queries')!
    expect(skip.points).toHaveLength(4)
    expect(skip.points[1].x).toBeGreaterThan(pv.nodes.get('infra')!.w)
  })

  it('同一空隙里的多条边横向错开', () => {
    const xs = ['infra->app:calls', 'infra->app:queries'].map(id => pv.edges.get(id)!.points[0].x)
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
    const lane = pv.edges.get('infra->domain:queries')!.points[1].x
    // 外框含父模块框（留 BAND.framePad，标题在框线上方）
    expect(b.x).toBe(-BAND.framePad)
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

describe('方位表示角色、框表示边界（A7、L4）', () => {
  const { index: idx } = loadModel(scenarioFiles())
  const inside = (b: Box, f: Box) => b.x >= f.x && b.y >= f.y && b.x + b.w <= f.x + f.w && b.y + b.h <= f.y + f.h
  const orthogonal = (pts: readonly { x: number; y: number }[]) => pts.slice(1).every((p, i) => p.x === pts[i].x || p.y === pts[i].y)

  it('分层总览：用户在系统框上方、外部系统在右侧通道之外；参与者的边正交走线，进核心模块时先到带间空隙中线', async () => {
    const view = projectLevel(idx, 'sys')
    const pv = await layoutView(view)
    const f = pv.frame!
    const viewer = pv.nodes.get('actor.viewer')!
    const biz = pv.nodes.get('actor.biz')!
    expect(viewer.y + viewer.h).toBeLessThan(f.y)
    expect(biz.x).toBeGreaterThan(f.x + f.w)
    for (const e of view.edges.filter(x => x.from.startsWith('actor'))) {
      const r = pv.edges.get(e.id)!
      expect(r.curve).toBeUndefined()
      expect(orthogonal(r.points)).toBe(true)
    }
    for (const e of (view.coreEdges ?? []).filter(x => x.from === 'actor.biz')) {
      const r = pv.coreEdges.get(e.id)!
      const target = pv.nodes.get(e.to)!
      const [p, q] = r.points.slice(-2)
      expect(q.y).toBe(target.y)
      // 横段不贴着带的边框：在目标带上沿之上至少半个带间空隙
      const band = [...pv.nodes.entries()].find(([id, b]) => view.bands!.some(x => x.layerId === id) && inside(target, b))![1]
      expect(p.y).toBeLessThanOrEqual(band.y - BAND.framePad / 2)
    }
  })

  it('普通层次：内部节点在父模块框内；边界节点在父模块框下方、系统框之内，按层次顺序；用户在系统框上方，外部系统在系统框右侧', async () => {
    const view = projectLevel(idx, 'infra', { showBoundaries: true })
    const pv = await layoutView(view)
    const pf = pv.parentFrame!
    const f = pv.frame!
    for (const n of view.nodes.filter(x => x.role === 'module')) expect(inside(pv.nodes.get(n.id)!, pf)).toBe(true)
    const bs = view.nodes.filter(n => n.role === 'boundary').map(n => n.id)
    expect(bs.length).toBeGreaterThan(0)
    for (const id of bs) {
      const b = pv.nodes.get(id)!
      expect(b.y).toBeGreaterThan(pf.y + pf.h)
      expect(inside(b, f)).toBe(true)
    }
    expect([...bs].sort((a, b) => pv.nodes.get(a)!.x - pv.nodes.get(b)!.x)).toEqual(bs)
    expect(inside(pf, f)).toBe(true)
    const viewer = pv.nodes.get('actor.viewer')!
    const biz = pv.nodes.get('actor.biz')!
    expect(viewer.y + viewer.h).toBeLessThan(f.y)
    expect(biz.x).toBeGreaterThan(f.x + f.w)
  })

  it('普通层次：框外元素的边不参与布局，按需正交走线——外部系统从左边进出、用户从底边出发、都从目标的入口侧进入', async () => {
    const view = projectLevel(idx, 'infra', { showBoundaries: true })
    const pv = await layoutView(view)
    for (const e of view.edges.filter(x => isOutsideEdge(view, x))) {
      expect(pv.edges.has(e.id)).toBe(false)
      const r = edgeRoute(pv, e)!
      expect(orthogonal(r.points)).toBe(true)
    }
    const fromBiz = edgeRoute(
      pv,
      view.edges.find(e => e.from === 'actor.biz')!,
    )!
    const biz = pv.nodes.get('actor.biz')!
    expect(fromBiz.points[0].x).toBe(biz.x)
    expect(fromBiz.points[1].x).toBeLessThan(biz.x)
    const fromViewer = edgeRoute(
      pv,
      view.edges.find(e => e.from === 'actor.viewer')!,
    )!
    const viewer = pv.nodes.get('actor.viewer')!
    expect(fromViewer.points[0].y).toBe(viewer.y + viewer.h)
  })

  it('L11：可见的框外边一起走线、分配轨道——任两条边没有共线且重叠的中间段，标签在各自的线上', async () => {
    const view = projectLevel(idx, 'infra', { showBoundaries: true })
    const pv = await layoutView(view)
    const visible = view.edges.filter(e => isOutsideEdge(view, e))
    const routes = outsideRoutes(pv, visible)
    expect(routes.size).toBe(visible.length)
    const segs = [...routes].flatMap(([id, r]) => r.points.slice(2, -1).map((b, i) => ({ id, a: r.points[i + 1], b })))
    for (const s1 of segs)
      for (const s2 of segs) {
        if (s1.id >= s2.id) continue
        const h = (s: typeof s1) => Math.abs(s.a.y - s.b.y) < 0.5
        if (h(s1) && h(s2) && Math.abs(s1.a.y - s2.a.y) < 0.5) {
          const [l1, r1] = [Math.min(s1.a.x, s1.b.x), Math.max(s1.a.x, s1.b.x)]
          const [l2, r2] = [Math.min(s2.a.x, s2.b.x), Math.max(s2.a.x, s2.b.x)]
          expect(l1 < r2 - 1 && l2 < r1 - 1).toBe(false)
        }
      }
    for (const r of routes.values()) expect(r.label).toBeDefined()
  })

  it('没有框外元素时没有系统框，只有父模块框', async () => {
    const pv = await layoutView(projectLevel(index, 'infra', { showBoundaries: false }))
    expect(pv.frame).toBeUndefined()
    expect(pv.parentFrame).toBeDefined()
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
    expect(edgeLabel(ve('a', 'x', 'y', 3, 'queries'))).toBe('×3')
  })

  it('线宽三档：1 / 2–4 / ≥5', () => {
    expect([1, 2, 4, 5, 12].map(n => edgeWeight(ve('a', 'x', 'y', n)))).toEqual([1, 2, 2, 3, 3])
  })

  it('同一对节点（不论方向）的多条边对称错开，单条为 0', () => {
    const o = parallelOffsets([ve('a', 'x', 'y', 1), ve('b', 'x', 'y', 1, 'queries'), ve('c', 'y', 'x', 1, 'notifies'), ve('d', 'x', 'z', 1)])
    expect([o.get('a'), o.get('b'), o.get('c'), o.get('d')]).toEqual([-PARALLEL_GAP, 0, PARALLEL_GAP, 0])
  })

  it('同一对节点按类型的平行边都交给 elk，各有端口', () => {
    const { index: idx } = loadModel(sampleFiles({ 'z.yaml': 'relations: [{ id: x1, from: infra.player, to: app.solution, type: calls }]' }))
    const view = projectLevel(idx, 'infra', { showBoundaries: true })
    const pair = view.edges.filter(e => e.from === 'infra.player' && e.to === 'boundary:app')
    expect(pair.map(e => e.type).sort()).toEqual(['calls', 'queries'])
    const inner = {
      ...view,
      edges: [ve('p:calls', 'infra.player', 'infra.framework', 1), ve('p:queries', 'infra.player', 'infra.framework', 2, 'queries')],
    }
    expect(toElkGraph(inner).edges!.map(e => [e.id, e.labels![0].text])).toEqual([
      ['p:calls', ''],
      ['p:queries', '×2'],
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
        'p:queries',
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
    spreadEnds([ve('p:calls'), ve('p:queries')], edges)
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

  it('elk 只排父模块框内的子模块与它们之间的边；进边在上、出边在下（RIGHT：左进右出）；端口固定边、各边各有端口', () => {
    const g = toElkGraph(view, 'DOWN')
    expect(g.children!.map(c => c.id).sort()).toEqual(
      view.nodes
        .filter(n => compassOf(n) === 'inner')
        .map(n => n.id)
        .sort(),
    )
    expect(
      g.edges!.every(
        e =>
          !isOutsideEdge(
            view,
            view.edges.find(x => x.id === e.id)!,
          ),
      ),
    ).toBe(true)
    const inner = view.edges.find(e => !isOutsideEdge(view, e))!
    expect([side(g, `${inner.id}#out`), side(g, `${inner.id}#in`)]).toEqual(['SOUTH', 'NORTH'])
    const r = toElkGraph(view, 'RIGHT')
    expect([side(r, `${inner.id}#out`), side(r, `${inner.id}#in`)]).toEqual(['EAST', 'WEST'])
    expect(portSide('in', 'DOWN')).toBe('NORTH')
    for (const c of g.children!) expect(c.layoutOptions!['elk.portConstraints']).toBe('FIXED_ORDER')
    // 内部边两端各一个端口；框外边在内部节点那一端只占位（不连线，与内部边一起排序）；每个内部节点另有一个保留端口（L13）
    const ports = g.children!.flatMap(c => c.ports!.map(p => p.id))
    const innerIds = new Set(g.children!.map(c => c.id))
    const placeholders = view.edges.filter(e => isOutsideEdge(view, e) && (innerIds.has(e.from) || innerIds.has(e.to)))
    expect(new Set(ports).size).toBe(g.edges!.length * 2 + placeholders.length + g.children!.length)
    // 顶边：保留端口（半边宽）排在最后——关系边的端口都在它左边（顶边的顺时针序即自左向右）
    for (const c of g.children!) {
      const north = c.ports!.filter(p => p.layoutOptions!['elk.port.side'] === 'NORTH')
      const reserved = north.find(p => p.id === `${c.id}${RESERVED}`)!
      expect(reserved.width).toBe(c.width! / 2)
      const idx = (p: (typeof north)[number]) => Number(p.layoutOptions!['elk.port.index'])
      for (const p of north) if (p !== reserved) expect(idx(p)).toBeLessThan(idx(reserved))
    }
    // RIGHT：左边，保留端口在下半（左边的顺时针序自下而上，序号最小）
    for (const c of r.children!) {
      const west = c.ports!.filter(p => p.layoutOptions!['elk.port.side'] === 'WEST')
      const reserved = west.find(p => p.id === `${c.id}${RESERVED}`)!
      expect(reserved.height).toBe(c.height! / 2)
      for (const p of west)
        if (p !== reserved) expect(Number(p.layoutOptions!['elk.port.index'])).toBeGreaterThan(Number(reserved.layoutOptions!['elk.port.index']))
    }
  })

  it('L11：关系全是交互，进边的进点都在入口侧的前半（顶边左半 / 左边上半），后半留给端口记号；框外边同一规则', async () => {
    const idx2 = loadModel(scenarioFiles()).index
    let checked = 0
    for (const level of ['infra', 'infra.framework', 'app']) {
      const v = projectLevel(idx2, level, { showBoundaries: true })
      const pv = await layoutView(v)
      const allocated = outsideRoutes(pv, v.edges)
      const route = (e: (typeof v.edges)[number]) => allocated.get(e.id) ?? pv.edges.get(e.id)
      for (const n of v.nodes.filter(x => compassOf(x) === 'inner')) {
        const box = pv.nodes.get(n.id)!
        for (const e of v.edges.filter(x => x.to === n.id && route(x))) {
          const end = route(e)!.points.at(-1)!
          // spreadEnds 平行错开最多半个 PARALLEL_GAP
          if (pv.direction === 'RIGHT') expect(end.y).toBeLessThanOrEqual(box.y + box.h / 2 + PARALLEL_GAP)
          else expect(end.x).toBeLessThanOrEqual(box.x + box.w / 2 + PARALLEL_GAP)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('方位：用户 top、外部系统 right、边界节点 bottom、其余 inner', () => {
    const of = (id: string) => compassOf(view.nodes.find(n => n.id === id)!)
    expect(of('actor.viewer')).toBe('top')
    expect(of('actor.biz')).toBe('right')
    expect(compassOf(view.nodes.find(n => n.role === 'boundary')!)).toBe('bottom')
    expect(compassOf(view.nodes.find(n => n.role === 'module')!)).toBe('inner')
  })

  it('布局缓存键带布局算法版本；框外边只在内部节点上占端口也进键（左动右静的排序随之变），它们的走线按布局与可见集另行记忆', () => {
    expect(cacheKey(view)).toContain(LAYOUT_VERSION)
    const innerOnly = { ...view, edges: view.edges.filter(e => !isOutsideEdge(view, e)) }
    expect(cacheKey(innerOnly)).not.toBe(cacheKey(view))
    expect(cacheKey({ ...view })).toBe(cacheKey(view))
  })
})
