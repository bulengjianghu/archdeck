// @vitest-environment jsdom
/** 导航树（W-7、T1–T8）与分屏方向（W-4） */
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import NavTree from '../../src/components/tree/NavTree.vue'
import { createDeskState } from '../../src/state/useDeskState'
import { DESK_STATE } from '../../src/state/inject'
import { DEFAULT_LAYOUT, directionOf, readLayout, setDirection, toggleSlot } from '../../src/components/split/paneLayout'
import { sampleFiles, scenarioFiles } from '../fixtures/sample'

async function mountTree(url = '/', files = sampleFiles()) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => ({ dir: 'model/test', files }))
  desk.attachRouter(router)
  await desk.init()
  const wrapper = mount(NavTree, { global: { provide: { [DESK_STATE as symbol]: desk }, plugins: [router] } })
  await flushPromises()
  const row = (id: string) => wrapper.findAll('.row').find(r => r.attributes('data-id') === id)
  return { wrapper, desk, router, row }
}

describe('模块树', () => {
  it('T1、T3：结构视角有模块与文件页签；展开到当前层次并标出它，选中的模块高亮', async () => {
    const { wrapper, row } = await mountTree('/?level=infra.framework&sel=m:infra.framework.sm')
    expect(wrapper.findAll('[role=tab]').map(t => t.text())).toEqual(['模块', '文件'])
    expect(row('infra.framework')!.classes()).toContain('level')
    expect(row('infra.framework.sm')!.classes()).toContain('selected')
    // 祖先链展开，旁支不展开
    expect(row('infra')).toBeTruthy()
    expect(row('app.solution')).toBeUndefined()
  })

  it('T3：画布上下钻或选中，树同步展开与高亮', async () => {
    const { desk, row } = await mountTree()
    expect(row('infra.framework')).toBeUndefined()
    desk.drillInto('infra')
    desk.select({ kind: 'module', id: 'infra.framework' })
    await flushPromises()
    expect(row('infra')!.classes()).toContain('level')
    expect(row('infra.framework')!.classes()).toContain('selected')
  })

  it('T4：单击定位（跳到所在层次并选中），单击系统回根层，双击有子模块的下钻', async () => {
    const { desk, row, router } = await mountTree('/?level=infra')
    await row('infra.framework')!.find('.caret').trigger('click')
    await row('infra.framework.sm')!.trigger('click')
    expect(desk.levelId.value).toBe('infra.framework')
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'infra.framework.sm' })
    await row('infra')!.trigger('dblclick')
    expect(desk.levelId.value).toBe('infra')
    await row('sys')!.trigger('click')
    expect(desk.levelId.value).toBe('sys')
    expect(desk.selection.value).toBeNull()
    // 在当前层次内单击不新增历史（N10）
    await flushPromises()
    const before = router.options.history.state.position
    await row('infra')!.trigger('click')
    await flushPromises()
    expect(router.options.history.state.position).toBe(before)
  })

  it('T3：悬停本层可见的模块等同悬停画布节点；不在本层的不算', async () => {
    const { desk, row } = await mountTree('/?level=infra')
    await row('infra.player')!.trigger('mouseenter')
    expect(desk.hoverId.value).toBe('infra.player')
    await row('sys')!.trigger('mouseenter')
    expect(desk.hoverId.value).toBeNull()
  })

  it('T2：结构视角下「只看现状」开启时不列目标态模块；运行视角下不受开关影响', async () => {
    const files = scenarioFiles({ 'modules/extra.yaml': 'modules: [{ id: infra.next, parent: infra, name: Next, responsibility: 目标态, status: target }]' })
    const { wrapper, desk, row } = await mountTree('/?level=infra', files)
    expect(row('infra.next')).toBeTruthy()
    desk.setToggles({ currentOnly: true })
    await flushPromises()
    expect(row('infra.next')).toBeUndefined()
    desk.openScenario('sc.play')
    await flushPromises()
    await wrapper.findAll('[role=tab]')[0].trigger('click')
    expect(row('infra.next')).toBeTruthy()
  })
})

describe('运行视角', () => {
  it('T1：进入运行视角切到步骤页签，退出切回模块页签', async () => {
    const { wrapper, desk } = await mountTree('/', scenarioFiles())
    desk.openScenario('sc.play')
    await flushPromises()
    expect(wrapper.findAll('[role=tab]').map(t => t.text())).toEqual(['模块', '文件', '步骤'])
    expect(wrapper.find('.step-tree').exists()).toBe(true)
    desk.closeScenario()
    await flushPromises()
    expect(wrapper.find('.step-tree').exists()).toBe(false)
    expect(wrapper.findAll('[role=tab]')).toHaveLength(2)
  })

  it('T1：选中文件切到文件页签（ADR-0007）', async () => {
    const { wrapper, desk } = await mountTree('/', scenarioFiles())
    desk.openScenario('sc.play')
    await flushPromises()
    desk.selectFile('src/a.ts')
    await flushPromises()
    expect(wrapper.find('[role=tab][aria-selected=true]').text()).toBe('文件')
    expect(wrapper.find('.file-tree').exists()).toBe(true)
    // 未注入源码来源时清单为 error，文件页签给出原因
    expect(wrapper.find('.source-note.err').text()).toContain('没有注入源码来源')
  })

  it('T5：模块树标出参与模块与当前步骤的两端', async () => {
    const { wrapper, desk, row } = await mountTree('/?level=infra&sc=sc.play&step=sc.play%23start', scenarioFiles())
    await wrapper.findAll('[role=tab]')[0].trigger('click')
    await flushPromises()
    expect(row('infra.player')!.classes()).toEqual(expect.arrayContaining(['part', 'active']))
    expect(row('app')!.classes()).toContain('part')
    expect(row('infra.framework')!.classes()).not.toContain('active')
    desk.next()
    await flushPromises()
    expect(row('infra.framework')!.classes()).toContain('active')
  })

  it('T6、T7：步骤树按组合结构嵌套；选中的步骤高亮，序号与本层可见消息一致；不可见的标出', async () => {
    const { wrapper, desk } = await mountTree('/?sc=sc.play', scenarioFiles())
    const text = wrapper.text()
    expect(text).toContain('分支')
    expect(text).toContain('[需要改图]')
    expect(text).toContain('[无需改图]')
    expect(text).toContain('（空分支）')
    expect(text).toContain('循环 [每个 MU]')
    expect(text).toContain('引用：决策')
    expect(wrapper.find('.frame.selected').exists()).toBe(false)
    desk.next()
    desk.next()
    await flushPromises()
    const cur = wrapper.findAll('.frame.selected')
    expect(cur).toHaveLength(1)
    expect(cur[0].find('.seq').text()).toBe(String(desk.run.currentIndex.value! + 1))
    expect(wrapper.findAll('.frame.walked').length).toBeGreaterThan(0)
    // 分支未选：其后的帧标未到达
    expect(wrapper.findAll('.frame.unreached').length).toBeGreaterThan(0)
  })

  it('T7：本层不可见的帧不编号并标「本层不可见」', async () => {
    const { wrapper } = await mountTree('/?level=infra.framework&sc=sc.play&alt=0', scenarioFiles())
    const hidden = wrapper.findAll('.frame.hidden')
    expect(hidden.length).toBeGreaterThan(0)
    expect(hidden[0].text()).toContain('本层不可见')
    expect(hidden[0].find('.seq').text()).toBe('')
  })

  it('T8：单击帧指向该步（未选分支上的先改选）；单击分支标题选该分支；「开头」回到开头', async () => {
    const { wrapper, desk } = await mountTree('/?sc=sc.play', scenarioFiles())
    const frames = wrapper.findAll('.frame')
    const update = frames.find(f => f.text().includes('StateMachine → Pipeline'))!
    await update.trigger('click')
    expect(desk.playback.value!.frameId).toBe('sc.play#update')
    expect(desk.playback.value!.choices.get('sc.play#3')).toBe(0)
    await wrapper.findAll('.option')[1].trigger('click')
    expect(desk.playback.value!.choices.get('sc.play#3')).toBe(1)
    await wrapper.find('.start').trigger('click')
    expect(desk.playback.value!.frameId).toBeNull()
  })
})

describe('分屏方向（W-4）', () => {
  it('默认左右；切换方向保留比例与收起状态', () => {
    expect(directionOf(DEFAULT_LAYOUT)).toBe('row')
    const folded = toggleSlot(DEFAULT_LAYOUT, 'aside')
    const col = setDirection(folded, 'column')
    expect(directionOf(col)).toBe('column')
    expect(col.kind === 'split' && col.sizes).toEqual(DEFAULT_LAYOUT.kind === 'split' && DEFAULT_LAYOUT.sizes)
    expect(col.kind === 'split' && col.children[1]).toMatchObject({ collapsed: true })
  })

  it('副栏泛化前存下的布局（槽位 sequence）读出时改为 aside，方向与收起保留', () => {
    const old = {
      kind: 'split',
      dir: 'column',
      sizes: [0.6, 0.4],
      children: [
        { kind: 'pane', slot: 'structure' },
        { kind: 'pane', slot: 'sequence', collapsed: true },
      ],
    }
    localStorage.setItem('h5p-arch-desk:split:v2:legacy', JSON.stringify(old))
    expect(readLayout('legacy')).toEqual({ ...old, children: [old.children[0], { kind: 'pane', slot: 'aside', collapsed: true }] })
  })
})
