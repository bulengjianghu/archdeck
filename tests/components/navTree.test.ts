// @vitest-environment jsdom
/** 侧栏（LY-3、LY-4；原导航树 W-7、T1–T8）：竖栏切模块 / 场景 / 改动三页，页名一行右端「筛选 ▾」（LY-4d）；问题清单是资料标签（LY-4a） */
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, provide, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import SideBar from '../../src/components/tree/SideBar.vue'
import SideRail from '../../src/components/tree/SideRail.vue'
import { SIDE_NAV, type ModulesMode, type SidePage } from '../../src/components/shared/navTab'
import { SIDE_FILTERS, createSideFilters } from '../../src/components/shared/sideFilters'
import IssueList from '../../src/components/tree/IssueList.vue'
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
  // 竖栏与侧栏共用项目视图持有的页（SIDE_NAV）
  const Host = defineComponent({
    setup() {
      provide(SIDE_NAV, { page: ref<SidePage>('modules'), mode: ref<ModulesMode>('modules') })
      provide(SIDE_FILTERS, createSideFilters())
      return () => [h(SideRail), h(SideBar)]
    },
  })
  const wrapper = mount(Host, { global: { provide: { [DESK_STATE as symbol]: desk }, plugins: [router] } })
  await flushPromises()
  const row = (id: string) => wrapper.findAll('.row').find(r => r.attributes('data-id') === id)
  return { wrapper, desk, router, row }
}

async function mountIssues(url = '/', files = sampleFiles()) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => ({ dir: 'model/test', files }))
  desk.attachRouter(router)
  await desk.init()
  const wrapper = mount(IssueList, { global: { provide: { [DESK_STATE as symbol]: desk }, plugins: [router] } })
  await flushPromises()
  return { wrapper, desk }
}

/** 竖栏的三页（悬停名 = aria-label） */
const railNames = (wrapper: Awaited<ReturnType<typeof mountTree>>['wrapper']) => wrapper.findAll('[data-rail]').map(t => t.attributes('aria-label'))
const pageName = (wrapper: Awaited<ReturnType<typeof mountTree>>['wrapper']) => wrapper.find('[data-side-page-name]').text()

describe('模块树', () => {
  it('LY-4、T3：竖栏三页（改动只在草图编辑时可用），模块页「筛选 ▾」里有按模块 / 按文件；展开到当前层次并标出它，选中的模块高亮', async () => {
    const { wrapper, row } = await mountTree('/?level=infra.framework&sel=m:infra.framework.sm')
    expect(railNames(wrapper)).toEqual(['模块', '场景', '改动'])
    expect(wrapper.find('[data-rail=changes]').attributes('disabled')).toBeDefined()
    expect(pageName(wrapper)).toBe('模块')
    expect(wrapper.find('[data-side-mode=files]').exists()).toBe(false)
    await wrapper.find('[data-side-filter]').trigger('click')
    expect(wrapper.find('[data-side-mode=files]').exists()).toBe(true)
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
    await wrapper.find('[data-rail=modules]').trigger('click')
    expect(row('infra.next')).toBeTruthy()
  })
})

describe('LY-3、LY-4d 竖栏与筛选（负责人 2026-11-08 走查）', () => {
  it('点当前页的图标收起侧栏，点另一页的图标展开并切页；收起时竖栏还在', async () => {
    const { wrapper, desk } = await mountTree('/', scenarioFiles())
    const ws = desk.workspace
    expect(ws.state.value.sidebar.open).toBe(false)
    await wrapper.find('[data-rail=scenes]').trigger('click')
    expect(ws.state.value.sidebar.open).toBe(true)
    expect(pageName(wrapper)).toBe('场景')
    expect(wrapper.find('[data-rail=scenes]').attributes('aria-pressed')).toBe('true')
    await wrapper.find('[data-rail=modules]').trigger('click')
    expect(ws.state.value.sidebar.open).toBe(true)
    expect(pageName(wrapper)).toBe('模块')
    await wrapper.find('[data-rail=modules]').trigger('click')
    expect(ws.state.value.sidebar.open).toBe(false)
    expect(wrapper.find('[data-rail=modules]').attributes('aria-pressed')).toBe('false')
    // 顶格的侧栏开关
    await wrapper.find('[data-head=rail] button').trigger('click')
    expect(ws.state.value.sidebar.open).toBe(true)
  })

  it('场景页的筛选收在弹层里：范围、类别、发起者；没选「全部」的项计入「筛选 · N」', async () => {
    const { wrapper } = await mountTree('/', scenarioFiles())
    await wrapper.find('[data-rail=scenes]').trigger('click')
    expect(wrapper.find('.scenario-list').exists()).toBe(true)
    expect(wrapper.find('.scenario-list [aria-label=范围]').exists()).toBe(false)
    expect(wrapper.find('[data-filter-count]').text()).toBe('2')
    await wrapper.find('[data-side-filter]').trigger('click')
    const pop = wrapper.find('[data-filter-pop]')
    expect(pop.find('[aria-label=范围]').exists()).toBe(true)
    expect(pop.find('[aria-label=类别]').exists()).toBe(true)
    expect(pop.find('select[aria-label=按发起者筛选]').exists()).toBe(true)
    await pop.findAll('[aria-label=范围] button')[1].trigger('click')
    expect(wrapper.find('[data-filter-count]').text()).toBe('1')
  })
})

describe('运行视角', () => {
  it('LY-4c：进入回放切到场景页、先列这个场景的步骤，「全部场景」换回列表；退出后场景页回到列表', async () => {
    const { wrapper, desk } = await mountTree('/', scenarioFiles())
    expect(wrapper.find('.module-tree').exists()).toBe(true)
    desk.openScenario('sc.play')
    await flushPromises()
    expect(pageName(wrapper)).toBe('场景')
    expect(wrapper.find('.step-tree').exists()).toBe(true)
    await wrapper.find('[data-testid=all-scenes]').trigger('click')
    expect(wrapper.find('.scenario-list').exists()).toBe(true)
    desk.closeScenario()
    await flushPromises()
    expect(wrapper.find('.step-tree').exists()).toBe(false)
    expect(wrapper.find('.scenario-list').exists()).toBe(true)
  })

  it('LY-4b：选中文件切到模块页的按文件树（ADR-0007）', async () => {
    const { wrapper, desk } = await mountTree('/', scenarioFiles())
    desk.openScenario('sc.play')
    await flushPromises()
    desk.selectFile('src/a.ts')
    await flushPromises()
    expect(pageName(wrapper)).toBe('模块')
    await wrapper.find('[data-side-filter]').trigger('click')
    expect(wrapper.find('[data-side-mode=files]').attributes('aria-pressed')).toBe('true')
    // LY-4d：按文件是生效的筛选，「筛选 · 1」
    expect(wrapper.find('[data-filter-count]').text()).toBe('1')
    expect(wrapper.find('.file-tree').exists()).toBe(true)
    // 未注入源码来源时清单为 error，文件页签给出原因
    expect(wrapper.find('.source-note.err').text()).toContain('没有注入源码来源')
  })

  it('T5：模块树标出参与模块与当前步骤的两端', async () => {
    const { wrapper, desk, row } = await mountTree('/?level=infra&sc=sc.play&step=sc.play%23start', scenarioFiles())
    await wrapper.find('[data-rail=modules]').trigger('click')
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

describe('问题清单（W-6；LY-4a 起是「问题」资料标签的正文）', () => {
  it('列出返工清单：计数为错误与提醒，按严重度排序；展开见位置与建议，可定位、可复制给 agent', async () => {
    const bad = sampleFiles({ 'extra.yaml': 'relations:\n  - { id: rel.bad, from: infra, to: nowhere, type: calls }\n' })
    const { wrapper, desk } = await mountIssues('/', bad)
    const list = desk.rework.value!
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
    const { wrapper, desk } = await mountIssues('/', bad)
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
  })
})
