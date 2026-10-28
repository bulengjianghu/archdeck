/** 机制标签的模型层（L35、K22，ADR-0041）：通道名归类表穷举、条数、视图边的 mechs、声明的层的向上边 */
import { describe, expect, it } from 'vitest'
import { MECHANISMS, layerUpward, loadModel, mechanismCounts, mechanismOf, projectLevel } from '@/model'

describe('L35① mechanismOf：归类表', () => {
  it('词表九个、次序固定（L26② 修饰段）', () => {
    expect([...MECHANISMS]).toEqual(['回调', '端口', '总线', '注入', '跨进程', '路由', '事件', '通道', '拉取'])
    for (const m of MECHANISMS) expect(m.length).toBeLessThanOrEqual(3)
  })

  it('端口、总线按 via 形态，含「未指明」', () => {
    expect(mechanismOf({ via: 'port:if.a' })).toBe('端口')
    expect(mechanismOf({ via: 'port' })).toBe('端口')
    expect(mechanismOf({ via: 'bus:core.bus' })).toBe('总线')
    expect(mechanismOf({ via: 'bus' })).toBe('总线')
  })

  it.each([
    ['callback', '回调'],
    ['inject', '注入'],
    ['router', '路由'],
    ['http', '跨进程'],
    ['https', '跨进程'],
    ['ws', '跨进程'],
    ['websocket', '跨进程'],
    ['sse', '跨进程'],
    ['postMessage', '跨进程'],
    ['worker', '跨进程'],
    ['hmr', '跨进程'],
    ['ipc', '跨进程'],
    ['event', '事件'],
    ['dom', '事件'],
    ['mediaSession', '事件'],
    ['visibilitychange', '事件'],
    ['statechange', '事件'],
    ['shared-ref', '通道'],
    ['wasm-abi', '通道'],
  ] as const)('channel:%s → %s', (name, tag) => {
    expect(mechanismOf({ via: `channel:${name}` })).toBe(tag)
  })

  it('不分大小写；@<契约模块> 不影响归类', () => {
    expect(mechanismOf({ via: 'channel:HTTP' })).toBe('跨进程')
    expect(mechanismOf({ via: 'channel:PostMessage@app.contract' })).toBe('跨进程')
    expect(mechanismOf({ via: 'channel:callback@app.x' })).toBe('回调')
    expect(mechanismOf({ via: 'channel:VisibilityChange' })).toBe('事件')
    expect(mechanismOf({ via: 'channel:other@app.x' })).toBe('通道')
  })

  it('没写 via 的拉取型流为「拉取」；写了 via 的按 via；直接、同步不写', () => {
    expect(mechanismOf({ pull: true })).toBe('拉取')
    expect(mechanismOf({ pull: true, via: 'port:if.a' })).toBe('端口')
    expect(mechanismOf({})).toBeNull()
    expect(mechanismOf({ via: 'nonsense' })).toBeNull()
  })

  it('L35② mechanismCounts：每个机制的条数，没有机制的不计', () => {
    expect(mechanismCounts([{ via: 'port:a' }, { via: 'port:b' }, { via: 'channel:inject' }, {}])).toEqual({ 端口: 2, 注入: 1 })
    expect(mechanismCounts([{}, {}])).toEqual({})
  })
})

const MODEL = `
modules:
  - id: app
    name: App
    responsibility: 应用
    children:
      - id: app.top
        name: Top
        kind: layer
        order: 1
        responsibility: 上层
        children:
          - { id: app.top.a, name: A, role: core, responsibility: 甲 }
      - id: app.low
        name: Low
        kind: layer
        order: 2
        responsibility: 下层
        children:
          - { id: app.low.b, name: B, role: core, responsibility: 乙 }
          - { id: app.low.c, name: C, role: core, responsibility: 丙 }
interfaces:
  - { id: if.top, name: TopPort, signature: "top(): void" }
relations:
  - { id: r.down, from: app.top.a, to: app.low.b, type: commands }
  - { id: r.down2, from: app.top.a, to: app.low.b, type: commands, via: 'channel:inject' }
  - { id: r.up-direct, from: app.low.b, to: app.top.a, type: queries }
  - { id: r.up-port, from: app.low.c, to: app.top.a, type: commands, via: 'port:if.top' }
  - { id: r.up-cb, from: app.low.b, to: app.top.a, type: commands, via: 'channel:callback' }
`

function load() {
  const { index } = loadModel([
    { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
    { path: 'modules/app.yaml', text: MODEL },
  ])
  return index
}

describe('L35② 视图边的 mechs', () => {
  it('聚合时按关系计条数，没有机制的边不给', () => {
    const view = projectLevel(load(), 'app')
    const core = view.coreEdges ?? []
    const down = core.find(e => e.id === 'app.top.a->app.low.b:commands')!
    expect(down.mechs).toEqual({ 注入: 1 })
    const upCmd = core.find(e => e.id === 'app.low.b->app.top.a:commands')!
    expect(upCmd.mechs).toEqual({ 回调: 1 })
    expect(core.find(e => e.id === 'app.low.b->app.top.a:queries')!.mechs).toBeUndefined()
    // 层间边同样带
    const band = view.edges.find(e => e.from === 'app.low' && e.to === 'app.top' && e.type === 'commands')!
    expect(band.mechs).toEqual({ 端口: 1, 回调: 1 })
  })
})

describe('K22 layerUpward：分层总览按声明的层序', () => {
  it('发起方所在层 order 更大即向上；有不是控制反转的关系列出，否则为控制反转', () => {
    const index = load()
    const view = projectLevel(index, 'app')
    const up = new Map(layerUpward(index, view).map(u => [u.edge, u]))
    expect(up.get('app.low.b->app.top.a:queries')).toMatchObject({ inversion: false, relations: ['r.up-direct'] })
    expect(up.get('app.low.c->app.top.a:commands')).toMatchObject({ inversion: true, relations: [] })
    expect(up.get('app.low.b->app.top.a:commands')).toMatchObject({ inversion: true })
    // 向下的不算
    expect(up.has('app.top.a->app.low.b:commands')).toBe(false)
    // 层间边：Low → Top 的查询是直接的
    expect([...up.values()].some(u => u.from === 'app.low' && u.to === 'app.top' && !u.inversion)).toBe(true)
  })

  it('普通层次不给（由 levelTiers 判定）', () => {
    const index = load()
    expect(layerUpward(index, projectLevel(index, 'app.low'))).toEqual([])
  })
})

describe('K22 layerUpward：写了 mayDependOn 时按可依赖的方向，不按位置', () => {
  const withDeps = (top: string, low: string) =>
    MODEL.replace('order: 1\n', `order: 1\n${top}`).replace('order: 2\n', `order: 2\n${low}`)
  const load2 = (text: string) =>
    loadModel([
      { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
      { path: 'modules/app.yaml', text },
    ]).index
  it('下层可依赖上层（层序与依赖方向不一致）：下层调上层不算向上，上层调下层才算', () => {
    const index = load2(withDeps('        mayDependOn: []\n', '        mayDependOn: [app.top]\n'))
    const up = layerUpward(index, projectLevel(index, 'app'))
    expect(up.some(u => u.edge === 'app.low.b->app.top.a:queries')).toBe(false)
    expect(up.find(u => u.edge === 'app.top.a->app.low.b:commands')).toMatchObject({ inversion: false, relations: ['r.down'] })
  })
  it('两个方向都不许的不算向上（归违规）', () => {
    const index = load2(withDeps('        mayDependOn: []\n', '        mayDependOn: []\n'))
    expect(layerUpward(index, projectLevel(index, 'app'))).toEqual([])
  })
})
