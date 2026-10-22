/** 跳线（L11）：水平段跳过竖直段；同一对节点的边、曲线、端点附近的交叉不跳；路径在跳点处插半圆小桥 */
import { describe, expect, it } from 'vitest'
import { JUMP_MARGIN, JUMP_RADIUS, jumpsOf } from '../../src/layout/routing'
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
