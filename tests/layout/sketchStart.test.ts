/**
 * 草图画布的起点与走线（第二十一轮波 2，T2.5；X15 修订、DL-29、DL-30）：起点借模型画布同一层的位置并投影到中心区；
 * 本层之间的线与模型画布同一套正交走线（节点位置取草图的、避开节点、同对错开）；已有 layout 的草图不借起点。
 */
import { describe, expect, it } from 'vitest'
import type { SketchDef } from '../../src/model'
import { projectSeed, sketchPositions, sketchScene, SKETCH_NODE } from '../../src/layout/layout'
import { sketchRoutes } from '../../src/layout/sketchRoutes'

const def = (extra: Partial<SketchDef> = {}): SketchDef => ({
  id: 'd1',
  mount: 'p',
  modules: [
    { id: 'p.a', name: 'A' },
    { id: 'p.b', name: 'B' },
    { id: 'p.c', name: 'C' },
  ],
  relations: [
    { id: 'r1', from: 'p.a', to: 'p.c', type: 'queries' },
    { id: 'r2', from: 'p.a', to: 'p.b', type: 'queries' },
    { id: 'r3', from: 'p.a', to: 'p.b', type: 'commands' },
  ],
  ...extra,
})
const seed = { 'p.a': { x: 300, y: 100 }, 'p.b': { x: 100, y: 300 }, 'p.c': { x: 500, y: 300 } }

describe('DL-30 起点投影', () => {
  it('平移到原点后整块在可用区域里居中，相对位置不变', () => {
    const p = projectSeed(seed, ['p.a', 'p.b', 'p.c'], { w: 1000, h: 600 })
    const w = 400 + SKETCH_NODE.w
    const h = 200 + SKETCH_NODE.h
    expect(p['p.b']).toEqual({ x: Math.round((1000 - w) / 2), y: Math.round((600 - h) / 2) + 200 })
    expect(p['p.a'].x - p['p.b'].x).toBe(200)
    expect(p['p.c'].y - p['p.a'].y).toBe(200)
  })
  it('没有 layout 的草图用起点；模型画布没有的模块退回网格；已有 layout 的不借', () => {
    const ids = ['p.a', 'p.b', 'p.c']
    const shown = sketchPositions(def(), ids, { w: 1000, h: 600 }, seed)
    expect(shown['p.a'].x - shown['p.b'].x).toBe(200)
    const partial = sketchPositions(def(), ids, { w: 1000, h: 600 }, { 'p.a': seed['p.a'] })
    expect(partial['p.b']).toBeDefined()
    const laid = def({ layout: { modules: { 'p.a': { x: 7, y: 9 }, 'p.b': { x: 400, y: 9 }, 'p.c': { x: 7, y: 300 } } } })
    expect(sketchPositions(laid, ids, { w: 1000, h: 600 }, seed)['p.a']).toEqual({ x: 7, y: 9 })
  })
})

describe('DL-29 走线与模型画布同一套', () => {
  const scene = sketchScene({
    def: def({ layout: { modules: { 'p.a': { x: 300, y: 0 }, 'p.b': { x: 0, y: 200 }, 'p.c': { x: 600, y: 0 } } } }),
    nameOf: () => undefined,
  })
  const routes = sketchRoutes(scene)
  it('每条本层之间的线都是正交折线（每段水平或竖直）', () => {
    expect(routes.size).toBe(3)
    for (const pts of routes.values())
      for (let i = 1; i < pts.length; i++) expect(Math.abs(pts[i].x - pts[i - 1].x) < 0.5 || Math.abs(pts[i].y - pts[i - 1].y) < 0.5).toBe(true)
    expect(scene.edges.every(e => e.data.route?.length)).toBe(true)
  })
  it('上下错开得开走上下边，同一行走左右边', () => {
    const a = scene.nodes.find(n => n.id === 'p.a')!
    const toB = routes.get('r2')!
    expect(toB[0].y).toBeCloseTo(a.position.y + a.data.h)
    const toC = routes.get('r1')!
    expect(toC[0].x).toBeCloseTo(a.position.x + a.data.w)
  })
  it('同一对的两条线各走一条，不重合', () => {
    expect(JSON.stringify(routes.get('r2'))).not.toBe(JSON.stringify(routes.get('r3')))
    expect(routes.get('r2')![0].x).not.toBe(routes.get('r3')![0].x)
  })
  it('线不穿过别的节点', () => {
    const boxes = scene.nodes.filter(n => n.data.kind === 'module')
    for (const [id, pts] of routes) {
      const e = scene.edges.find(x => x.id === id)!
      for (const b of boxes.filter(n => n.id !== e.source && n.id !== e.target))
        for (let i = 1; i < pts.length; i++) {
          const [p, q] = [pts[i - 1], pts[i]]
          const x1 = Math.min(p.x, q.x)
          const x2 = Math.max(p.x, q.x)
          const y1 = Math.min(p.y, q.y)
          const y2 = Math.max(p.y, q.y)
          const hit = x2 > b.position.x && x1 < b.position.x + b.data.w && y2 > b.position.y && y1 < b.position.y + b.data.h
          expect(hit, `${id} 穿过 ${b.id}`).toBe(false)
        }
    }
  })
})
