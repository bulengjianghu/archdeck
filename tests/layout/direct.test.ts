/**
 * L15 结构边的直连走线（第七轮 T4）：两端节点边缘之间的直线，同一对节点的各条平行错开，双向分在两侧；
 * 分层总览带间为竖直直线，按带对铺开。
 */
import { describe, expect, it } from 'vitest'
import { DIRECT_GAP, directRoute, directRoutes, rimPoint, type Box, type PositionedView } from '../../src/layout/layout'

const A: Box = { x: 0, y: 0, w: 100, h: 50 }
const B: Box = { x: 300, y: 200, w: 100, h: 50 }

const pv = (nodes: Record<string, Box>): PositionedView =>
  ({
    view: { mode: 'graph', nodes: [], edges: [] },
    nodes: new Map(Object.entries(nodes)),
    edges: new Map(),
    coreEdges: new Map(),
  }) as unknown as PositionedView

describe('rimPoint', () => {
  it('盒内一点朝外的射线落在盒子边缘', () => {
    expect(rimPoint(A, { x: 50, y: 25 }, { x: 250, y: 25 })).toEqual({ x: 100, y: 25 })
    expect(rimPoint(A, { x: 50, y: 25 }, { x: 50, y: -100 })).toEqual({ x: 50, y: 0 })
  })
})

describe('directRoute / directRoutes', () => {
  it('两点直线，起点在起点节点边缘、终点在终点节点边缘，标签在中点', () => {
    const r = directRoute(A, B)
    expect(r.curve).toBeUndefined()
    expect(r.points).toHaveLength(2)
    const [s, t] = r.points
    expect(s.x === 100 || s.y === 50).toBe(true)
    expect(t.x === 300 || t.y === 200).toBe(true)
    expect(r.label).toEqual({ x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 })
  })

  it('穿过中间的节点不绕行（仍是两点直线）', () => {
    const r = directRoutes(pv({ a: A, b: B, mid: { x: 150, y: 100, w: 100, h: 50 } }), [{ id: 'e', from: 'a', to: 'b' }])
    expect(r.get('e')!.points).toHaveLength(2)
  })

  it('双向两条分在中线两侧、互相平行；同方向多种类再错开', () => {
    const r = directRoutes(pv({ a: A, b: B }), [
      { id: 'dependency:a->b', from: 'a', to: 'b' },
      { id: 'dependency:b->a', from: 'b', to: 'a' },
    ])
    const ab = r.get('dependency:a->b')!.points
    const ba = r.get('dependency:b->a')!.points
    // 中线：两中心的连线；两条在法向上的投影符号相反、相距 DIRECT_GAP
    const n = { x: -(225 - 25), y: 350 - 50 }
    const len = Math.hypot(n.x, n.y)
    const side = (p: { x: number; y: number }) => ((p.x - 50) * n.x + (p.y - 25) * n.y) / len
    expect(Math.sign(side(ab[0]))).toBe(-Math.sign(side(ba[1])))
    expect(Math.abs(side(ab[0]) - side(ba[1]))).toBeCloseTo(DIRECT_GAP, 5)
    const three = directRoutes(pv({ a: A, b: B }), [
      { id: 'assembly:a->b', from: 'a', to: 'b' },
      { id: 'dependency:a->b', from: 'a', to: 'b' },
      { id: 'dependency:b->a', from: 'b', to: 'a' },
    ])
    const keys = [...three.values()].map(x => JSON.stringify(x.points))
    expect(new Set(keys).size).toBe(3)
  })
})
