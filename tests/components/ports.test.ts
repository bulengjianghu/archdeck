// @vitest-environment jsdom
/**
 * 端口与四类交互的面板呈现（ADR-0029）：端口面板（K11，选中端口 L13）、模块面板的端口一节与「知识」行旁的子类 / 组装（K12、K13）、
 * 关系面板的机制（viaLabel）与经端口、画布端口记号的单击（V2）、治理面板的端口孤立与交互分类（U14、U13、M17）、返工清单的新类别（Q7）。
 */
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import Panel from '../../src/components/panel/Panel.vue'
import PortMarks from '../../src/components/nodes/PortMarks.vue'
import IssueList from '../../src/components/tree/IssueList.vue'
import { createDeskState, type SourceFetcher } from '../../src/state/useDeskState'
import { DESK_STATE } from '../../src/state/inject'
import type { FactsPayload, FileDep, SourcePayload } from '../../src/model'
import { scenarioFiles } from '../fixtures/sample'

const REFS = `
modules:
  - { id: app.solution.core, parent: app.solution, name: Core, responsibility: x, codeRefs: [src/app/**] }
  - { id: domain.models.core, parent: domain.models, name: ModelsCore, responsibility: x, codeRefs: [src/domain/**] }
  - { id: infra.framework.extra, parent: infra.framework, name: Extra, responsibility: x, codeRefs: [src/framework/**] }
relations:
  - { id: rpx, from: infra.player, to: app.solution, type: commands, via: 'port:if.plan' }
  - { id: rcx, from: infra.player, to: app.fragments, type: queries, via: 'channel:http', mode: async }
`
const LOCAL: SourcePayload = { status: 'local', root: '/repo', files: ['src/app/s.ts', 'src/domain/m.ts', 'src/framework/extra.ts'], packages: {} }
const dep = (from: string, to: string, extra: Partial<FileDep> = {}): FileDep => ({ from, to, via: to, kind: 'value', line: 1, ...extra })
const facts: FactsPayload = {
  deps: {
    deps: [
      dep('src/app/s.ts', 'src/framework/extra.ts', {
        inherits: [{ name: 'Base', clause: 'extends', decl: 'class' }],
        invokes: true,
        invokeKinds: ['extends'],
      }),
      dep('src/domain/m.ts', 'src/framework/extra.ts', { invokes: true, invokeKinds: ['new'] }),
    ],
    external: {},
    parsed: 3,
  },
  baseline: null,
  ledger: [],
}
const source: SourceFetcher = { tree: async () => LOCAL, file: async () => null, exports: async () => [], facts: async () => facts }

async function mountWith(url: string, comp: unknown = Panel, withFacts = true) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(
    async () => ({ dir: 'model/test', files: [...scenarioFiles(), { path: 'modules/zz-refs.yaml', text: REFS }] }),
    withFacts ? { source } : {},
  )
  desk.attachRouter(router)
  await desk.init()
  await flushPromises()
  const wrapper = mount(comp as never, { global: { provide: { [DESK_STATE as symbol]: desk }, plugins: [router] } })
  await flushPromises()
  return { wrapper, desk }
}

describe('K11 端口面板（选中端口，L13）', () => {
  it('定义 · 实现者（描述的，带来源）· 使用者（经端口）；单击实现者选中该模块，单击使用者选中那条关系', async () => {
    const { wrapper, desk } = await mountWith('/?level=app&sel=p:if.plan')
    const text = wrapper.text()
    expect(text).toContain('端口 Plan')
    expect(text).toContain('if.plan')
    expect(text).toContain('定义于')
    expect(text).toContain('实现者 1')
    expect(text).toContain('使用者 1')
    expect(text).toContain('经端口')
    expect(text).toContain('委托')
    // 有代码事实、代码里没有证据：标「仅描述」
    expect(wrapper.find('.implementers .tag').text()).toBe('仅描述')
    await wrapper.find('.users .party .link').trigger('click')
    expect(desk.selection.value).toEqual({ kind: 'relation', id: 'rpx' })
    const again = await mountWith('/?level=app&sel=p:if.plan')
    await again.wrapper.find('.implementers .party .link').trigger('click')
    expect(again.desk.selection.value).toEqual({ kind: 'module', id: 'infra.player' })
  })

  it('不算端口的接口：说明只是对外能力', async () => {
    const { wrapper } = await mountWith('/?level=infra.framework&sel=p:if.sm')
    expect(wrapper.text()).toContain('接口（不算端口）')
    expect(wrapper.text()).toContain('没有任何实现者')
  })
})

describe('模块面板：端口一节（K11）与「知识」行旁的子类 / 组装（K12、K13）', () => {
  it('定义了端口的模块逐个列出端口，标题可选中端口；对外接口里算端口的接口可打开端口面板；没有端口的模块没有这一节', async () => {
    const { wrapper, desk } = await mountWith('/?level=app&sel=m:app.solution')
    const section = wrapper.findAll('section').find(x => x.text().includes('端口（定义 · 实现者 · 使用者）'))!
    expect(section.text()).toContain('Plan')
    await section.find('.title .link').trigger('click')
    expect(desk.selection.value).toEqual({ kind: 'port', id: 'if.plan' })
    const other = await mountWith('/?level=infra.framework&sel=m:infra.framework.sm')
    expect(other.wrapper.text()).not.toContain('端口（定义')
  })

  it('知识：基类所在模块列「子类 N」、组装方列「组装 N」并标组装根，单击展开两端与文件证据', async () => {
    const { wrapper } = await mountWith('/?level=infra.framework&sel=m:infra.framework.extra')
    const section = wrapper.findAll('section').find(x => x.text().includes('代码事实 · 知识'))!
    expect(section.text()).toContain('子类 1')
    expect(section.text()).toContain('被组装于 1')
    await section.findAll('.fact-badge')[0].trigger('click')
    expect(section.find('.fact-list').text()).toContain('Core')
    expect(section.find('.fact-list').text()).toContain('src/app/s.ts')
    const root = await mountWith('/?level=domain.models&sel=m:domain.models.core')
    const s2 = root.wrapper.findAll('section').find(x => x.text().includes('代码事实 · 知识'))!
    expect(s2.text()).toContain('组装根')
    expect(s2.text()).toContain('组装 1')
  })
})

describe('关系面板：机制与同步性（ADR-0029）', () => {
  it('经端口的关系：徽标「经 端口 Plan」；通道按 viaLabel；查询 mode: async 标异步', async () => {
    const { wrapper } = await mountWith('/?level=app&sel=r:rpx', Panel, false)
    expect(wrapper.text()).toContain('经 端口 Plan')
    const q = await mountWith('/?level=app&sel=r:rcx', Panel, false)
    expect(q.wrapper.find('.badges').text()).toContain('经 HTTP')
    expect(q.wrapper.find('.badges').text()).toContain('异步')
    expect(q.wrapper.text()).toContain('不判定：经 HTTP')
  })
})

describe('V2 画布端口记号的单击', () => {
  it('单击端口记号选中端口；合成的「端口 ×N」选中定义模块', async () => {
    const { desk } = await mountWith('/?level=app', Panel, false)
    const marks = mount(PortMarks, {
      props: { moduleId: 'app.solution', ports: { side: 'top', items: [{ id: 'if.plan', name: 'Plan', implementers: 1 }] } },
      global: { provide: { [DESK_STATE as symbol]: desk } },
    })
    expect(marks.find('.port-mark').attributes('aria-label')).toBe('端口 Plan，实现者 1')
    await marks.find('.port-mark').trigger('click')
    expect(desk.selection.value).toEqual({ kind: 'port', id: 'if.plan' })
    const merged = mount(PortMarks, {
      props: { moduleId: 'app.solution', ports: { side: 'left', items: [], merged: 5 } },
      global: { provide: { [DESK_STATE as symbol]: desk } },
    })
    expect(merged.text()).toContain('端口 ×5')
    await merged.find('.port-mark').trigger('click')
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'app.solution' })
  })
})

describe('治理面板与返工清单（U13、U14、M17、Q7）', () => {
  it('根层健康度列交互分类与端口；明细列当前版本的端口孤立，单击选中端口', async () => {
    const { wrapper, desk } = await mountWith('/')
    expect(wrapper.find('[data-testid="interaction-health"]').text()).toMatch(/未分类 \d+（核心之间 \d+） · 查询副作用 0/)
    expect(wrapper.find('[data-testid="port-health"]').text()).toMatch(/2 个 · 无实现者 0 · 无使用者 1 · 子类 1 · 组装 1（组装根 1）/)
    const list = wrapper.find('[data-testid="port-problems"]')
    expect(list.text()).toContain('port.no-user')
    await list.find('.link').trigger('click')
    expect(desk.selection.value).toEqual({ kind: 'port', id: 'if.model' })
  })

  it('返工清单的类别下拉含新三类（端口孤立、查询副作用、未分类），有条目的可选', async () => {
    const { wrapper } = await mountWith('/', IssueList)
    const options = wrapper.findAll('select.category option').map(o => [o.text(), o.attributes('disabled') === undefined])
    for (const label of ['端口孤立', '查询副作用', '未分类']) expect(options.some(([t]) => String(t).startsWith(label))).toBe(true)
    expect(options.find(([t]) => String(t).startsWith('端口孤立'))![1]).toBe(true)
  })
})
