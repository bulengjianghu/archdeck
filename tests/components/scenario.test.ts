// @vitest-environment jsdom
/** 场景证据（S15、D-20）：场景面板的「证据」一节与场景列表的「测试 N」；场景列表按类别筛选（R17） */
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import ScenarioPanel from '../../src/components/panel/ScenarioPanel.vue'
import ScenarioList from '../../src/components/ScenarioList.vue'
import { OPEN_PREVIEW } from '../../src/components/shared/preview'
import { createDeskState, type SourceFetcher } from '../../src/state/useDeskState'
import { DESK_STATE } from '../../src/state/inject'
import { scenarioFiles } from '../fixtures/sample'

const EVIDENCE =
  'scenario: { id: sc.ev, name: 有证据, evidence: [src/a.ts, tests/nope.test.ts], steps: [{ call: { from: actor.biz, to: infra.player, label: go } }] }\n'
const source: SourceFetcher = {
  tree: async () => ({ status: 'local', root: '/repo', files: ['src/a.ts'], packages: {} }),
  file: async () => null,
  exports: async () => [],
}

async function setup(url: string, withSource = true) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => ({ dir: 'model/test', files: scenarioFiles({ 'scenarios/ev.yaml': EVIDENCE }) }), withSource ? { source } : {})
  desk.attachRouter(router)
  await desk.init()
  await flushPromises()
  const opened: string[] = []
  const global = {
    provide: { [DESK_STATE as symbol]: desk, panelUnfold: { value: true }, [OPEN_PREVIEW as symbol]: (p: string) => opened.push(p) },
    plugins: [router],
  }
  return { desk, global, opened }
}

describe('场景面板的证据', () => {
  it('列出证据文件：在源码清单里的可在副栏预览，不在的标「不在源码清单中」', async () => {
    const { global, opened } = await setup('/?sc=sc.ev')
    const wrapper = mount(ScenarioPanel, { global })
    await flushPromises()
    const section = wrapper.findAll('section').find(x => x.text().startsWith('证据'))!
    expect(section.exists()).toBe(true)
    expect(section.find('.count').text()).toBe('2')
    const items = section.findAll('.evidence li')
    expect(items.map(i => i.text())).toEqual(['src/a.ts', 'tests/nope.test.ts不在源码清单中'])
    expect(items[1].find('.missing').exists()).toBe(true)
    await items[0].find('button.link').trigger('click')
    expect(opened).toEqual(['src/a.ts'])
  })

  it('没有源码清单时不判断存不存在；没写 evidence 的场景没有这一节', async () => {
    const { global } = await setup('/?sc=sc.ev', false)
    const wrapper = mount(ScenarioPanel, { global })
    await flushPromises()
    const section = wrapper.findAll('section').find(x => x.text().startsWith('证据'))!
    expect(section.findAll('.evidence li').map(i => i.text())).toEqual(['src/a.ts', 'tests/nope.test.ts'])
    expect(section.find('.missing').exists()).toBe(false)
    const plain = await setup('/?sc=sc.play')
    const w2 = mount(ScenarioPanel, { global: plain.global })
    await flushPromises()
    expect(w2.findAll('section').some(x => x.text().startsWith('证据'))).toBe(false)
  })
})

describe('场景列表的「测试 N」', () => {
  it('声明了证据的场景名后标「测试 N」（N 为证据文件数），其余没有', async () => {
    const { global } = await setup('/')
    const wrapper = mount(ScenarioList, { global })
    await wrapper.findAll('.seg button')[1].trigger('click')
    const items = wrapper.findAll('.item')
    const byName = (n: string) => items.find(i => i.find('.name').text().startsWith(`▶ ${n}`))!
    expect(byName('有证据').find('.evidence').text()).toBe('测试 2')
    expect(byName('有证据').find('.evidence').attributes('title')).toContain('2 个证据文件')
    expect(byName('播放').find('.evidence').exists()).toBe(false)
  })
})

describe('R17 场景列表按类别筛选', () => {
  const EXC = 'scenario: { id: sc.exc, name: 出错恢复, kind: exception, steps: [{ call: { from: actor.biz, to: infra.player, label: go } }] }\n'
  const MNT = 'scenario: { id: sc.mnt, name: 清理缓存, kind: maintenance, steps: [{ call: { from: actor.biz, to: infra.player, label: go } }] }\n'

  async function list() {
    localStorage.clear()
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
    await router.push('/')
    const desk = createDeskState(async () => ({ dir: 'model/test', files: scenarioFiles({ 'scenarios/exc.yaml': EXC, 'scenarios/mnt.yaml': MNT }) }))
    desk.attachRouter(router)
    await desk.init()
    await flushPromises()
    const global = { provide: { [DESK_STATE as symbol]: desk, panelUnfold: { value: true } }, plugins: [router] }
    const wrapper = mount(ScenarioList, { global })
    // 范围切到「全部」，只看类别筛选
    await wrapper.findAll('.seg')[0].findAll('button')[1].trigger('click')
    return { wrapper, router, global }
  }
  const names = (w: ReturnType<typeof mount>) => w.findAll('.item .name').map(n => n.text().replace(/^▶ /, ''))

  it('默认只列主流程（kind 缺省为 main）；切到「全部类别」后非主流程项标出类别；选择记在本机、不进 URL', async () => {
    const { wrapper, router, global } = await list()
    const kinds = wrapper.findAll('.seg')[1].findAll('button')
    expect(kinds[0].classes()).toContain('on')
    expect(names(wrapper).some(n => n.startsWith('出错恢复') || n.startsWith('清理缓存'))).toBe(false)
    expect(wrapper.findAll('.kind-tag')).toHaveLength(0)
    await kinds[1].trigger('click')
    expect(names(wrapper).find(n => n.startsWith('出错恢复'))).toContain('异常')
    expect(names(wrapper).find(n => n.startsWith('清理缓存'))).toContain('维护')
    expect(wrapper.findAll('.kind-tag').map(t => t.attributes('data-kind'))).toEqual(['exception', 'maintenance'])
    expect(localStorage.getItem('h5p-arch-desk:scenario-kinds')).toBe('all')
    expect(JSON.stringify(router.currentRoute.value.query)).not.toContain('all')
    // 重新打开列表沿用本机记住的选择
    const again = mount(ScenarioList, { global })
    expect(again.findAll('.seg')[1].findAll('button')[1].classes()).toContain('on')
  })
})
