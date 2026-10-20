// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import Panel from '../../src/components/panel/Panel.vue'
import { createDeskState } from '../../src/state/useDeskState'
import { DESK_STATE } from '../../src/state/inject'
import { sampleFiles, scenarioFiles } from '../fixtures/sample'

async function mountPanel(url = '/', files = sampleFiles()) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => ({ dir: 'model/test', files }))
  desk.attachRouter(router)
  await desk.init()
  const wrapper = mount(Panel, { global: { provide: { [DESK_STATE as symbol]: desk }, plugins: [router] } })
  await flushPromises()
  return { wrapper, desk }
}

describe('属性面板', () => {
  it('根层无选中：显示系统、生成来源、规模与分层', async () => {
    const { wrapper } = await mountPanel()
    const text = wrapper.text()
    expect(text).toContain('Demo')
    expect(text).toContain('abc123')
    expect(text).toContain('Infrastructure')
    expect(text).toContain('机制与副作用')
  })

  it('选中层：显示抽象原则与可依赖的层', async () => {
    const { wrapper } = await mountPanel('/?sel=m:infra')
    const text = wrapper.text()
    expect(text).toContain('抽象原则')
    expect(text).toContain('机制与副作用')
    expect(text).toContain('可依赖的层')
    expect(text).toContain('Application')
    expect(text).toContain('本层模块')
  })

  it('选中模块：职责、对外接口签名、出入边', async () => {
    const { wrapper } = await mountPanel('/?level=infra.framework&sel=m:infra.framework.sm')
    const text = wrapper.text()
    expect(text).toContain('StateMachine')
    expect(text).toContain('状态机')
    expect(text).toContain('sendCommand')
    expect(text).toContain('sendCommand(cmd: Command): Result')
    expect(text).toContain('出边')
    expect(text).toContain('→ Solution')
    expect(text).toContain('modules/infra.yaml')
  })

  it('选中关系：端点、类型、经由接口、交换的数据结构', async () => {
    const { wrapper } = await mountPanel('/?level=infra.framework&sel=r:r6')
    const text = wrapper.text()
    expect(text).toContain('StateMachine')
    expect(text).toContain('Pipeline')
    expect(text).toContain('调用（控制权转移）')
    expect(text).toContain('未指定')
    expect(text).toContain('Command')
  })

  it('选中聚合边：列出原始关系，点击跳到关系所在层次', async () => {
    const { wrapper, desk } = await mountPanel('/?level=infra&sel=e:infra.framework->infra.mus')
    expect(wrapper.text()).toContain('聚合边')
    expect(wrapper.text()).toContain('Pipeline → MUs')
    await wrapper.find('.rel-row .link').trigger('click')
    expect(desk.levelId.value).toBe('infra')
    expect(desk.selection.value).toEqual({ kind: 'relation', id: 'r4' })
  })

  it('子模块列表点击：在当前层次时只选中', async () => {
    const { wrapper, desk } = await mountPanel('/?level=infra')
    const link = wrapper.findAll('.child .link').find(l => l.text() === 'Framework')!
    await link.trigger('click')
    expect(desk.levelId.value).toBe('infra')
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'infra.framework' })
  })
})

describe('属性面板 · 运行视角', () => {
  it('参与者：入口关系与由它触发的场景，可打开场景', async () => {
    const { wrapper, desk } = await mountPanel('/?sel=a:actor.biz', scenarioFiles())
    expect(wrapper.text()).toContain('入口关系')
    expect(wrapper.text()).toContain('→ Player')
    await wrapper.findAll('.scenario-row .link')[0].trigger('click')
    expect(desk.playback.value?.scenarioId).toBe('sc.play')
  })

  it('跟随：尚未开始时显示场景（触发者、所在层次、步骤目录），之后显示当前步骤', async () => {
    const { wrapper, desk } = await mountPanel('/?sc=sc.play&step=sc.play%23update&alt=0', scenarioFiles())
    const text = wrapper.text()
    expect(text).toContain('当前步骤')
    expect(text).toContain('StateMachine → Pipeline')
    expect(text).toContain('推断')
    expect(text).toContain('分支 [需要改图]')
    desk.pause()
    desk.closeScenario()
    desk.openScenario('sc.play')
    desk.pause()
    await flushPromises()
    const s = wrapper.text()
    expect(s).toContain('步骤目录')
    expect(s).toContain('业务方')
    expect(s).toContain('循环 [每个 MU]')
    expect(s).toContain('引用了')
  })

  it('钉住：运行信息在上，结构信息折叠在下', async () => {
    const { wrapper } = await mountPanel('/?sc=sc.play&step=sc.play%23done&alt=0&sel=m:infra.framework.sm&level=infra.framework', scenarioFiles())
    const text = wrapper.text()
    expect(text).toContain('已钉住')
    expect(text).toContain('在「播放」中')
    expect(text).toContain('离播放头最近')
    expect(wrapper.find('details.structure').exists()).toBe(true)
  })
})
