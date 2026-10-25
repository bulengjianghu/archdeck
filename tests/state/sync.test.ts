/** 同步适配器：用假路由、假布局、假事件源测试 */
import { describe, expect, it } from 'vitest'
import { nextTick, shallowRef } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createRouterSync } from '../../src/state/sync/router'
import { createLayoutSync } from '../../src/state/sync/layout'
import { watchModelChanges, type ChangeEvents } from '../../src/state/sync/modelSource'
import type { LevelView } from '../../src/model'
import type { PositionedView, StructureLinks } from '../../src/layout/layout'

const tick = () => new Promise(r => setTimeout(r, 0))

async function makeRouter(url: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { render: () => null } },
      { path: '/p/:project', component: { render: () => null } },
    ],
  })
  await router.push(url)
  return router
}

describe('路由同步', () => {
  it('写入：相同则不导航；push 进历史，replace 不进', async () => {
    const router = await makeRouter('/p/demo')
    const restored: unknown[] = []
    const sync = createRouterSync(router, { project: 'demo' }, q => restored.push(q))
    sync.write({}, 'push')
    await tick()
    expect(router.currentRoute.value.fullPath).toBe('/p/demo')
    sync.write({ level: 'a' }, 'push')
    await tick()
    sync.write({ level: 'a', sel: 'm:x' }, 'replace')
    await tick()
    expect(sync.query()).toEqual({ level: 'a', sel: 'm:x' })
    expect(restored).toEqual([]) // 自己发起的导航不回写
    router.back()
    await new Promise(r => setTimeout(r, 20))
    expect(restored).toEqual([{}])
  })

  it('外部改地址 → restore；离开本项目时不回写', async () => {
    const router = await makeRouter('/p/demo')
    const restored: unknown[] = []
    createRouterSync(router, { project: 'demo' }, q => restored.push(q))
    await router.push('/p/demo?level=b')
    expect(restored).toEqual([{ level: 'b' }])
    await router.push('/p/other?level=c')
    await router.push('/')
    expect(restored).toHaveLength(1)
  })
})

describe('布局同步', () => {
  it('只采用最后一次请求的结果', async () => {
    const view = shallowRef<LevelView | null>(null)
    const resolvers: ((pv: PositionedView) => void)[] = []
    const positioned = createLayoutSync(view, () => new Promise(r => resolvers.push(r)))
    const v1 = { mode: 'graph', parentId: 'a', nodes: [], edges: [] } as LevelView
    const v2 = { ...v1, parentId: 'b' }
    view.value = v1
    await nextTick()
    view.value = v2
    await nextTick()
    resolvers[1]({ view: v2 } as PositionedView)
    resolvers[0]({ view: v1 } as PositionedView)
    await tick()
    expect(positioned.value?.view.parentId).toBe('b')
    view.value = null
    await nextTick()
    expect(positioned.value).toBeNull()
  })

  it('L15：结构边（并集布局）变化也重新布局，传给布局的是当前的结构边', async () => {
    const v = { mode: 'graph', parentId: 'a', nodes: [], edges: [] } as LevelView
    const view = shallowRef<LevelView | null>(v)
    const links = shallowRef<StructureLinks | null>(null)
    const calls: (StructureLinks | null | undefined)[] = []
    createLayoutSync(
      view,
      async (x, _o, l) => {
        calls.push(l)
        return { view: x } as PositionedView
      },
      shallowRef({}),
      links,
    )
    links.value = { edges: [{ id: 'dependency:a->b', from: 'a', to: 'b' }] }
    await nextTick()
    expect(calls).toEqual([links.value])
  })
})

describe('模型源同步', () => {
  it('只响应本项目的变更通知，可取消订阅', () => {
    const handlers = new Set<(d: { project?: string }) => void>()
    const events: ChangeEvents = { on: (_e, cb) => handlers.add(cb), off: (_e, cb) => handlers.delete(cb) }
    let n = 0
    const stop = watchModelChanges(events, 'demo', () => n++)
    for (const h of handlers) h({ project: 'other' })
    for (const h of handlers) h({ project: 'demo' })
    expect(n).toBe(1)
    stop()
    expect(handlers.size).toBe(0)
    expect(watchModelChanges(undefined, 'demo', () => n++)).toBeTypeOf('function')
  })
})
