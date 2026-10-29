/** 按依赖分层的布局与层带（L28、L29，ADR-0038）：层号展开为 elk 的层、布局后层序不交叠、层带与环组框、画布的层带节点 */
import { describe, expect, it } from 'vitest'
import { loadModel, projectLevel } from '../../src/model'
import { cacheKey, elkLayers, layoutView, tierGeometry, toElkGraph, type LayoutTiers } from '../../src/layout/layout'
import { canvasScene, type CanvasInput } from '../../src/layout/canvas'

// 八个子模块：a 依赖 b、b 依赖 c、d、e、f 依赖 c；交互边 c → a（向上）、d → e（同层）
const MODEL = `
modules:
  - id: p
    name: P
    responsibility: 父
    children:
${['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(x => `      - { id: p.${x}, name: ${x.toUpperCase()}, responsibility: ${x} }`).join('\n')}
relations:
  - { id: r1, from: p.a, to: p.b, type: commands }
  - { id: r2, from: p.b, to: p.c, type: commands }
  - { id: r3, from: p.c, to: p.a, type: notifies }
  - { id: r4, from: p.d, to: p.e, type: commands }
  - { id: r5, from: p.f, to: p.c, type: queries }
  - { id: r6, from: p.g, to: p.h, type: commands }
`
const { index } = loadModel([
  { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
  { path: 'modules/p.yaml', text: MODEL },
])
const view = projectLevel(index, 'p', { showBoundaries: true, expandedBands: ['p'] })
const TIERS: LayoutTiers = {
  tier: { 'p.a': 0, 'p.d': 0, 'p.e': 0, 'p.f': 1, 'p.b': 1, 'p.c': 2 },
  count: 3,
  groups: [{ id: 1, nodes: ['p.d', 'p.e'] }],
  isolated: ['p.g', 'p.h'],
  banded: true,
}

describe('L28 elkLayers', () => {
  it('层号逐层展开；同层有边相连的错开为子层；孤立的单列且不与同层节点相连', () => {
    const ids = view.nodes.map(n => n.id)
    const edges = view.edges.map(e => [e.from, e.to] as const)
    const l = elkLayers(ids, edges, TIERS)
    // 第 0 层：a、d 在子层 0，e 与 d 相连错开到子层 1
    expect(l.get('p.a')).toBe(0)
    expect(l.get('p.d')).toBe(0)
    expect(l.get('p.e')).toBe(1)
    expect(l.get('p.b')).toBe(2)
    expect(l.get('p.f')).toBe(2)
    expect(l.get('p.c')).toBe(3)
    // 孤立的 g、h 从顶上逐个往下放，g → h 相连不同层
    expect(l.get('p.g')).toBe(0)
    expect(l.get('p.h')).toBe(1)
    for (const [a, b] of edges) expect(l.get(a)).not.toBe(l.get(b))
  })

  it('全部没有层号时排成网格（不按交互另排）', () => {
    const ids = ['x1', 'x2', 'x3', 'x4']
    const l = elkLayers(ids, [], { tier: {}, count: 0, groups: [], isolated: ids, banded: false })
    expect([...l.values()].sort()).toEqual([0, 0, 1, 1])
  })

  it('toElkGraph：分层时用 INTERACTIVE、按层给坐标、不交标签、不拆连通分量', () => {
    const g = toElkGraph(view, 'DOWN', TIERS)
    expect(g.layoutOptions!['elk.layered.layering.strategy']).toBe('INTERACTIVE')
    expect(g.layoutOptions!['elk.separateConnectedComponents']).toBe('false')
    expect(g.edges!.every(e => !e.labels)).toBe(true)
    const y = (id: string) => g.children!.find(c => c.id === id)!.y!
    expect(y('p.a')).toBeLessThan(y('p.b'))
    expect(y('p.b')).toBeLessThan(y('p.c'))
    // 不分层时同原来
    expect(toElkGraph(view).layoutOptions!['elk.layered.layering.strategy']).toBeUndefined()
  })

  it('布局结果层序不交叠：上一层的底在下一层的顶之上；分层进缓存键', async () => {
    const pv = await layoutView(view, {}, { edges: [], tiers: TIERS })
    const b = (id: string) => pv.nodes.get(id)!
    expect(b('p.a').y + b('p.a').h).toBeLessThan(b('p.b').y)
    expect(b('p.b').y + b('p.b').h).toBeLessThan(b('p.c').y)
    expect(b('p.f').y).toBe(b('p.b').y)
    expect(pv.direction).toBe('DOWN')
    expect(cacheKey(view, {}, { edges: [], tiers: TIERS })).not.toBe(cacheKey(view, {}, { edges: [] }))
  })
})

describe('L29 层带与环组框', () => {
  it('banded 时每层一条横跨父模块框的带、相邻不重叠；环组框包住成员', async () => {
    const pv = await layoutView(view, {}, { edges: [], tiers: TIERS })
    const t = pv.tiers!
    expect(t.bands.map(x => x.tier)).toEqual([0, 1, 2])
    for (let i = 1; i < t.bands.length; i++) expect(t.bands[i - 1].box.y + t.bands[i - 1].box.h).toBeLessThanOrEqual(t.bands[i].box.y + 0.001)
    expect(new Set(t.bands.map(x => x.box.w)).size).toBe(1)
    // 画出的环组框不压住别的节点
    for (const g of t.groups)
      for (const [id, n] of pv.nodes)
        if (!['p.d', 'p.e'].includes(id))
          expect(n.x + n.w <= g.box.x || n.x >= g.box.x + g.box.w || n.y + n.h <= g.box.y || n.y >= g.box.y + g.box.h).toBe(true)
  })

  it('环组框包住错开成子层的成员', () => {
    const nodes = new Map([
      ['d', { x: 0, y: 0, w: 10, h: 10 }],
      ['e', { x: 30, y: 40, w: 10, h: 10 }],
    ])
    const g = tierGeometry(nodes, { tier: { d: 0, e: 0 }, count: 1, groups: [{ id: 3, nodes: ['d', 'e'] }], isolated: [], banded: false }, undefined, 28)
    expect(g.groups).toEqual([{ id: 3, box: { x: -10, y: -10, w: 60, h: 70 } }])
  })

  it('不 banded 时不画层带；组框压住别的节点时不画', () => {
    const nodes = new Map([
      ['a', { x: 0, y: 0, w: 10, h: 10 }],
      ['b', { x: 40, y: 0, w: 10, h: 10 }],
      ['c', { x: 20, y: 0, w: 10, h: 10 }],
    ])
    const g = tierGeometry(nodes, { tier: { a: 0, b: 0, c: 0 }, count: 1, groups: [{ id: 2, nodes: ['a', 'b'] }], isolated: [], banded: false }, undefined, 28)
    expect(g.bands).toEqual([])
    expect(g.groups).toEqual([])
  })

  it('画布：结构 / 交互视角出层带节点（第 1 层写入口、最下写被依赖），运行视角不出', async () => {
    const positioned = await layoutView(view, {}, { edges: [], tiers: TIERS })
    const input: CanvasInput = {
      positioned,
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
    const tiers = canvasScene(input).nodes.filter(n => n.type === 'tier')
    expect(tiers.filter(n => n.data.tierBand?.kind === 'band').map(n => n.data.tierBand?.label)).toEqual(['深度 1 · 入口', '深度 2', '深度 3 · 被依赖'])
    expect(tiers.every(n => n.zIndex < 0 && !n.selectable && n.style.pointerEvents === 'none')).toBe(true)
    // 运行视角（有舞台）不画
    expect(
      canvasScene({
        ...input,
        stage: { active: new Set(), walked: new Map(), current: null, temps: [], previews: [], hiddenCurrent: false } as never,
      }).nodes.some(n => n.type === 'tier'),
    ).toBe(false)
  })
})

describe('L30：层号文字避开节点与线', () => {
  const geom = { bands: [{ tier: 0, box: { x: 0, y: 0, w: 400, h: 100 } }], groups: [] }
  it('左端被线穿过时沿上沿往右挪到第一处空位；没有障碍时留在左端', async () => {
    const { placeTierLabels, tierTextBoxes } = await import('../../src/layout/layout')
    expect(placeTierLabels(geom, new Map(), []).bands[0].labelX ?? 10).toBe(10)
    const line = [
      { x: 30, y: -50 },
      { x: 30, y: 80 },
    ]
    const moved = placeTierLabels(geom, new Map(), [line])
    expect(moved.bands[0].labelX).toBeGreaterThan(30)
    const [box] = tierTextBoxes(moved)
    expect(box.x).toBeGreaterThan(30)
  })
})
