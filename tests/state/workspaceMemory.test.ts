/** 工作区的本机记忆（LY-3、LY-11b、LY-12a）：同步适配器读回与写回 */
import { describe, expect, it } from 'vitest'
import { nextTick, shallowRef } from 'vue'
import { EMPTY_WORKSPACE, workspaceTransition, type WorkspaceAction, type WorkspaceState } from '../../src/state/transition'
import { WORKSPACE_KEY, attachWorkspaceMemory, readWorkspaceMemory, type WorkspaceMemory } from '../../src/state/sync/workspaceMemory'

const store = (init: Record<string, string> = {}, width = 1280): WorkspaceMemory & { data: Record<string, string> } => {
  const data = { ...init }
  return { data, get: k => data[k] ?? null, set: (k, v) => void (data[k] = v), windowWidth: () => width }
}

describe('读回', () => {
  it('没有记忆：侧栏按窗口宽度推出（LY-3：≥ 1440 展开），其余缺省', () => {
    expect(readWorkspaceMemory(store({}, 1440))).toEqual({ type: 'restore', memory: {}, sidebar: { open: true, width: 240 } })
    expect(readWorkspaceMemory(store({}, 1280)).sidebar).toEqual({ open: false, width: 240 })
  })
  it('坏 JSON、形状不对的项丢弃', () => {
    expect(readWorkspaceMemory(store({ [WORKSPACE_KEY]: '{oops' })).memory).toEqual({})
    const r = readWorkspaceMemory(store({ [WORKSPACE_KEY]: JSON.stringify({ memory: { free: { groups: [['x']] } }, collapsed: 'yes', width: 0.3 }) }))
    expect(r.memory).toEqual({})
    expect(r.collapsed).toBeUndefined()
    expect(r.width).toBe(0.3)
  })
})

describe('接上状态', () => {
  it('启动读回一次；人改了排布、收起视图区、开侧栏即写回；再启动按记下的', async () => {
    const st = store()
    const state = shallowRef<WorkspaceState>(EMPTY_WORKSPACE)
    const dispatch = (a: WorkspaceAction) => void (state.value = workspaceTransition(state.value, a))
    attachWorkspaceMemory(st, state, dispatch)
    dispatch({ type: 'close', id: 'view:check' })
    dispatch({ type: 'setCollapsed', collapsed: true })
    dispatch({ type: 'setSidebar', open: true })
    await nextTick()
    const saved = JSON.parse(st.data[WORKSPACE_KEY])
    expect(saved.memory.free.groups).toEqual([['explainer', 'description']])
    expect([saved.collapsed, saved.sidebar.open]).toEqual([true, true])

    const again = shallowRef<WorkspaceState>(EMPTY_WORKSPACE)
    attachWorkspaceMemory(st, again, a => void (again.value = workspaceTransition(again.value, a)))
    expect(again.value.groups[0].tabs.map(t => t.id)).toEqual(['view:explainer', 'view:description'])
    expect([again.value.collapsed, again.value.sidebar.open]).toEqual([true, true])
  })
})
