/**
 * L26（ADR-0037）：选中只聚焦一跳、悬停叠加——结构视角与交互视角同义；影响面查询（K15b）与边聚焦（L21④）生效时悬停照常叠加。
 * fixture 同 bundleDesk：core 层 impl → api、impl → util、util → api、api → log、impl → log（值使用）、util → log（只引类型，收起）。
 */
import { describe, expect, it } from 'vitest'
import { openDesk, sceneOf, settle } from './bundleDesk'

type Scene = Awaited<ReturnType<typeof sceneOf>>['scene']
const node = (s: Scene, id: string) => s.nodes.find(n => n.id === id)!
const bundle = (s: Scene, from: string, to: string) => s.edges.find(e => e.type === 'dep' && e.id === `bundle:${from}->${to}`)!
const route = (s: Scene, from: string, to: string) => s.edges.find(e => e.type !== 'dep' && e.source === from && e.target === to)!

describe('L26 选中只聚焦一跳', () => {
  it('结构视角选中模块：它与两个方向的直接边、邻居照常，其余变淡；不投影闭包', async () => {
    const desk = await openDesk()
    desk.select({ kind: 'module', id: 'core.util' })
    await settle(desk)
    const { scene: s } = await sceneOf(desk)
    expect(bundle(s, 'core.impl', 'core.util').data.dim).toBe(false)
    expect(bundle(s, 'core.util', 'core.api').data.dim).toBe(false)
    expect(bundle(s, 'core.impl', 'core.api').data.dim).toBe(true)
    expect(bundle(s, 'core.api', 'core.log').data.dim).toBe(true)
    expect(['core.util', 'core.impl', 'core.api'].map(id => node(s, id).data.dim)).toEqual([false, false, false])
    expect(node(s, 'core.log').data.dim).toBe(true)
    expect(s.nodes.some(n => n.data.impact || n.data.impactSelf)).toBe(false)
  })

  it('悬停叠加：选中时悬停另一个模块，它的一跳也不变淡（并集）；移开收回', async () => {
    const desk = await openDesk()
    desk.select({ kind: 'module', id: 'core.util' })
    desk.setHover('core.log')
    await settle(desk)
    const { scene: s } = await sceneOf(desk)
    expect(node(s, 'core.log').data.dim).toBe(false)
    expect(bundle(s, 'core.api', 'core.log').data.dim).toBe(false)
    expect(bundle(s, 'core.impl', 'core.log').data.dim).toBe(false)
    // 选中的一跳仍在
    expect(bundle(s, 'core.impl', 'core.util').data.dim).toBe(false)
    // 两者都不碰的边照样变淡
    expect(bundle(s, 'core.impl', 'core.api').data.dim).toBe(true)
    desk.setHover(null)
    const { scene: back } = await sceneOf(desk)
    expect(node(back, 'core.log').data.dim).toBe(true)
  })

  it('影响面查询生效时悬停照常叠加：悬停节点的一跳不变淡（去掉「影响面生效时不算悬停」）', async () => {
    const desk = await openDesk()
    desk.select({ kind: 'module', id: 'core.util' })
    desk.queryImpact({ mode: 'in' })
    await settle(desk)
    const { scene: q } = await sceneOf(desk)
    // 传入闭包只有 impl；api、log 在闭包外
    expect(node(q, 'core.impl').data.impact).toMatchObject({ direction: 'in', distance: 1 })
    expect(node(q, 'core.api').data.dim).toBe(true)
    expect(node(q, 'core.log').data.dim).toBe(true)
    expect(bundle(q, 'core.api', 'core.log').data.dim).toBe(true)
    desk.setHover('core.log')
    const { scene: h } = await sceneOf(desk)
    expect(node(h, 'core.log').data.dim).toBe(false)
    expect(node(h, 'core.api').data.dim).toBe(false)
    expect(bundle(h, 'core.api', 'core.log').data.dim).toBe(false)
    // 闭包标记不受悬停影响
    expect(node(h, 'core.impl').data.impact).toMatchObject({ direction: 'in', distance: 1 })
  })

  it('边聚焦（选中束）时悬停照常叠加：与悬停节点相连的束不变淡', async () => {
    const desk = await openDesk()
    desk.select({ kind: 'dep', id: 'core.util->core.api' })
    await settle(desk)
    expect(bundle((await sceneOf(desk)).scene, 'core.impl', 'core.log').data.dim).toBe(true)
    desk.setHover('core.log')
    const { scene: s } = await sceneOf(desk)
    expect(bundle(s, 'core.impl', 'core.log').data.dim).toBe(false)
    expect(bundle(s, 'core.util', 'core.api').data.selected).toBe(true)
  })

  it('交互视角同义：选中 impl、悬停 api 时两者的一跳都不变淡', async () => {
    const desk = await openDesk('/?level=core')
    desk.select({ kind: 'module', id: 'core.impl' })
    desk.setHover('core.api')
    await settle(desk)
    const { scene: s } = await sceneOf(desk)
    expect(route(s, 'core.impl', 'core.util').data.dim).toBe(false)
    expect(route(s, 'core.util', 'core.api').data.dim).toBe(false)
    expect(node(s, 'core.impl').data.dim).toBe(false)
    expect(route(s, 'core.log', 'core.util').data.dim).toBe(true)
    expect(node(s, 'core.log').data.dim).toBe(true)
  })
})
