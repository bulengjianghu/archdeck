// @vitest-environment jsdom
/** 导航树（W-7、T1–T8）与分屏方向（W-4） */
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import NavTree from '../../src/components/tree/NavTree.vue'
import { createDeskState } from '../../src/state/useDeskState'
import { DESK_STATE } from '../../src/state/inject'
import { REWORK_CATEGORIES, REWORK_CATEGORY_LABELS } from '../../src/model'
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

/** 页签名（问题页签带计数，去掉） */
const tabNames = (wrapper: Awaited<ReturnType<typeof mountTree>>['wrapper']) => wrapper.findAll('[role=tab]').map(t => t.text().replace(/\d+$/, ''))

describe('模块树', () => {
  it('T1、T3：结构视角有模块与文件页签；展开到当前层次并标出它，选中的模块高亮', async () => {
    const { wrapper, row } = await mountTree('/?level=infra.framework&sel=m:infra.framework.sm')
    expect(tabNames(wrapper)).toEqual(['模块', '文件', '问题'])
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
    expect(tabNames(wrapper)).toEqual(['模块', '文件', '步骤', '问题'])
    expect(wrapper.find('.step-tree').exists()).toBe(true)
    desk.closeScenario()
    await flushPromises()
    expect(wrapper.find('.step-tree').exists()).toBe(false)
    expect(wrapper.findAll('[role=tab]')).toHaveLength(3)
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

describe('问题页签（W-6）', () => {
  it('列出返工清单：计数为错误与提醒，按严重度排序；展开见位置与建议，可定位、可复制给 agent', async () => {
    const bad = sampleFiles({ 'extra.yaml': 'relations:\n  - { id: rel.bad, from: infra, to: nowhere, type: calls }\n' })
    const { wrapper, desk } = await mountTree('/', bad)
    const tab = wrapper.findAll('[role=tab]').find(t => t.text().startsWith('问题'))!
    const list = desk.rework.value!
    expect(tab.find('.count').text()).toBe(String(list.counts.error + list.counts.warning))
    await tab.trigger('click')
    const items = wrapper.findAll('.issue-list .item')
    expect(items.length).toBe(list.items.length)
    expect(items[0].classes()).toContain('error')
    await items[0].find('.row').trigger('click')
    expect(items[0].find('.at code').text()).toContain('model/test/extra.yaml')
    expect(items[0].text()).toContain('改正描述')
    let copied = ''
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void (copied = t) }, configurable: true })
    await items[0].findAll('.buttons button').at(-1)!.trigger('click')
    await flushPromises()
    expect(copied).toContain('### [错误]')
    expect(copied).toContain('model/test/extra.yaml')
  })

  it('按类别筛选：类别与命令行 issues --category 同一枚举；选一类只剩该类，与严重度筛选叠加；计数角标不变', async () => {
    // 一条坏关系（描述错误）+ 一个两端之间没有运行时关系的步骤（结构中未建模）
    const bad = scenarioFiles({
      'extra.yaml': 'relations:\n  - { id: rel.bad, from: infra, to: nowhere, type: calls }\n',
      'scenarios/extra.yaml': 'scenario: { id: sc.x, name: X, steps: [{ call: { from: domain.services, to: infra.mus, label: go } }] }\n',
    })
    const { wrapper, desk } = await mountTree('/', bad)
    const tab = wrapper.findAll('[role=tab]').find(t => t.text().startsWith('问题'))!
    const badge = tab.find('.count').text()
    await tab.trigger('click')
    const list = desk.rework.value!
    expect(list.byCategory.description).toBeGreaterThan(0)
    expect(list.byCategory.unmodeled).toBeGreaterThan(0)
    const select = wrapper.find('.issue-list select.category')
    expect(select.findAll('option').map(o => o.attributes('value'))).toEqual(['all', ...REWORK_CATEGORIES])
    // 没有代码事实：违规等类别没有条目，不可选
    expect(select.find('option[value=violation]').attributes('disabled')).toBeDefined()
    expect(select.find('option[value=unmodeled]').text()).toBe(`${REWORK_CATEGORY_LABELS.unmodeled} ${list.byCategory.unmodeled}`)
    await select.setValue('unmodeled')
    const items = () => wrapper.findAll('.issue-list .item')
    expect(items()).toHaveLength(list.byCategory.unmodeled)
    expect(items().every(i => i.find('.meta').text().startsWith(REWORK_CATEGORY_LABELS.unmodeled))).toBe(true)
    // 与严重度叠加：未建模的步骤都是提醒，选「错误」后一条不剩并给出提示
    await wrapper.find('.issue-list .filters button.error').trigger('click')
    expect(items()).toHaveLength(0)
    expect(wrapper.find('.issue-list').text()).toContain('没有符合筛选条件的问题')
    await select.setValue('description')
    expect(items()).toHaveLength(list.items.filter(i => i.category === 'description' && i.severity === 'error').length)
    expect(tab.find('.count').text()).toBe(badge)
  })
})
