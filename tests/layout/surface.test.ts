/**
 * 表面展开的输入（C6、L20②、L23）：展开触发（选中模块 / 束 / 交互、总是展开表面）、元素端口的并集与排序、端口封顶与「+N」、
 * 并集视图里散开的束换成元素级边（端口封顶外的合成一条接到节点本体）。纯函数。
 */
import { describe, expect, it } from 'vitest'
import type { InteractionBundle, LevelView, SurfaceElement } from '@/model'
import { DOTS, expandSurface, fanLevels, fanRoute, surfaceDots } from '../../src/layout/dots'
import {
  SURFACE_PORT_CAP,
  layoutExpansion,
  restEdgeId,
  spreadEdgeId,
  surfaceExpansion,
  unionView,
  type ElementLink,
  type PositionedView,
  type StructureLinks,
} from '../../src/layout/layout'

const view: LevelView = {
  mode: 'graph',
  parentId: 'p',
  nodes: [
    { id: 'a', moduleId: 'a', role: 'module' },
    { id: 'b', moduleId: 'b', role: 'module' },
    { id: 'c', moduleId: 'c', role: 'module' },
    { id: 'boundary:x', moduleId: 'x', role: 'boundary' },
  ],
  edges: [{ id: 'a->b:queries', kind: 'direct', from: 'a', to: 'b', type: 'queries', relationIds: ['r1', 'r2'], mode: 'sync' }],
} as unknown as LevelView

const el = (from: string, name: string | null, kind: ElementLink['kind'] = 'operation'): ElementLink => ({
  id: `el:${from}->b:use:${name ?? '!'}`,
  from,
  to: 'b',
  bundle: `bundle:${from}->b`,
  element: name,
  ...(name ? { kind } : {}),
})
const links = (elements: ElementLink[]): StructureLinks => ({
  edges: [
    { id: 'bundle:a->b', from: 'a', to: 'b' },
    { id: 'bundle:c->b', from: 'c', to: 'b' },
  ],
  elements,
})
const spread = (name: string): Map<string, InteractionBundle> =>
  new Map([
    [
      'a->b:queries',
      {
        items: [
          { relation: 'r1', element: { name, kind: 'port' } as SurfaceElement },
          { relation: 'r2', element: null },
        ],
        unnamed: 1,
      },
    ],
  ])

describe('surfaceExpansion', () => {
  it('没有选中、没开「总是展开」时不展开；分层总览不展开', () => {
    expect(surfaceExpansion({ view, selection: null, always: false, links: links([el('a', 'run')]), spreads: null })).toBeNull()
    expect(surfaceExpansion({ view: { ...view, mode: 'layered' }, selection: null, always: true, links: links([el('a', 'run')]), spreads: null })).toBeNull()
  })

  it('选中模块：全部依赖方 / 发起方；元素端口为元素级边与交互接到的并集，按种类再按名字', () => {
    const x = surfaceExpansion({
      view,
      selection: { kind: 'module', id: 'b' },
      always: false,
      links: links([el('a', 'run'), el('c', 'Item', 'type')]),
      spreads: spread('get'),
    })!
    expect(x.expand).toEqual([{ node: 'b', elements: ['get', 'run', 'Item'], from: null, ranked: ['get', 'Item', 'run'] }])
    expect(x.interactions).toEqual([{ edge: 'a->b:queries', elements: ['get'] }])
  })

  it('选中束不展开（T2-7：只聚焦与高亮）；选中交互：接收方、只散开发起方那一侧', () => {
    const l = links([el('a', 'run'), el('c', 'Item', 'type')])
    expect(surfaceExpansion({ view, selection: { kind: 'dep', id: 'c->b' }, always: false, links: l, spreads: null })).toBeNull()
    expect(surfaceExpansion({ view, selection: { kind: 'relation', id: 'r1' }, always: false, links: l, spreads: spread('get') })!.expand).toEqual([
      { node: 'b', elements: ['get', 'run'], from: ['a'], ranked: ['get', 'run'] },
    ])
  })

  it('端口封顶：多于 SURFACE_PORT_CAP 个元素时按接到它的节点数取前若干，其余计「+N」', () => {
    const many = Array.from({ length: SURFACE_PORT_CAP + 4 }, (_, i) => el('a', `e${String(i).padStart(2, '0')}`))
    const x = surfaceExpansion({ view, selection: { kind: 'module', id: 'b' }, always: false, links: links([...many, el('c', 'e19')]), spreads: null })!
    expect(x.expand[0].elements).toHaveLength(SURFACE_PORT_CAP)
    expect(x.expand[0].elements).toContain('e19')
    expect(x.expand[0].more).toBe(4)
  })

  it('L20b：元素端口先按所属子模块分组（子模块按声明顺序、本体在后），组内仍按种类再按名字；封顶照旧', () => {
    const sub: Record<string, { sub: string; rank: number }> = {
      run: { sub: 'b.run', rank: 0 },
      Freeze: { sub: 'b.meters', rank: 1 },
      Jitter: { sub: 'b.meters', rank: 1 },
      hold: { sub: 'b.timers', rank: 2 },
      Item: { sub: 'b.timers', rank: 2 },
    }
    const x = surfaceExpansion({
      view,
      selection: { kind: 'module', id: 'b' },
      always: false,
      links: links([el('a', 'hold'), el('a', 'Item', 'type'), el('a', 'Jitter'), el('c', 'Freeze'), el('c', 'body'), el('a', 'run')]),
      spreads: null,
      groupOf: (node, name) => (node === 'b' ? (sub[name] ?? null) : null),
    })!
    expect(x.expand[0].elements).toEqual(['run', 'Freeze', 'Jitter', 'hold', 'Item', 'body'])
    // 组号交给布局留组间距（ADR-0036），本体为 null
    expect(x.expand[0].groups).toEqual([0, 1, 1, 2, 2, null])
    // 不给 groupOf 时不分组（行为同前）
    const y = surfaceExpansion({ view, selection: { kind: 'module', id: 'b' }, always: false, links: links([el('a', 'hold'), el('a', 'run')]), spreads: null })!
    expect(y.expand[0].elements).toEqual(['hold', 'run'])
    expect(y.expand[0].groups).toBeUndefined()
  })
})

describe('unionView、expandSurface：散开的束（L20a②，ADR-0036）', () => {
  it('unionView 只并入收起态的束；expandSurface 在固定的节点上把散开的束换成接到点的元素级边，其余（端口外、越过入口）合成一条接到节点本体；交互束另加接到点的一段', () => {
    const l: StructureLinks = {
      ...links([el('a', 'run'), el('a', 'Other'), el('a', null), el('c', 'Item')]),
      expand: [{ node: 'b', elements: ['run', 'get'], from: ['a'] }],
      interactions: [{ edge: 'a->b:queries', elements: ['get'] }],
    }
    const u = unionView(view, l)
    expect(u.edges.map(e => e.id)).toEqual(['a->b:queries', 'bundle:a->b', 'bundle:c->b'])
    const exp = layoutExpansion(view, l)!
    expect([...exp.nodes]).toEqual([['b', ['run', 'get']]])
    expect(exp.targets.get('el:a->b:use:run')).toEqual({ node: 'b', element: 'run' })
    expect(exp.targets.get(spreadEdgeId('a->b:queries', 'get'))).toEqual({ node: 'b', element: 'get' })
    expect(exp.targets.has(restEdgeId('bundle:a->b'))).toBe(false)
    // 收起态：a 在上、b 在下，束与交互边都从 a 的底边进 b 的顶边
    const trunk = (x: number) => ({
      points: [
        { x, y: 76 },
        { x, y: 200 },
      ],
    })
    const base: PositionedView = {
      view,
      direction: 'DOWN',
      nodes: new Map([
        ['a', { x: 0, y: 0, w: 208, h: 76 }],
        ['b', { x: 0, y: 200, w: 208, h: 76 }],
        ['c', { x: 300, y: 0, w: 208, h: 76 }],
      ]),
      edges: new Map([
        ['a->b:queries', trunk(40)],
        ['bundle:a->b', trunk(60)],
        ['bundle:c->b', trunk(80)],
      ]),
      coreEdges: new Map(),
      ports: new Map(),
    }
    const pv = expandSurface(base, view, l)
    expect(pv.nodes).toBe(base.nodes)
    expect(pv.spread).toEqual(new Set(['bundle:a->b']))
    const dots = pv.elements!.get('b')!
    expect(dots.map(d => d.name)).toEqual(['run', 'get'])
    expect(dots.every(d => d.y === 200)).toBe(true)
    const route = pv.edges.get('el:a->b:use:run')!.points
    expect(route[0]).toEqual({ x: 60, y: 76 })
    expect(route[route.length - 1]).toEqual({ x: dots[0].x, y: 200 })
    expect(pv.edges.get(spreadEdgeId('a->b:queries', 'get'))!.points.at(-1)).toEqual({ x: dots[1].x, y: 200 })
    expect(pv.ports!.get('el:a->b:use:run#in')).toEqual({ x: dots[0].x, y: 200 })
    expect(pv.edges.get(restEdgeId('bundle:a->b'))).toEqual(trunk(60))
    // 两条干线各用一条扇出线：交互边（进点在左）离节点 10，束离节点 16
    expect(pv.edges.get(spreadEdgeId('a->b:queries', 'get'))!.points[1].y).toBe(200 - DOTS.fan)
    expect(route[1].y).toBe(200 - DOTS.fan - DOTS.fanStep)
    expect(expandSurface(base, view, links([]))).toBe(base)
  })
})

describe('surfaceDots、fanRoute：定尺寸点阵（L20a②、L20b）', () => {
  const box = { x: 100, y: 50, w: 208, h: 76 }
  const names = (n: number) => Array.from({ length: n }, (_, i) => `e${String(i).padStart(2, '0')}`)

  it('自上而下：点骑在顶边、点距 12、整排居中；组间多留 8', () => {
    const row = surfaceDots(box, 'DOWN', ['a', 'b', 'c'])
    expect(row.placed.map(p => p.y)).toEqual([50, 50, 50])
    expect(row.placed[1].x - row.placed[0].x).toBe(DOTS.pitch)
    expect((row.placed[0].x + row.placed[2].x) / 2).toBe(box.x + box.w / 2)
    const g = surfaceDots(box, 'DOWN', ['a', 'b', 'c'], [0, 0, null])
    expect(g.placed[2].x - g.placed[1].x).toBe(DOTS.pitch + DOTS.gap)
    expect(g.dropped).toEqual([])
  })

  it('SURFACE_PORT_CAP 个点在普通模块的顶边一排放得下，节点尺寸不变', () => {
    const row = surfaceDots(
      box,
      'DOWN',
      names(SURFACE_PORT_CAP),
      Array.from({ length: SURFACE_PORT_CAP }, (_, i) => (i < 12 ? i % 4 : null)),
    )
    expect(row.dropped).toEqual([])
    expect(Math.min(...row.placed.map(p => p.x))).toBeGreaterThanOrEqual(box.x + DOTS.pad)
    expect(Math.max(...row.placed.map(p => p.x))).toBeLessThanOrEqual(box.x + box.w - DOTS.pad)
  })

  it('自左向右：点骑在左边；放不下的按优先次序从末尾截掉（计入「+N」，行尾留位）', () => {
    const els = names(12)
    const ranked = [...els].reverse()
    const row = surfaceDots(box, 'RIGHT', els, undefined, ranked)
    expect(row.placed.every(p => p.x === box.x)).toBe(true)
    expect(row.dropped.length).toBeGreaterThan(0)
    // 截掉的是优先次序末尾的（e00 起）
    expect(row.dropped).toEqual(els.slice(0, row.dropped.length))
    expect(Math.max(...row.placed.map(p => p.y))).toBeLessThanOrEqual(box.y + box.h - DOTS.sidePad - DOTS.more)
  })

  it('fanRoute：沿干线到最后一段，在扇出线上横到点再垂直进点；自左向右同理', () => {
    const trunk = [
      { x: 10, y: 0 },
      { x: 10, y: 100 },
      { x: 60, y: 100 },
      { x: 60, y: 200 },
    ]
    expect(fanRoute(trunk, { x: 90, y: 200 }, 'DOWN', 1)).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 100 },
      { x: 60, y: 100 },
      { x: 60, y: 200 - DOTS.fan - DOTS.fanStep },
      { x: 90, y: 200 - DOTS.fan - DOTS.fanStep },
      { x: 90, y: 200 },
    ])
    const right = fanRoute(
      trunk.map(p => ({ x: p.y, y: p.x })),
      { x: 200, y: 90 },
      'RIGHT',
    )
    expect(right.slice(-3)).toEqual([
      { x: 200 - DOTS.fan, y: 60 },
      { x: 200 - DOTS.fan, y: 90 },
      { x: 200, y: 90 },
    ])
    // 最后一段太短：扇出线取它的中点，不越过它的起点
    expect(
      fanRoute(
        [
          { x: 0, y: 0 },
          { x: 0, y: 190 },
          { x: 60, y: 190 },
          { x: 60, y: 200 },
        ],
        { x: 80, y: 200 },
        'DOWN',
        3,
      )[3],
    ).toEqual({ x: 60, y: 195 })
  })
})

describe('fanLevels：扇出线次序（L20a②）', () => {
  it('取交叉最少的次序：不止按落点数——落点多但横跨另一条的那条放远更少交叉', () => {
    // B 从左边进、横跨到右边落三个点；A 在中间、落两个点。B 近时 A 的两条落线穿过 B 的扇出横线（2），A 近时只有 A 的进点竖线穿过 B 的（1）
    const a = { end: 50, drops: [52, 54] }
    const b = { end: 10, drops: [88, 90, 92] }
    expect(fanLevels([a, b])).toEqual([0, 1])
    // 互不相交时按落点数从多到少，落点多的靠近节点
    expect(
      fanLevels([
        { end: 0, drops: [5] },
        { end: 50, drops: [55, 60] },
      ]),
    ).toEqual([1, 0])
  })
})
