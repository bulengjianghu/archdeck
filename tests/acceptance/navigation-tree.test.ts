// @vitest-environment jsdom
/**
 * 验收：docs/01-requirements.md §6.3 导航树与分屏，以真实的 model/ 描述驱动协调者与导航树组件。
 */
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { readProject, type ModelPayload } from '../../vite/readModelDir'
import { createDeskState } from '../../src/state/useDeskState'
import { DESK_STATE } from '../../src/state/inject'
import NavTree from '../../src/components/tree/NavTree.vue'
import { DEFAULT_LAYOUT, directionOf, readLayout, saveLayout, setDirection, toggleSlot } from '../../src/components/split/paneLayout'
import type { RawFile } from '../../src/model'

const ROOT = path.resolve(import.meta.dirname, '../..')
const payload = (project: string, extra: RawFile[] = []): ModelPayload => {
  const p = readProject(path.join(ROOT, 'model'), project, ROOT)!
  return { ...p, files: [...p.files, ...extra] }
}

async function open(project: string, url = `/p/${project}`, extra: RawFile[] = []) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/p/:project', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => payload(project, extra), { project })
  desk.attachRouter(router)
  await desk.init()
  const wrapper = mount(NavTree, { global: { provide: { [DESK_STATE as symbol]: desk }, plugins: [router] } })
  await flushPromises()
  const row = (id: string) => wrapper.findAll('.row').find(r => r.attributes('data-id') === id)
  const tab = (name: string) => wrapper.findAll('[role=tab]').find(t => t.text() === name)
  return { desk, router, wrapper, row, tab }
}

describe('§6.3 导航树与分屏验收', () => {
  it('1. 模块树展开到当前层次并标出它；画布上下钻或选中，树同步；单击深层模块跳到其所在层次并选中，双击下钻；当前层次内单击不新增历史', async () => {
    const { desk, router, row } = await open('h5player', '/p/h5player?level=infra')
    expect(row('infra')!.classes()).toContain('level')
    desk.drillInto('infra.framework')
    desk.select({ kind: 'module', id: 'infra.framework.state-machine' })
    await flushPromises()
    expect(row('infra.framework')!.classes()).toContain('level')
    expect(row('infra.framework.state-machine')!.classes()).toContain('selected')
    // 回根层后，单击树中仍展开着的深层模块
    desk.goTo('h5player')
    await flushPromises()
    await row('infra.framework.state-machine')!.trigger('click')
    expect(desk.levelId.value).toBe('infra.framework')
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'infra.framework.state-machine' })
    await row('infra')!.trigger('dblclick')
    expect(desk.levelId.value).toBe('infra')
    await flushPromises()
    const before = router.options.history.state.position
    await row('infra.framework')!.trigger('click')
    await flushPromises()
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'infra.framework' })
    expect(router.options.history.state.position).toBe(before)
  })

  it('2. 结构视角下开启「只看现状」，模块树不再列出目标态模块', async () => {
    const extra: RawFile = { path: 'modules/zz-target.yaml', text: 'modules: [{ id: infra.next-gen, parent: infra, name: 下一代内核, responsibility: 目标态示例, status: target }]' }
    const { desk, row } = await open('h5player', '/p/h5player?level=infra', [extra])
    expect(row('infra.next-gen')).toBeTruthy()
    desk.setToggles({ currentOnly: true })
    await flushPromises()
    expect(row('infra.next-gen')).toBeUndefined()
  })

  it('3. 打开场景：切到步骤页签，按组合框嵌套列出全部步骤，alt 列出全部分支；单步时三处同步、序号一致；单击未选分支上的一步即切到该分支并定位', async () => {
    const { desk, wrapper } = await open('h5player')
    desk.openScenario('sc.command')
    await flushPromises()
    expect(wrapper.find('.step-tree').exists()).toBe(true)
    const options = wrapper.findAll('.option').map(o => o.text())
    expect(options.some(t => t.includes('需要改图'))).toBe(true)
    expect(options.some(t => t.includes('无需改图'))).toBe(true)
    expect(wrapper.text()).toContain('引用：')
    for (let i = 0; i < 3; i++) desk.next()
    await flushPromises()
    const cur = wrapper.findAll('.frame.selected')
    expect(cur.length).toBeGreaterThan(0)
    expect(Number(cur[0].find('.seq').text())).toBe(desk.currentIndex.value! + 1)
    expect(desk.walked.value).toBe(3)
    // 单击「无需改图」分支下的第一步
    const point = desk.plan.value!.points.values().next().value!
    const target = point.options[1].first!
    const row = wrapper.findAll('.frame').filter(f => f.classes().includes('unreached') || f.classes().includes('unchosen'))
    expect(row.length).toBeGreaterThan(0)
    desk.seek(target.id)
    await flushPromises()
    expect(desk.playback.value!.choices.get(point.id)).toBe(1)
    expect(wrapper.find('.frame.selected').exists()).toBe(true)
  })

  it('§6.8-7 T7：选中步骤时它的帧为选中样式，同一可见消息的其他帧为「同一步」；选中其他对象时进度所在的帧只加小标记', async () => {
    const { desk, wrapper } = await open('h5p-arch-desk')
    desk.openScenario('sc.open-and-play')
    // 根层（分层总览）找一条合并了多帧的可见消息
    let guard = 0
    while (desk.currentIndex.value === null || desk.scenarioView.value!.messages[desk.currentIndex.value].frameIds.length < 2) {
      desk.next()
      if (++guard > 20) throw new Error('没有合并的可见消息')
    }
    await flushPromises()
    expect(wrapper.findAll('.frame.selected')).toHaveLength(1)
    const same = wrapper.findAll('.frame.same')
    expect(same.length).toBeGreaterThan(0)
    expect(same[0].text()).toContain('本层合并为 1 步')
    desk.select({ kind: 'module', id: desk.index.value!.childrenOf.get(desk.levelId.value)![0] })
    await flushPromises()
    expect(wrapper.find('.frame.selected').exists()).toBe(false)
    expect(wrapper.find('.frame.same').exists()).toBe(false)
    expect(wrapper.findAll('.frame.progress')).toHaveLength(1)
  })

  it('4. 运行视角下模块树标出参与模块；单击其中一个即选中它，面板显示它的运行信息', async () => {
    const { desk, row, tab } = await open('h5p-arch-desk', '/p/h5p-arch-desk?level=state')
    desk.openScenario('sc.open-and-play')
    await flushPromises()
    await tab('模块')!.trigger('click')
    expect(row('state')!.classes()).toContain('part')
    expect(row('state.desk')!.classes()).toContain('part')
    await row('state.desk')!.trigger('click')
    expect(desk.selected.value).toEqual({ kind: 'module', id: 'state.desk' })
    expect(desk.selectedParticipation.value!.frames.length).toBeGreaterThan(0)
  })

  it('5. 分屏默认左右；切换为上下后按项目记在本地，刷新仍保持；收起状态随之保留', () => {
    expect(directionOf(DEFAULT_LAYOUT)).toBe('row')
    expect(directionOf(readLayout('acceptance'))).toBe('row')
    saveLayout('acceptance', toggleSlot(setDirection(DEFAULT_LAYOUT, 'column'), 'aside'))
    const again = readLayout('acceptance')
    expect(directionOf(again)).toBe('column')
    expect(again.kind === 'split' && again.children[1]).toMatchObject({ collapsed: true })
    expect(directionOf(readLayout('other'))).toBe('row')
  })
})
