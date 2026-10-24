/**
 * 草图布局（state.layout.sketch，X15、X19、F-22，ADR-0025）：位置取 layout，没有时网格布局一次（需初始布局）、缺的放到不重叠的空位；
 * 引用节点由关系派生；同一对节点的多条直线平移错开；直线裁到两端节点的边框。
 */
import { describe, expect, it } from 'vitest'
import { ROOT_BAND_COLS, ROOT_BAND_PAD, ROOT_BAND_ROW, ROOT_BAND_X0 } from '../../src/model'
import {
  bandAt,
  bandRelative,
  outsideCenter,
  referenceColumns,
  sketchPositions,
  sketchScene,
  straightEdge,
  SKETCH_BAND,
  SKETCH_CANVAS,
  SKETCH_CENTER_PAD,
  SKETCH_COLUMN,
  SKETCH_FRAME_PAD,
  SKETCH_PARALLEL_GAP,
  SKETCH_NODE,
  SKETCH_REF,
  type SketchScene,
} from '../../src/layout/sketch'
import type { SketchDef } from '../../src/model'

const DEF: SketchDef = {
  id: 'd',
  mount: 'core.a',
  modules: [
    { id: 'core.a.x', name: 'X', core: true },
    { id: 'core.a.y', name: 'Y' },
  ],
  relations: [
    { id: 'r1', from: 'core.a.x', to: 'core.a.y', type: 'calls' },
    { id: 'r2', from: 'core.a.y', to: 'core.a.x', type: 'notifies' },
    { id: 'r3', from: 'core.a.x', to: 'core.b', type: 'calls', description: '外部' },
  ],
}

/** 画布上的节点（不含框线） */
const shown = (s: SketchScene) => s.nodes.filter(n => n.data.kind !== 'frame')
const node = (s: SketchScene, id: string) => s.nodes.find(n => n.id === id)!

describe('草图布局', () => {
  it('没有 layout：网格布局一次、标为需初始布局；节点为本层模块与由关系派生的引用节点', () => {
    const s = sketchScene({ def: DEF, nameOf: id => (id === 'core.b' ? 'B' : undefined), deeper: id => id === 'core.a.x' })
    expect(s.needsLayout).toBe(true)
    expect(shown(s).map(n => [n.id, n.data.kind, n.data.name])).toEqual([
      ['core.a.x', 'module', 'X'],
      ['core.a.y', 'module', 'Y'],
      ['core.b', 'reference', 'B'],
    ])
    expect(node(s, 'core.a.x').data).toMatchObject({ core: true, deeper: true })
    expect(s.count).toBe(2)
  })

  it('有 layout：位置照用（相对中心区的内容原点，X22）；缺的放到网格里不与已有节点重叠的位置', () => {
    const def: SketchDef = { ...DEF, layout: { modules: { 'core.a.x': { x: 260, y: 40 } } } }
    const s = sketchScene({ def, nameOf: () => undefined })
    expect(s.needsLayout).toBe(false)
    expect(node(s, 'core.a.x').position).toEqual({ x: s.origin.x + 260, y: s.origin.y + 40 })
    const pos = sketchPositions(def, ['core.a.x', 'core.a.y'])
    for (const [a, b] of [['core.a.x', 'core.a.y']])
      expect(Math.abs(pos[a].x - pos[b].x) >= SKETCH_NODE.w || Math.abs(pos[a].y - pos[b].y) >= SKETCH_NODE.h).toBe(true)
  })

  it('同一对节点的多条线平移错开（反向的线也分开）；标签位置取 layout.relations；选中、待重连与变更角标', () => {
    const def: SketchDef = { ...DEF, layout: { relations: { r1: { label: { x: 7, y: 8 } } } } }
    const s = sketchScene({ def, nameOf: () => undefined, selected: new Set(['r2']), pending: ['r3'], changes: new Map([['core.a.y', 'added' as const]]) })
    const [r1, r2, r3] = s.edges
    // 两条线（方向相反）画出来的位置：各自按自己的方向平移，结果错开一个间距
    const box = { w: 100, h: 50 }
    const a = { x: 0, y: 0 }
    const b = { x: 400, y: 0 }
    const y1 = straightEdge(a, b, box, box, r1.data.offset).mid.y
    const y2 = straightEdge(b, a, box, box, r2.data.offset).mid.y
    expect(Math.abs(y1 - y2)).toBe(SKETCH_PARALLEL_GAP)
    expect(r3.data.offset).toBe(0)
    expect(r1.data.label).toEqual({ x: 7, y: 8 })
    expect([r2.data.selected, r3.data.pending]).toEqual([true, true])
    expect(s.nodes.find(n => n.id === 'core.a.y')!.data.change).toBe('added')
  })

  it('直线裁到两端节点的边框，平移垂直于连线', () => {
    const e = straightEdge({ x: 0, y: 0 }, { x: 400, y: 0 }, { w: 100, h: 50 }, { w: 100, h: 50 })
    expect(e.from).toEqual({ x: 50, y: 0 })
    expect(e.to).toEqual({ x: 350, y: 0 })
    const o = straightEdge({ x: 0, y: 0 }, { x: 400, y: 0 }, { w: 100, h: 50 }, { w: 100, h: 50 }, 10)
    expect([o.from.y, o.to.y, o.mid.x]).toEqual([10, 10, 200])
  })

  it('05 裁决 4：外部端点折叠显示，同一对（本层模块、折叠节点）同方向的多条关系合成一条显示边并带全部关系；旧草图里记下的引用坐标不用（X22）', () => {
    const def: SketchDef = {
      id: 'd',
      mount: 'core.a',
      modules: [
        { id: 'core.a.x', name: 'X' },
        { id: 'core.a.y', name: 'Y' },
      ],
      relations: [
        { id: 'r1', from: 'core.a.x', to: 'access.w.s', type: 'calls' },
        { id: 'r2', from: 'core.a.x', to: 'access.w.t', type: 'implements' },
        { id: 'r3', from: 'access.w.s', to: 'core.a.x', type: 'notifies' },
        { id: 'r4', from: 'core.a.y', to: 'access.r', type: 'calls', description: '读' },
      ],
      layout: { modules: { 'access.w.s': { x: 900, y: 90 } } },
    }
    const s = sketchScene({ def, nameOf: () => undefined, selected: new Set(['access.w']) })
    expect(s.nodes.filter(n => n.data.kind === 'reference').map(n => [n.id, n.data.relations, n.data.members])).toEqual([
      ['access.w', 3, ['access.w.s', 'access.w.t']],
      ['access.r', 1, undefined],
    ])
    expect(node(s, 'access.w').position).not.toEqual({ x: 900, y: 90 })
    const agg = s.edges.find(e => e.source === 'core.a.x' && e.target === 'access.w')!
    expect(agg.id).toBe('agg:core.a.x>access.w')
    expect(agg.data).toMatchObject({ relationIds: ['r1', 'r2'], reference: 'access.w', type: 'mixed', label: null })
    expect(s.edges.find(e => e.source === 'access.w')!.id).toBe('r3')
    expect(s.edges.find(e => e.target === 'access.r')!.data.description).toBe('读')
  })

  it('X21 根草图：层画成横向带（按 order），第二级模块在所属带内，位置取 layout（y 相对带顶，只记 x 的旧草图取第一行）；带头标模块数与超七', () => {
    const kids = Array.from({ length: 8 }, (_, i) => ({ id: `b.m${i}`, name: `M${i}` }))
    const def: SketchDef = {
      id: 'd',
      mount: 'root',
      modules: [
        { id: 'b', name: 'B', kind: 'layer', order: 2, children: kids },
        { id: 'a', name: 'A', kind: 'layer', order: 1, abstraction: '上层', children: [{ id: 'a.x', name: 'X' }] },
      ],
      layout: { modules: { 'a.x': { x: 600 } } },
    }
    const s = sketchScene({ def, nameOf: () => undefined })
    expect(s.bands.map(b => b.id)).toEqual(['a', 'b'])
    const [ba, bb] = s.bands
    const ax = s.nodes.find(n => n.id === 'a.x')!
    expect(ax.position).toEqual({ x: 600, y: ba.y + (SKETCH_BAND.h - SKETCH_NODE.h) / 2 })
    expect(s.nodes.find(n => n.id === 'b.m0')!.position.y).toBe(bb.y + (SKETCH_BAND.h - SKETCH_NODE.h) / 2)
    const la = s.nodes.find(n => n.id === 'a')!.data
    expect(la).toMatchObject({ kind: 'layer', abstraction: '上层', count: 1 })
    expect(s.nodes.find(n => n.id === 'b')!.data).toMatchObject({ count: 8, over: true })
    expect(bandAt(s.bands, bb.y + 5)).toBe('b')
    expect(bandAt(s.bands, ba.y + ba.h + SKETCH_BAND.gap / 2)).toBeNull()
    // 带内不重叠：没记位置的按带内网格找空位（ROOT_BAND_COLS 列，多了折行）
    const ps = kids.map(k => s.nodes.find(n => n.id === k.id)!.position)
    expect(new Set(ps.map(p => `${p.x},${p.y}`)).size).toBe(ps.length)
  })

  it('X21（T2b 裁决 3）：带内换行——没记位置的按列数折行，带高随内容增长、下面的带往下推；layout 的 y 相对带顶', () => {
    const kids = Array.from({ length: ROOT_BAND_COLS + 2 }, (_, i) => ({ id: `a.m${i}`, name: `M${i}` }))
    const def: SketchDef = {
      id: 'd',
      mount: 'root',
      modules: [
        { id: 'a', name: 'A', kind: 'layer', order: 1, children: kids },
        { id: 'b', name: 'B', kind: 'layer', order: 2, children: [{ id: 'b.x', name: 'X' }] },
      ],
      layout: { modules: { 'b.x': { x: 300, y: 200 } } },
    }
    const s = sketchScene({ def, nameOf: () => undefined })
    const [ba, bb] = s.bands
    const pos = (id: string) => s.nodes.find(n => n.id === id)!.position
    expect(pos(`a.m${ROOT_BAND_COLS}`)).toEqual({ x: ROOT_BAND_X0, y: ba.y + ROOT_BAND_PAD + ROOT_BAND_ROW })
    expect(ba.h).toBeGreaterThan(SKETCH_BAND.h)
    expect(ba.h).toBe(ROOT_BAND_PAD + ROOT_BAND_ROW + SKETCH_NODE.h + ROOT_BAND_PAD)
    expect(bb.y).toBe(ba.y + ba.h + SKETCH_BAND.gap)
    expect(pos('b.x')).toEqual({ x: 300, y: bb.y + 200 })
    expect(bb.h).toBe(200 + SKETCH_NODE.h + ROOT_BAND_PAD)
    // 画布位置换回 layout：y 相对所属带顶（移入时按目标带），不小于 0；层原样
    expect(bandRelative(def, { 'b.x': { x: 310.4, y: bb.y + 90 } })).toEqual({ 'b.x': { x: 310, y: 90 } })
    expect(bandRelative(def, { 'a.m0': { x: 0, y: bb.y + 5 } }, () => 'b')).toEqual({ 'a.m0': { x: 0, y: 5 } })
    expect(bandRelative(def, { 'b.x': { x: 0, y: bb.y - 30 } })['b.x'].y).toBe(0)
    expect(bandRelative({ ...def, mount: 'a' }, { 'a.m0': { x: 1, y: 2 } })).toEqual({ 'a.m0': { x: 1, y: 2 } })
  })
})

describe('X22 引用按规则排布的边界', () => {
  const LAYERS = [
    { id: 'present', name: '呈现层' },
    { id: 'state', name: '视图状态层' },
    { id: 'access', name: '接入层' },
    { id: 'model', name: '模型层' },
  ]
  const layerOf = (id: string) => (LAYERS.some(l => l.id === id.split('.')[0]) ? id.split('.')[0] : undefined)
  const DESK: SketchDef = {
    id: 'd',
    mount: 'state.desk',
    modules: [
      { id: 'state.desk.edit', name: '编辑' },
      { id: 'state.desk.run', name: '运行' },
    ],
    relations: [
      { id: 'r1', from: 'present.sketch', to: 'state.desk.edit', type: 'calls' },
      { id: 'r2', from: 'state.desk.edit', to: 'model.intent', type: 'calls' },
      { id: 'r3', from: 'state.desk.run', to: 'access.reader', type: 'calls' },
      { id: 'r4', from: 'state.desk.run', to: 'state.layout', type: 'calls' },
      { id: 'r5', from: 'dev', to: 'state.desk.edit', type: 'calls' },
    ],
  }
  const scene = (extra: Partial<Parameters<typeof sketchScene>[0]> = {}) =>
    sketchScene({ def: DESK, nameOf: () => undefined, layers: LAYERS, layerOf, system: '架构台', mountName: 'DeskState', ...extra })

  it('引用按所属层的 order 从左到右成列：靠前的层在左，同层紧贴中心区右侧标「同层」，靠后的在右，不在任何层的在最右「外部」', () => {
    const cols = referenceColumns(['model.intent', 'state.layout', 'present.sketch', 'access.reader', 'dev'], 'state', LAYERS, layerOf)
    expect(cols.map(c => [c.id, c.side, c.tag])).toEqual([
      ['present', 'left', undefined],
      ['state', 'right', '同层'],
      ['access', 'right', undefined],
      ['model', 'right', undefined],
      ['other', 'right', undefined],
    ])
    expect(cols.find(c => c.id === 'other')!.name).toBe('外部')
    const s = scene()
    const x = (id: string) => node(s, id).position.x
    expect(x('present.sketch')).toBeLessThan(s.center!.x)
    for (const id of ['state.layout', 'access.reader', 'model.intent', 'dev']) expect(x(id)).toBeGreaterThan(s.center!.x + s.center!.w)
    expect(x('state.layout')).toBeLessThan(x('access.reader'))
    expect(x('access.reader')).toBeLessThan(x('model.intent'))
    expect(x('model.intent')).toBeLessThan(x('dev'))
  })

  it('框线：最外的系统框（项目名）、中心区带挂载点名、每列带层名；本层模块都在中心区里', () => {
    const s = scene()
    const frames = s.nodes.filter(n => n.data.kind === 'frame')
    expect(frames.map(f => [f.data.frame, f.data.name, f.data.tag])).toEqual([
      ['system', '架构台', undefined],
      ['center', 'DeskState', undefined],
      ['column', '呈现层', undefined],
      ['column', '视图状态层', '同层'],
      ['column', '接入层', undefined],
      ['column', '模型层', undefined],
      ['column', '外部', undefined],
    ])
    const c = s.center!
    for (const m of s.nodes.filter(n => n.data.kind === 'module')) {
      expect(m.position.x).toBeGreaterThanOrEqual(c.x)
      expect(m.position.x + m.data.w).toBeLessThanOrEqual(c.x + c.w)
    }
  })

  it('中心区可用宽度 = 画布宽 − 两侧引用列宽；隐藏外部引用时不画引用与引用线，中心区占满画布宽，可用宽度重新算', () => {
    const s = scene()
    const step = SKETCH_COLUMN.w + SKETCH_COLUMN.gap
    expect(s.center!.w).toBe(SKETCH_CANVAS.w - 2 * SKETCH_FRAME_PAD - 5 * step)
    expect(s.gridArea!.w).toBe(s.center!.w - 2 * SKETCH_CENTER_PAD)
    const h = scene({ hideReferences: true })
    expect(h.nodes.some(n => n.data.kind === 'reference' || n.data.frame === 'column')).toBe(false)
    expect(h.edges.some(e => e.data.external)).toBe(false)
    expect(h.columns).toEqual([])
    expect(h.center!.w).toBe(SKETCH_CANVAS.w - 2 * SKETCH_FRAME_PAD)
    expect(h.gridArea!.w).toBeGreaterThan(s.gridArea!.w)
    // 没有 layout：初始布局按可用宽度排——隐藏后一行放得下两个
    const ys = h.nodes.filter(n => n.data.kind === 'module').map(n => n.position.y)
    expect(new Set(ys).size).toBe(1)
  })

  it('引用节点紧凑（高度约为模块一半）；列高放不下时整列按比例缩小、不换列', () => {
    const s = scene()
    expect(node(s, 'present.sketch').data).toMatchObject({ kind: 'reference', w: SKETCH_REF.w, h: SKETCH_REF.h, scale: 1, side: 'left' })
    expect(SKETCH_REF.h * 2).toBeLessThanOrEqual(SKETCH_NODE.h)
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `rx${i}`, from: 'state.desk.edit', to: `model.m${i}`, type: 'calls' as const }))
    const t = sketchScene({ def: { ...DESK, relations: many }, nameOf: () => undefined, layers: LAYERS, layerOf })
    const refs = t.nodes.filter(n => n.data.kind === 'reference')
    expect(new Set(refs.map(n => n.position.x)).size).toBe(1)
    const k = refs[0].data.scale!
    expect(k).toBeLessThan(1)
    expect(refs[0].data.h).toBeCloseTo(SKETCH_REF.h * k)
    const col = t.nodes.find(n => n.data.frame === 'column')!
    const bottom = Math.max(...refs.map(n => n.position.y + n.data.h))
    expect(bottom).toBeLessThanOrEqual(col.position.y + col.data.h)
  })

  it('引用线标出引用在哪一侧与哪一端（模块从朝向引用列的端口进出）；本层之间的线不标', () => {
    const s = scene()
    const e = (id: string) => s.edges.find(x => x.id === id)!.data
    expect([e('r1').external, e('r1').refEnd]).toEqual(['left', 'source'])
    expect([e('r2').external, e('r2').refEnd]).toEqual(['right', 'target'])
    expect([e('r4').external, e('r4').refEnd]).toEqual(['right', 'target'])
  })

  it('拖出中心区（挂载点框）的落点 = 升级的落点；根草图没有中心区', () => {
    const s = scene()
    const c = s.center!
    expect(outsideCenter(s, { x: c.x + 10, y: c.y + 10 })).toBe(false)
    expect(outsideCenter(s, { x: c.x - 5, y: c.y + 10 })).toBe(true)
    expect(outsideCenter(s, { x: c.x + c.w + 5, y: c.y + 10 })).toBe(true)
    expect(outsideCenter(s, { x: c.x + 10, y: c.y + c.h + 5 })).toBe(true)
    expect(outsideCenter({ center: null }, { x: -1e4, y: -1e4 })).toBe(false)
  })

  it('列内按相连的本层模块的平均高度排（线少交叉）', () => {
    const def: SketchDef = {
      ...DESK,
      relations: [
        { id: 'a', from: 'state.desk.edit', to: 'model.b', type: 'calls' },
        { id: 'b', from: 'state.desk.run', to: 'model.a', type: 'calls' },
      ],
      layout: { modules: { 'state.desk.edit': { x: 0, y: 300 }, 'state.desk.run': { x: 0, y: 0 } } },
    }
    const s = sketchScene({ def, nameOf: () => undefined, layers: LAYERS, layerOf })
    expect(node(s, 'model.a').position.y).toBeLessThan(node(s, 'model.b').position.y)
  })
})
