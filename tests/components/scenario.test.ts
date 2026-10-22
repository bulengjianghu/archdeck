// @vitest-environment jsdom
/** 场景证据（S15、D-20）：场景面板的「证据」一节与场景列表的「测试 N」 */
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import Panel from '../../src/components/panel/Panel.vue'
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
  const global = { provide: { [DESK_STATE as symbol]: desk, [OPEN_PREVIEW as symbol]: (p: string) => opened.push(p) }, plugins: [router] }
  return { desk, global, opened }
}

describe('场景面板的证据', () => {
  it('列出证据文件：在源码清单里的可在副栏预览，不在的标「不在源码清单中」', async () => {
    const { global, opened } = await setup('/?sc=sc.ev')
    const wrapper = mount(Panel, { global })
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
    const wrapper = mount(Panel, { global })
    await flushPromises()
    const section = wrapper.findAll('section').find(x => x.text().startsWith('证据'))!
    expect(section.findAll('.evidence li').map(i => i.text())).toEqual(['src/a.ts', 'tests/nope.test.ts'])
    expect(section.find('.missing').exists()).toBe(false)
    const plain = await setup('/?sc=sc.play')
    const w2 = mount(Panel, { global: plain.global })
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
