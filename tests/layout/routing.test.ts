/** 跳线（L11）：水平段跳过竖直段；同一对节点的边、曲线、端点附近的交叉不跳；路径在跳点处插半圆小桥 */
import { describe, expect, it } from 'vitest'
import { JUMP_MARGIN, JUMP_RADIUS, allocateTracks, jumpsOf, placeLabels } from '../../src/layout/routing'
import { roundedPolyline } from '../../src/components/edges/routePath'

const h = (id: string, y: number, x1: number, x2: number, pair = id) => ({
  id,
  pair,
  points: [
    { x: x1, y },
    { x: x2, y },
  ],
})
const v = (id: string, x: number, y1: number, y2: number, pair = id) => ({
  id,
  pair,
  points: [
    { x, y: y1 },
    { x, y: y2 },
  ],
})

describe('jumpsOf', () => {
  it('水平段在与竖直段的交叉处跳，竖直段不跳', () => {
    const j = jumpsOf([h('a', 50, 0, 200), v('b', 100, 0, 100)])
    expect(j.get('a')).toEqual([{ x: 100, y: 50 }])
    expect(j.has('b')).toBe(false)
  })

  it('同一对节点之间的边互不算交叉；离线段端点太近的不跳；只碰到端点的不算', () => {
    expect(jumpsOf([h('a', 50, 0, 200, 'p'), v('b', 100, 0, 100, 'p')]).size).toBe(0)
    expect(jumpsOf([h('a', 50, 0, 200), v('b', JUMP_MARGIN - 1, 0, 100)]).size).toBe(0)
    expect(jumpsOf([h('a', 50, 0, 200), v('b', 100, 50, 100)]).size).toBe(0)
  })

  it('跳点按沿线方向排序，从右往左的线由大到小', () => {
    const j = jumpsOf([h('a', 50, 200, 0), v('b', 60, 0, 100), v('c', 140, 0, 100)])
    expect(j.get('a')!.map(p => p.x)).toEqual([140, 60])
  })
})

describe('roundedPolyline 的小桥', () => {
  it('从左往右在跳点处插向上的半圆（sweep 1），从右往左 sweep 0', () => {
    expect(
      roundedPolyline(
        [
          { x: 0, y: 50 },
          { x: 200, y: 50 },
        ],
        8,
        [{ x: 100, y: 50 }],
      ),
    ).toBe(`M0,50 L${100 - JUMP_RADIUS},50 a${JUMP_RADIUS},${JUMP_RADIUS} 0 0 1 ${2 * JUMP_RADIUS},0 L200,50`)
    expect(
      roundedPolyline(
        [
          { x: 200, y: 50 },
          { x: 0, y: 50 },
        ],
        8,
        [{ x: 100, y: 50 }],
      ),
    ).toContain(`L${100 + JUMP_RADIUS},50 a${JUMP_RADIUS},${JUMP_RADIUS} 0 0 0 ${-2 * JUMP_RADIUS},0`)
    expect(
      roundedPolyline([
        { x: 0, y: 50 },
        { x: 200, y: 50 },
      ]),
    ).toBe('M0,50 L200,50')
  })
})

describe('allocateTracks 与 placeLabels（L11：可见的框外边各占一条轨道）', () => {
  const a = {
    id: 'a',
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 200, y: 50 },
      { x: 200, y: 120 },
    ],
  }
  const b = {
    id: 'b',
    points: [
      { x: 10, y: 0 },
      { x: 10, y: 50 },
      { x: 190, y: 50 },
      { x: 190, y: 120 },
    ],
  }

  it('同一走廊里重合的横段按 ID 错开 gap，首末段（端口与进节点前的直段）不动', () => {
    const t = allocateTracks([b, a], 10)
    const ya = t.get('a')![1].y
    const yb = t.get('b')![1].y
    expect(Math.abs(ya - yb)).toBe(10)
    expect(t.get('a')![0]).toEqual(a.points[0])
    expect(t.get('a')![3]).toEqual(a.points[3])
    expect(allocateTracks([a, b], 10)).toEqual(t)
  })

  it('不重合的线不动', () => {
    const c = {
      id: 'c',
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 80 },
        { x: 200, y: 80 },
        { x: 200, y: 120 },
      ],
    }
    expect(allocateTracks([a, c], 10).get('c')).toEqual(c.points)
  })

  it('标签沿各自的线放，互不相碰', () => {
    const t = allocateTracks([a, b], 10)
    const labels = placeLabels([...t].map(([id, points]) => ({ id, points })))
    const [la, lb] = [labels.get('a')!, labels.get('b')!]
    expect(Math.abs(la.x - lb.x) >= 28 || Math.abs(la.y - lb.y) >= 20).toBe(true)
  })
})
