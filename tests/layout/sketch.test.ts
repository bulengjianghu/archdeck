/**
 * 草图布局（state.layout.sketch，X15、X19、F-22，ADR-0025）：位置取 layout，没有时网格布局一次（需初始布局）、缺的放到不重叠的空位；
 * 引用节点由关系派生；同一对节点的多条直线平移错开；直线裁到两端节点的边框。
 */
import { describe, expect, it } from 'vitest'
import { sketchPositions, sketchScene, straightEdge, SKETCH_PARALLEL_GAP, SKETCH_NODE } from '../../src/layout/sketch'
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
})
