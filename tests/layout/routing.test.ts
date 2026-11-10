/** 跳线（L11）：水平段跳过竖直段；同一对节点的边、曲线、端点附近的交叉不跳；路径在跳点处插半圆小桥 */
import { describe, expect, it } from 'vitest'
import { BusyLines, JUMP_MARGIN, JUMP_RADIUS, allocateTracks, clampStub, detour, frameLines, jumpsOf, placeLabelBoxes } from '../../src/layout/routing'
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

  it('L33：标签按实际尺寸沿各自的线放，互不相碰，也不压障碍', () => {
    const t = allocateTracks([a, b], 10)
    const size = { w: 70, h: 18 }
    const obstacle = { x: 60, y: 40, w: 80, h: 30 }
    const labels = placeLabelBoxes(
      [...t].map(([id, points]) => ({ id, points, size })),
      { obstacles: [obstacle] },
    )
    const box = (p: { x: number; y: number }) => ({ x: p.x - 35, y: p.y - 9, w: 70, h: 18 })
    const hit = (p: { x: number; y: number; w: number; h: number }, q: typeof p) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h
    const [la, lb] = [box(labels.get('a')!), box(labels.get('b')!)]
    expect(hit(la, lb)).toBe(false)
    expect(hit(la, obstacle) || hit(lb, obstacle)).toBe(false)
  })

  it('L33：together 为假的两条（不会同时画出）可以放在同一处', () => {
    const size = { w: 70, h: 18 }
    const labels = placeLabelBoxes(
      [
        { id: 'a', points: a.points, size },
        { id: 'b', points: a.points, size },
      ],
      { together: () => false },
    )
    expect(labels.get('a')).toEqual(labels.get('b'))
  })
})

describe('L32 走廊分轨', () => {
  const a = {
    id: 'a',
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 200, y: 50 },
      { x: 200, y: 120 },
    ],
  }
  it('相距不到一个轨距（不止同一坐标）的平行段也分开', () => {
    const b = { id: 'b', points: a.points.map((p, i) => (i === 1 || i === 2 ? { ...p, y: 54 } : { ...p, x: p.x + 20 })) }
    const t = allocateTracks([a, b], 10)
    expect(Math.abs(t.get('a')![1].y - t.get('b')![1].y)).toBeGreaterThanOrEqual(10)
  })

  it('fixed 的线只占不动：分轨的线让开它；框线（frameLines）也一样', () => {
    const fixed = {
      id: 'f',
      points: [
        { x: -50, y: 50 },
        { x: 250, y: 50 },
      ],
    }
    const t = allocateTracks([a], 10, { fixed: [fixed] })
    expect(Math.abs(t.get('a')![1].y - 50)).toBeGreaterThanOrEqual(10)
    const frame = frameLines([{ x: -100, y: 48, w: 400, h: 200 }])
    expect(Math.abs(allocateTracks([a], 10, { fixed: frame }).get('a')![1].y - 48)).toBeGreaterThanOrEqual(10)
  })

  it('挪动后不穿过障碍：往下一格会碰到节点时往上让', () => {
    const fixed = {
      id: 'f',
      points: [
        { x: -50, y: 50 },
        { x: 250, y: 50 },
      ],
    }
    const node = { x: 50, y: 55, w: 60, h: 40 }
    const t = allocateTracks([a], 10, { fixed: [fixed], obstacles: [node] })
    expect(t.get('a')![1].y).toBeLessThan(50)
  })

  it('clampStub：短桩不伸进对面的节点', () => {
    const p = clampStub({ x: 50, y: 100, dir: -1, stub: 38 }, [{ x: 0, y: 0, w: 100, h: 80 }])
    expect(p.stub).toBe(14)
    expect(clampStub({ x: 50, y: 100, dir: -1, stub: 10 }, [{ x: 0, y: 0, w: 100, h: 80 }]).stub).toBe(10)
  })

  it('detour：竖直通道已有线时改走旁边的通道', () => {
    const from = { x: 0, y: 0, dir: 1 as const }
    const to = { x: 200, y: 200, dir: -1 as const }
    const channel = (pts: { x: number; y: number }[]) => pts.find((p, i) => i > 0 && p.x === pts[i - 1].x && Math.abs(p.y - pts[i - 1].y) > 100)!.x
    const free = channel(detour(from, to, []))
    const busy = new BusyLines()
    for (let i = 0; i < 4; i++)
      busy.add([
        { x: free, y: -100 },
        { x: free, y: 400 },
      ])
    expect(channel(detour(from, to, [], busy))).not.toBe(free)
  })
})
