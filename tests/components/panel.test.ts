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
  const wrapper = mount(Panel, { global: { provide: { [DESK_STATE as symbol]: desk, panelUnfold: { value: true } }, plugins: [router] } })
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
    // PC-10：系统的理解卡列分层（每层一句话职责）
    expect(wrapper.find('[data-card="understand"]').text()).toContain('Infrastructure')
  })

  it('选中层：理解卡 ① 一句话职责、② 原则一句（ADR-0042）+ 子模块 + 「可依赖」链接行（PC-3）', async () => {
    const { wrapper } = await mountPanel('/?sel=m:infra')
    const u = wrapper.find('[data-card="understand"]')
    expect(u.find('[data-testid="summary"]').exists()).toBe(true)
    const split = u.find('[data-sec="split"]')
    expect(split.text()).toContain('原则')
    expect(split.text()).toContain('机制与副作用')
    expect(wrapper.text()).not.toContain('抽象原则')
    expect(u.find('[data-testid="layer-deps"]').text()).toContain('Application')
    expect(u.find('[data-testid="module-children"]').text()).toContain('Framework')
  })

  it('选中模块：职责、对外接口签名、出入边', async () => {
    const { wrapper } = await mountPanel('/?level=infra.framework&sel=m:infra.framework.sm')
    const text = wrapper.text()
    expect(text).toContain('StateMachine')
    expect(text).toContain('状态机')
    expect(text).toContain('sendCommand')
    // PC-3：对外表面一行一个，单击展开签名与说明
    await wrapper.find('[data-sec="surface"] .k').trigger('click')
    expect(wrapper.text()).toContain('sendCommand(cmd: Command): Result')
    // PC-4：协作按对端合并
    expect(wrapper.find('[data-testid="collab"] [data-peer="app"]').text()).toContain('→')
    expect(text).toContain('modules/infra.yaml')
  })

  it('选中关系：端点、类型、五个维度、经由接口、交换的数据结构', async () => {
    const { wrapper } = await mountPanel('/?level=infra.framework&sel=r:r6')
    const text = wrapper.text()
    expect(text).toContain('StateMachine')
    expect(text).toContain('Pipeline')
    expect(text).toContain('未分类')
    // ADR-0022：控制流、知识（没有代码事实时不判定）、语义、同步性、平面各一行
    expect(wrapper.findAll('.dims dt').map(d => d.text())).toEqual(['控制流', '知识', '语义', '同步性', '平面'])
    expect(text).toContain('StateMachine → Pipeline')
    expect(text).toContain('不判定：没有代码事实')
    expect(text).toContain('未分类：按三问定为查询或委托')
    expect(text).toContain('控制面')
    expect(text).toContain('未指定')
    expect(text).toContain('Command')
  })

  it('选中聚合边：列出原始关系，点击跳到关系所在层次', async () => {
    const { wrapper, desk } = await mountPanel('/?level=infra&sel=e:infra.framework->infra.mus:streams')
    expect(wrapper.text()).toContain('聚合边')
    expect(wrapper.text()).toContain('Pipeline → MUs')
    await wrapper.find('.rel-row .link').trigger('click')
    expect(desk.levelId.value).toBe('infra')
    expect(desk.selection.value).toEqual({ kind: 'relation', id: 'r4' })
  })

  it('V13：选中关系时头部之后第一节是「说明」，没写说明的显示「未写说明」；聚合边面板每条原始关系下显示说明首句', async () => {
    const long = `管线把媒体单元推给 MUs。${'长'.repeat(80)}`
    const files = sampleFiles({
      'z.yaml': `relations:\n  - { id: rd, from: infra.framework.sm, to: infra.mus, type: streams, description: '${long}' }\n  - { id: rl, from: infra.framework.pipeline, to: infra.mus, type: streams, description: '${'短'.repeat(70)}' }\n`,
    })
    const withDesc = (await mountPanel('/?level=infra.framework&sel=r:rd', files)).wrapper
    // PC-10：理解卡先给目的（没写 purpose 时为说明首句截断、标待提炼），其后第一节是「说明」
    const card = withDesc.find('[data-card="understand"] .card-body')
    expect(card.find('[data-testid="purpose"]').text()).toContain('待提炼')
    const first = card.find('.section')
    expect(first.classes()).toContain('summary')
    expect(first.text()).toContain('管线把媒体单元推给 MUs。')
    const without = (await mountPanel('/?level=infra.framework&sel=r:r6', files)).wrapper
    expect(without.find('.no-summary').text()).toBe('未写说明')
    // 聚合边：说明首句到第一个句号；没写说明的一条不显示；超过 60 字截断加「…」
    const agg = (await mountPanel('/?level=infra&sel=e:infra.framework->infra.mus:streams', files)).wrapper
    const rows = agg.findAll('.rel-row')
    const summaries = agg.findAll('.rel-row .summary')
    const summary = (id: string) => summaries.find(x => x.attributes('title')!.startsWith(id === 'rd' ? '管线' : '短'))
    expect(rows).toHaveLength(3)
    expect(summaries).toHaveLength(2)
    expect(summary('rd')!.text()).toBe('管线把媒体单元推给 MUs。')
    expect(summary('rd')!.attributes('title')).toBe(long)
    expect(summary('rl')!.text()).toBe(`${'短'.repeat(60)}…`)
  })

  it('子模块列表点击：在当前层次时只选中', async () => {
    const { wrapper, desk } = await mountPanel('/?level=infra')
    const link = wrapper.findAll('[data-testid="module-children"] .k').find(l => l.text() === 'Framework')!
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
    await wrapper.findAll('[data-testid="related"] [data-doc="scenario"]')[0].trigger('click')
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

  it('选中模块：理解卡首节是运行信息（V6），其后是五问；没有「已钉住」提示（ADR-0012）', async () => {
    const { wrapper } = await mountPanel('/?sc=sc.play&step=sc.play%23done&alt=0&sel=m:infra.framework.sm&level=infra.framework', scenarioFiles())
    const text = wrapper.text()
    expect(text).not.toContain('已钉住')
    expect(text).toContain('在「播放」中')
    expect(text).toContain('离进度最近')
    const u = wrapper.find('[data-card="understand"] .understand')
    expect(u.element.firstElementChild!.textContent).toContain('在「播放」中')
    expect(u.find('[data-testid="summary"]').exists()).toBe(true)
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

  it('未绑定关系的步骤仍为「交互中未建模」（附录 B 改名），不显示上层关系', async () => {
    const files = scenarioFiles({ 'scenarios/x.yaml': 'scenario: { id: sc.u, name: U, steps: [{ call: { id: a, from: infra.mus, to: app.fragments } }] }' })
    const { wrapper } = await mountPanel('/?level=infra&sc=sc.u&step=sc.u%23a', files)
    expect(wrapper.text()).toContain('（交互中未建模）')
    expect(wrapper.text()).not.toContain('结构中未建模')
    expect(wrapper.text()).not.toContain('对应关系建在上层')
  })
})

describe('D-5、F7：步骤的输出', () => {
  it('stepOutput：异步调用写了显式返回时为配对（同 call），没写时为异步', async () => {
    const { stepOutput } = await import('../../src/components/panel/runText')
    const f = (id: string, kind: 'call' | 'async' | 'return') => ({ id, kind, from: 'a', to: 'b' }) as never
    const frames = new Map([
      ['a1', f('a1', 'async')],
      ['r1', f('r1', 'return')],
      ['a2', f('a2', 'async')],
    ])
    const pairs = new Map([
      ['a1', 'r1'],
      ['r1', 'a1'],
    ])
    expect(stepOutput(frames.get('a1')!, pairs, frames)).toMatchObject({ kind: 'pair', frame: { id: 'r1' } })
    expect(stepOutput(frames.get('r1')!, pairs, frames)).toMatchObject({ kind: 'reply', frame: { id: 'a1' } })
    expect(stepOutput(frames.get('a2')!, pairs, frames)).toEqual({ kind: 'async' })
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
    const wrapper = mount(Panel, { global: { provide: { [DESK_STATE as symbol]: desk, panelUnfold: { value: true } }, plugins: [router] } })
    await flushPromises()
    // PC-8：「架构治理」是核对卡的清单（panelUnfold 展开全部）
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

  it('GV-7、Q10：根层「架构治理」有基线时违规显示「±N · 存量 M」、环度只显示 ↑↓，其余绝对值在悬停中；没有基线时为绝对数并标「无基线」', async () => {
    const open = async (baseline: { createdAt: string; violations: string[]; cyclicity: { modules: number; files: number } } | null) => {
      const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
      await router.push('/')
      const desk = createDeskState(async () => ({ dir: 'model/test', files: [...scenarioFiles(), { path: 'modules/zz-refs.yaml', text: REFS }] }), {
        source: { ...source, facts: async () => ({ ...(await source.facts!())!, baseline }) },
      })
      desk.attachRouter(router)
      await desk.init()
      await flushPromises()
      const wrapper = mount(Panel, { global: { provide: { [DESK_STATE as symbol]: desk, panelUnfold: { value: true } }, plugins: [router] } })
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
    expect(based.row('违规').text()).toContain('+1 · 存量 1（相对基线：新增 1')
    expect(none.row('违规').text()).toContain('无基线')
    expect(none.row('违规').text()).not.toContain('存量')
    expect(based.row('违规').attributes('title')).toContain('计入门禁 1 条')
    // 审核轮 2 B1：悬停写明口径——声明的规则对代码事实；返工清单的 info 级（K24）不在此计数
    expect(based.row('违规').attributes('title')).toContain('声明的架构规则对代码事实的违规')
    expect(based.row('违规').attributes('title')).toContain('返工清单的 info 级提示（K24 层符合性）不在此计数')
  })

  it('G12（V16）：健康度按对象分组——确认 / 依赖 / 关系常显、治理组折叠带计数；拦截记录与外部依赖折叠带计数', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
    await router.push('/')
    const desk = createDeskState(async () => ({ dir: 'model/test', files: [...scenarioFiles(), { path: 'modules/zz-refs.yaml', text: REFS }] }), {
      source: {
        ...source,
        facts: async () => ({
          deps: {
            deps: [{ from: 'src/app/s.ts', to: 'src/framework/extra.ts', via: 'src/framework/extra.ts', kind: 'value', line: 7 }],
            external: { vue: 12, yaml: 3 },
            parsed: 2,
          },
          baseline: null,
          ledger: [
            { at: 't1', tool: 'check_dependency', client: 'cli', from: 'a', to: 'b', verdict: 'denied', rules: ['layer'], cycle: false },
            { at: 't2', tool: 'rescan', client: 'cli', violations: 1, newViolations: 0, cyclicity: { modules: 2, files: 0 } },
          ],
        }),
      },
    })
    desk.attachRouter(router)
    await desk.init()
    await flushPromises()
    const wrapper = mount(Panel, { global: { provide: { [DESK_STATE as symbol]: desk, panelUnfold: { value: true } }, plugins: [router] } })
    await flushPromises()
    // 常显组：确认 / 依赖 / 关系
    expect(wrapper.findAll('.grp-head').map(x => x.text())).toEqual(['确认', '依赖', '关系'])
    // 治理组折叠带计数（违规 + 模块环 + 未解释的交互），缺省收起
    const gov = wrapper.find('details.fold-gov')
    expect(gov.exists()).toBe(true)
    expect(gov.attributes('open')).toBeUndefined()
    expect(gov.find('summary').text()).toMatch(/治理\s*·\s*\d/)
    await gov.find('summary').trigger('click')
    const dts = gov.findAll('dt').map(x => x.text())
    expect(dts).toContain('违规')
    expect(dts).toContain('环度')
    expect(dts).toContain('基线')
    // 外部依赖（按导入次数）折叠带计数（包数）
    const ext = wrapper.findAll('details.g-fold').find(x => x.text().includes('外部依赖'))!
    expect(ext.find('summary').text()).toContain('外部依赖（按导入次数）')
    expect(ext.find('summary').text()).toMatch(/2/)
    expect(ext.attributes('open')).toBeUndefined()
    // 拦截记录折叠带计数（写前判定次数）
    const ledger = wrapper.findAll('details.g-fold').find(x => x.text().includes('拦截记录'))!
    expect(ledger.find('summary').text()).toMatch(/拦截记录（agent 接口）\s*1/)
    expect(ledger.attributes('open')).toBeUndefined()
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
    const wrapper = mount(Panel, { global: { provide: { [DESK_STATE as symbol]: desk, panelUnfold: { value: true } }, plugins: [router] } })
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
