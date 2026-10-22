// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import Panel from '../../src/components/panel/Panel.vue'
import { createDeskState, type SourceFetcher } from '../../src/state/useDeskState'
import { DESK_STATE } from '../../src/state/inject'
import type { FileDep } from '../../src/model'
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
    const { wrapper, desk } = await mountPanel('/?level=infra&sel=e:infra.framework->infra.mus:dataflow')
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

  it('选中场景（停在开头）时显示场景（触发者、所在层次、引用；步骤目录在导航树），选中步骤时显示步骤', async () => {
    const { wrapper, desk } = await mountPanel('/?sc=sc.play&step=sc.play%23update&alt=0', scenarioFiles())
    const text = wrapper.text()
    expect(text).toContain('选中的步骤')
    expect(text).toContain('StateMachine → Pipeline')
    expect(text).toContain('推断')
    expect(text).toContain('分支 [需要改图]')
    desk.closeScenario()
    desk.openScenario('sc.play')
    await flushPromises()
    const s = wrapper.text()
    expect(s).not.toContain('步骤目录')
    expect(s).toContain('业务方')
    expect(s).toContain('引用了')
  })

  it('选中模块：运行信息在上，结构信息折叠在下；没有「已钉住」提示（ADR-0012）', async () => {
    const { wrapper } = await mountPanel('/?sc=sc.play&step=sc.play%23done&alt=0&sel=m:infra.framework.sm&level=infra.framework', scenarioFiles())
    const text = wrapper.text()
    expect(text).not.toContain('已钉住')
    expect(text).toContain('在「播放」中')
    expect(text).toContain('离进度最近')
    expect(wrapper.find('details.structure').exists()).toBe(true)
  })
})

describe('P15：经由上层关系', () => {
  it('步骤面板注明对应关系建在上层，「定位到这条关系」跳到该关系所在层次并选中它', async () => {
    const files = scenarioFiles({
      'upper.yaml': 'relations: [{ id: r9, from: app.solution, to: infra.framework, type: calls }]',
      'scenarios/x.yaml': 'scenario: { id: sc.v, name: V, steps: [{ call: { id: a, from: app.solution, to: infra.framework.pipeline, label: swap } }] }',
    })
    const { wrapper, desk } = await mountPanel('/?level=infra.framework&sc=sc.v&step=sc.v%23a', files)
    const text = wrapper.text()
    expect(text).toContain('（经由上层关系）')
    expect(text).toContain('对应关系建在上层：Solution → Framework')
    const btn = wrapper.findAll('button').find(b => b.text() === '定位到这条关系')!
    await btn.trigger('click')
    await flushPromises()
    expect(desk.selected.value).toEqual({ kind: 'relation', id: 'r9' })
    expect(desk.levelId.value).not.toBe('infra.framework')
  })

  it('未绑定关系的步骤仍为「结构中未建模」，不显示上层关系', async () => {
    const files = scenarioFiles({ 'scenarios/x.yaml': 'scenario: { id: sc.u, name: U, steps: [{ call: { id: a, from: infra.mus, to: app.fragments } }] }' })
    const { wrapper } = await mountPanel('/?level=infra&sc=sc.u&step=sc.u%23a', files)
    expect(wrapper.text()).toContain('（结构中未建模）')
    expect(wrapper.text()).not.toContain('对应关系建在上层')
  })
})

describe('D-5：步骤的输入', () => {
  it('signatureLine：按标签开头的调用名在接口签名中找到对应的一行或一段', async () => {
    const { signatureLine } = await import('../../src/components/panel/runText')
    const sig = 'dispatch(action: ViewAction): void\nopenScenario(id: string): void · closeScenario(): void   // 场景\nseek(frameId: string | null): void'
    expect(signatureLine(sig, 'openScenario(id)')).toBe('openScenario(id: string): void')
    expect(signatureLine(sig, 'closeScenario：退出')).toBe('closeScenario(): void')
    expect(signatureLine(sig, 'seek')).toBe('seek(frameId: string | null): void')
    expect(signatureLine(sig, '点「运行」')).toBeNull()
    expect(signatureLine(sig, 'open(x)')).toBeNull()
  })

  it('S14：步骤没写的接口取自对应关系，面板标「取自关系」并给出签名行', async () => {
    const files = scenarioFiles({
      'scenarios/inh.yaml':
        'scenario: { id: sc.inh, name: I, steps: [{ call: { id: a, from: infra.framework.sm, to: app.solution, label: "sendCommand(cmd)" } }] }',
    })
    const { wrapper } = await mountPanel('/?sc=sc.inh&step=sc.inh%23a', files)
    expect(wrapper.find('.call').text()).toBe('sendCommand(cmd: Command): Result')
    expect(wrapper.text()).toContain('取自关系')
  })
})

describe('GV-9、Y5：本层环可解释', () => {
  const REFS = `
modules:
  - { id: app.solution.core, parent: app.solution, name: Core, responsibility: x, codeRefs: [src/app/**] }
  - { id: infra.framework.extra, parent: infra.framework, name: Extra, responsibility: x, codeRefs: [src/framework/**] }
`
  const dep = (from: string, to: string): FileDep => ({ from, to, via: to, kind: 'value', line: 7 })
  const source: SourceFetcher = {
    tree: async () => ({ status: 'local', root: '/repo', files: ['src/app/s.ts', 'src/framework/extra.ts'], packages: {} }),
    file: async () => null,
    exports: async () => [],
    facts: async () => ({
      deps: { deps: [dep('src/app/s.ts', 'src/framework/extra.ts'), dep('src/framework/extra.ts', 'src/app/s.ts')], external: {}, parsed: 2 },
      baseline: null,
      ledger: [],
    }),
  }

  it('选中带环编号的节点：架构治理列出环内节点与本层依赖，展开见模块依赖与文件证据，单击选中对应的边或代码依赖', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
    await router.push('/?sel=m:app')
    const desk = createDeskState(async () => ({ dir: 'model/test', files: [...scenarioFiles(), { path: 'modules/zz-refs.yaml', text: REFS }] }), { source })
    desk.attachRouter(router)
    await desk.init()
    await flushPromises()
    desk.setToggles({ showFacts: true })
    const wrapper = mount(Panel, { global: { provide: { [DESK_STATE as symbol]: desk }, plugins: [router] } })
    await flushPromises()
    const block = wrapper.find('.level-cycle')
    expect(block.text()).toMatch(/所在的本层环 ↻\d/)
    expect(block.text()).toContain('Application')
    expect(block.text()).toContain('Infrastructure')
    const rows = block.findAll('details')
    expect(rows).toHaveLength(2)
    expect(block.text()).toContain('src/framework/extra.ts:7')
    const back = rows.find(r => r.find('summary').text().startsWith('Infrastructure'))!
    const e = desk.facts.selectedCycle.value!.edges.find(x => x.fromModule === 'infra')!
    await back.find('summary button').trigger('click')
    await flushPromises()
    expect(desk.selection.value).toEqual(e.edgeId ? { kind: 'edge', id: e.edgeId } : { kind: 'dep', id: 'infra->app' })
  })

  it('GV-7：根层「架构治理」有基线时只显示相对基线的变化（违规 ±N、环度 ↑↓），绝对值在悬停中；没有基线时为绝对数并标「无基线」', async () => {
    const open = async (baseline: { createdAt: string; violations: string[]; cyclicity: { modules: number; files: number } } | null) => {
      const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
      await router.push('/')
      const desk = createDeskState(async () => ({ dir: 'model/test', files: [...scenarioFiles(), { path: 'modules/zz-refs.yaml', text: REFS }] }), {
        source: { ...source, facts: async () => ({ ...(await source.facts!())!, baseline }) },
      })
      desk.attachRouter(router)
      await desk.init()
      await flushPromises()
      const wrapper = mount(Panel, { global: { provide: { [DESK_STATE as symbol]: desk }, plugins: [router] } })
      await flushPromises()
      const row = (label: string) => {
        const dts = wrapper.findAll('dt')
        const i = dts.findIndex(d => d.text() === label)
        return wrapper.findAll('dd')[i]
      }
      return { row }
    }
    const none = await open(null)
    expect(none.row('环度').text()).toContain('无基线')
    expect(none.row('模块环').text()).toMatch(/1 个 · 最大 2/)
    const based = await open({ createdAt: 't', violations: [], cyclicity: { modules: 9, files: 0 } })
    expect(based.row('环度').text()).toContain('↓ −5')
    expect(based.row('环度').attributes('title')).toContain('模块 4')
    expect(based.row('违规').text()).toContain('+1（相对基线：新增 1')
    expect(based.row('违规').attributes('title')).toContain('计入门禁 1 条')
  })
})

describe('K6：关系面板的未证实分档', () => {
  const REFS = `
modules:
  - { id: infra.framework.sm.impl, parent: infra.framework.sm, name: SmImpl, responsibility: x, codeRefs: [src/sm/**] }
  - { id: infra.framework.pipeline.impl, parent: infra.framework.pipeline, name: PipeImpl, responsibility: x, codeRefs: [src/pipe/**] }
`
  async function relationPanel(deps: FileDep[], extra = '', rel = 'r6') {
    const source: SourceFetcher = {
      tree: async () => ({ status: 'local', root: '/repo', files: ['src/sm/a.ts', 'src/pipe/b.ts'], packages: {} }),
      file: async () => null,
      exports: async () => [],
      facts: async () => ({ deps: { deps, external: {}, parsed: 2 }, baseline: null, ledger: [] }),
    }
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
    await router.push(`/?level=infra.framework&sel=r:${rel}`)
    const desk = createDeskState(async () => ({ dir: 'model/test', files: [...sampleFiles(), { path: 'modules/zz-refs.yaml', text: REFS + extra }] }), {
      source,
    })
    desk.attachRouter(router)
    await desk.init()
    await flushPromises()
    const wrapper = mount(Panel, { global: { provide: { [DESK_STATE as symbol]: desk }, plugins: [router] } })
    await flushPromises()
    return wrapper.text()
  }

  it('运行时关系两端之间没有任何依赖：标红，提示按代码修正描述', async () => {
    const text = await relationPanel([])
    expect(text).toContain('两端之间在代码里没有任何依赖')
  })

  it('K5b：写了 via 的关系：面板标「不判定：经 HTTP」，头部有「经 HTTP」标记', async () => {
    const text = await relationPanel([], 'relations:\n  - { id: r9, from: infra.framework.sm, to: infra.framework.pipeline, type: calls, via: http }\n', 'r9')
    expect(text).toContain('不判定：经 HTTP')
    expect(text).not.toContain('未证实')
  })

  it('运行时关系只有反向依赖：只标注「可能经端口或注入」', async () => {
    const text = await relationPanel([{ from: 'src/pipe/b.ts', to: 'src/sm/a.ts', via: 'src/sm/a.ts', kind: 'type', line: 1 }])
    expect(text).toContain('可能经端口或注入')
    expect(text).not.toContain('没有任何依赖')
  })
})
