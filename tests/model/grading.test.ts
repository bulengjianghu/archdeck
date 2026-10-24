/** 任意层次的模块分级（ADR-0027）：核心、普通、共用件——投影（O2、O4、O8–O11）、布局（共用件架）与画布场景（角标、计数、按需画线） */
import { describe, expect, it } from 'vitest'
import { loadModel, projectLevel, shelfOf, viewNodeOf, type RawFile } from '../../src/model'
import { layoutView } from '../../src/layout/layout'
import { canvasScene, type CanvasInput } from '../../src/layout/canvas'
import { levelCounts } from '../../src/layout/canvas/nodes'

const normals = Array.from({ length: 9 }, (_, i) => `p.n${i + 1}`)
const files = (extra = ''): RawFile[] => [
  { path: 'system.yaml', text: 'system: { id: sys, name: S }' },
  {
    path: 'modules/m.yaml',
    text: `modules:
  - id: l
    name: L
    kind: layer
    order: 1
    children:
      - id: p
        name: P
        role: core
        children:
          - { id: p.c1, name: C1, role: core }
          - { id: p.c2, name: C2, role: core }
${normals.map(id => `          - { id: ${id}, name: ${id.toUpperCase()} }`).join('\n')}
          - { id: p.labels, name: Labels, role: shared }
          - { id: p.bus, name: Bus, role: bus }
      - { id: q, name: Q }
      - { id: u, name: Util, role: shared }
  - { id: m, name: M, kind: layer, order: 2 }
relations:
  - { id: r1, from: p.c1, to: p.c2, type: calls }
  - { id: r2, from: p.n1, to: p.c1, type: calls }
  - { id: r3, from: p.n2, to: p.n3, type: calls }
  - { id: r4, from: p.c1, to: p.labels, type: calls }
  - { id: r5, from: p.n4, to: p.labels, type: calls }
  - { id: r6, from: p.c2, to: p.bus, type: calls }
  - { id: r7, from: p.c1, to: p.bus, type: calls }
  - { id: r8, from: p.labels, to: q, type: calls }
  - { id: r9, from: p.n5, to: p.c2, type: calls }
  - { id: r10, from: p.c1, to: u, type: calls }
  - { id: r11, from: q, to: u, type: calls }
${extra}`,
  },
]
const { index } = loadModel(files())

describe('O8 普通层次的折叠', () => {
  it('有核心模块、普通模块超过 7 个：全部折叠成一个「+N」占位，核心照常；与它们相连的边并到占位上（L5），两端都折叠的不画', () => {
    const v = projectLevel(index, 'p')
    expect(v.mode).toBe('graph')
    expect(v.nodes.filter(n => n.role !== 'shared' && n.role !== 'boundary').map(n => [n.id, n.role, n.core ?? false])).toEqual([
      ['p.c1', 'module', true],
      ['p.c2', 'module', true],
      ['more:p', 'more', false],
    ])
    expect(v.fold).toEqual({ id: 'more:p', members: normals, expanded: false })
    expect(v.nodes.find(n => n.id === 'more:p')).toMatchObject({ hiddenCount: 9, expanded: 0 })
    expect(v.edges.map(e => `${e.id}:${e.relationIds.join(',')}:${e.kind}`).sort()).toEqual([
      'more:p->p.c1:calls:r2:aggregate',
      'more:p->p.c2:calls:r9:aggregate',
      'p.c1->boundary:u:calls:r10:direct',
      'p.c1->p.c2:calls:r1:direct',
    ])
    expect(viewNodeOf(v, 'p.n3')).toBe('more:p')
    expect(viewNodeOf(v, 'p.c1')).toBe('p.c1')
  })

  it('单击临时展开（与 O6 同一个 expandedBands，键为父模块）：普通模块露出，占位变为「收起 N 个」', () => {
    const v = projectLevel(index, 'p', { showBoundaries: true, expandedBands: ['p'] })
    expect(v.nodes.filter(n => n.role === 'module').map(n => n.id)).toEqual(['p.c1', 'p.c2', ...normals])
    expect(v.nodes.find(n => n.id === 'more:p')).toMatchObject({ hiddenCount: 0, expanded: 9 })
    expect(v.fold).toEqual({ id: 'more:p', members: [], expanded: true })
    expect(v.alias).toBeUndefined()
  })

  it('本层没有核心模块时不折叠，只给提示数（议：T0 裁决 5）；不超过 7 个时既不折叠也不提示', () => {
    const flat = loadModel(files().map(f => (f.path === 'modules/m.yaml' ? { ...f, text: f.text.replace(/role: core\n/g, '\n').replace(/, role: core/g, '') } : f))).index
    const v = projectLevel(flat, 'p')
    expect(v.fold).toBeUndefined()
    expect(v.foldHint).toBe(11)
    expect(v.nodes.filter(n => n.role === 'module')).toHaveLength(11)
    expect(projectLevel(index, 'l').foldHint).toBeUndefined()
  })
})

describe('O9、O10 共用件架与「共用 ×N」', () => {
  it('共用件（shared 与 bus）作 shared 节点收进架，不进 edges；它们与本层节点的边进 shelfEdges；使用者带共用件个数', () => {
    const v = projectLevel(index, 'p')
    expect(v.shelf).toEqual(['p.labels', 'p.bus'])
    expect(v.nodes.filter(n => n.role === 'shared').map(n => n.id)).toEqual(['p.labels', 'p.bus'])
    expect(v.edges.some(e => e.from === 'p.labels' || e.to === 'p.labels' || e.to === 'p.bus')).toBe(false)
    expect(v.shelfEdges!.map(e => e.id).sort()).toEqual([
      'more:p->p.labels:calls',
      'p.c1->p.bus:calls',
      'p.c1->p.labels:calls',
      'p.c2->p.bus:calls',
      'p.labels->boundary:q:calls',
    ])
    expect(Object.fromEntries(v.nodes.filter(n => n.sharedCount).map(n => [n.id, n.sharedCount]))).toEqual({ 'p.c1': 2, 'p.c2': 1, 'more:p': 1, 'boundary:q': 1 })
    expect([...shelfOf(v)]).toEqual(['p.labels', 'p.bus'])
  })

  it('分层总览：共用件进该层带底的架，不计入 hiddenCount；核心与共用件之间（跨层或同层）的边进 shelfEdges，共用件与自己所在的带之间不画', () => {
    const v = projectLevel(index, 'sys')
    const l = v.bands!.find(b => b.layerId === 'l')!
    expect([l.coreModuleIds, l.shelf, l.hiddenCount]).toEqual([['p'], ['u'], 1])
    expect(v.nodes.find(n => n.id === 'u')).toMatchObject({ role: 'shared', layerId: 'l' })
    expect(v.shelfEdges!.map(e => e.id)).toEqual(['p->u:calls'])
    expect(v.nodes.find(n => n.id === 'p')!.sharedCount).toBe(1)
    // O6：临时展开不把共用件当普通模块露出
    const ex = projectLevel(index, 'sys', { showBoundaries: true, expandedBands: ['l'] }).bands!.find(b => b.layerId === 'l')!
    expect([ex.coreModuleIds, ex.shelf, ex.expanded]).toEqual([['p', 'q'], ['u'], 1])
  })
})

const input = async (level: string, extra: Partial<CanvasInput> = {}): Promise<CanvasInput> => ({
  positioned: await layoutView(projectLevel(index, level)),
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
  ...extra,
})

describe('布局与画布：共用件架、计数与按需画线', () => {
  it('普通层次：共用件不参与 elk，在父模块框底部一行，框包住它；核心是大块', async () => {
    const pv = await layoutView(projectLevel(index, 'p'))
    const frame = pv.parentFrame!
    const shelf = ['p.labels', 'p.bus'].map(id => pv.nodes.get(id)!)
    const inner = ['p.c1', 'p.c2', 'more:p'].map(id => pv.nodes.get(id)!)
    expect(new Set(shelf.map(b => b.y)).size).toBe(1)
    for (const b of shelf) {
      expect(b.y).toBeGreaterThan(Math.max(...inner.map(x => x.y + x.h)))
      expect(b.x).toBeGreaterThanOrEqual(frame.x)
      expect(b.y + b.h).toBeLessThanOrEqual(frame.y + frame.h)
    }
    expect(pv.nodes.get('p.c1')!.w).toBeGreaterThan(pv.nodes.get('more:p')!.w - 1)
    expect(pv.shelf).toBeDefined()
  })

  it('分层总览：共用件在带内底部，带随之加高', async () => {
    const pv = await layoutView(projectLevel(index, 'sys'))
    const band = pv.nodes.get('l')!
    const u = pv.nodes.get('u')!
    expect(u.y + u.h).toBeLessThanOrEqual(band.y + band.h)
    expect(u.y).toBeGreaterThan(pv.nodes.get('p')!.y + pv.nodes.get('p')!.h)
  })

  it('O11：本层框常驻「共用件 N · 折叠 M」（展开时 M 为 0）；共用件的边默认不画，悬停使用者或共用件时画；O10 角标与 O8 占位进节点数据', async () => {
    const s = canvasScene(await input('p'))
    const frame = s.nodes.find(n => n.id === 'frame:parent')!
    expect(frame.data.counts).toEqual({ shared: 2, folded: 9 })
    expect(frame.data.shelfAt).toBeGreaterThan(0)
    expect(s.nodes.find(n => n.id === 'p.labels')!.type).toBe('shared')
    expect(s.nodes.find(n => n.id === 'p.c1')!.data).toMatchObject({ core: true, sharedCount: 2 })
    expect(s.nodes.find(n => n.id === 'more:p')!.data).toMatchObject({ graphFold: true, hiddenCount: 9 })
    expect(s.edges.some(e => e.data.shelf)).toBe(false)
    const hovered = canvasScene(await input('p', { hover: 'p.c1' }))
    expect(hovered.edges.filter(e => e.data.shelf).map(e => e.id).sort()).toEqual(['p.c1->p.bus:calls', 'p.c1->p.labels:calls'])
    const onShelf = canvasScene(await input('p', { hover: 'p.labels' }))
    expect(onShelf.edges.filter(e => e.data.shelf).map(e => e.id).sort()).toEqual(['more:p->p.labels:calls', 'p.c1->p.labels:calls', 'p.labels->boundary:q:calls'])
    const expanded = await layoutView(projectLevel(index, 'p', { showBoundaries: true, expandedBands: ['p'] }))
    expect(levelCounts(expanded)).toEqual({ shared: 2, folded: 0 })
    const band = canvasScene(await input('sys')).nodes.find(n => n.id === 'l')!
    expect(band.data.counts).toEqual({ shared: 1, folded: 1 })
  })
})
