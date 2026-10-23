/**
 * 草图布局（state.layout.sketch，X15、X19、F-22，ADR-0025）：位置取 layout，没有时网格布局一次（需初始布局）、缺的放到不重叠的空位；
 * 引用节点由关系派生；同一对节点的多条直线平移错开；直线裁到两端节点的边框。
 */
import { describe, expect, it } from 'vitest'
import { bandAt, sketchPositions, sketchScene, straightEdge, SKETCH_BAND, SKETCH_PARALLEL_GAP, SKETCH_NODE } from '../../src/layout/sketch'
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

describe('草图布局', () => {
  it('没有 layout：网格布局一次、标为需初始布局；节点为本层模块与由关系派生的引用节点', () => {
    const s = sketchScene({ def: DEF, nameOf: id => (id === 'core.b' ? 'B' : undefined), deeper: id => id === 'core.a.x' })
    expect(s.needsLayout).toBe(true)
    expect(s.nodes.map(n => [n.id, n.data.kind, n.data.name])).toEqual([
      ['core.a.x', 'module', 'X'],
      ['core.a.y', 'module', 'Y'],
      ['core.b', 'reference', 'B'],
    ])
    expect(s.nodes[0].data).toMatchObject({ core: true, deeper: true })
    expect(s.count).toBe(2)
  })

  it('有 layout：位置照用；缺的放到网格里不与已有节点重叠的位置', () => {
    const def: SketchDef = { ...DEF, layout: { modules: { 'core.a.x': { x: 260, y: 40 } } } }
    const s = sketchScene({ def, nameOf: () => undefined })
    expect(s.needsLayout).toBe(false)
    expect(s.nodes[0].position).toEqual({ x: 260, y: 40 })
    const pos = sketchPositions(def, ['core.a.x', 'core.a.y', 'core.b'])
    for (const [a, b] of [
      ['core.a.x', 'core.a.y'],
      ['core.a.x', 'core.b'],
      ['core.a.y', 'core.b'],
    ])
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

  it('05 裁决 4：外部端点折叠显示，同一对（本层模块、折叠节点）同方向的多条关系合成一条显示边并带全部关系；折叠节点的位置可取精确端点记下的', () => {
    const def: SketchDef = {
      id: 'd',
      mount: 'core.a',
      modules: [
        { id: 'core.a.x', name: 'X' },
        { id: 'core.a.y', name: 'Y' },
      ],
      relations: [
        { id: 'r1', from: 'core.a.x', to: 'access.w.s', type: 'calls' },
        { id: 'r2', from: 'core.a.x', to: 'access.w.t', type: 'depends' },
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
    expect(s.nodes.find(n => n.id === 'access.w')!.position).toEqual({ x: 900, y: 90 })
    const agg = s.edges.find(e => e.source === 'core.a.x' && e.target === 'access.w')!
    expect(agg.id).toBe('agg:core.a.x>access.w')
    expect(agg.data).toMatchObject({ relationIds: ['r1', 'r2'], reference: 'access.w', type: 'mixed', label: null })
    expect(s.edges.find(e => e.source === 'access.w')!.id).toBe('r3')
    expect(s.edges.find(e => e.target === 'access.r')!.data.description).toBe('读')
  })

  it('X21 根草图：层画成横向带（按 order），第二级模块在所属带内，x 取 layout、y 由带算；带头标模块数与超七', () => {
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
    // 带内不重叠：没记位置的往右找空位
    const xs = kids.map(k => s.nodes.find(n => n.id === k.id)!.position.x)
    expect(new Set(xs).size).toBe(xs.length)
  })
})
