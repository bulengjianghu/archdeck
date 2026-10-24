// @vitest-environment jsdom
/**
 * 第七轮 T3（ADR-0031）：属性面板的结构视图部分——模块「结构」一节（K15、K16、K17、U17）、依赖边面板（K14、K17、U15、U17）、
 * 被清空的选中的说明（V12）、步骤包含链（D-25）与界面改名（附录 B）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import Panel from '../../src/components/panel/Panel.vue'
import { resetStructurePrefs } from '../../src/components/display/useDisplayPrefs'
import { stepChain } from '../../src/components/panel/chain'
import { createDeskState, type SourceFetcher } from '../../src/state/useDeskState'
import { DESK_STATE } from '../../src/state/inject'
import { loadModel, type FileDep, type ModuleDep } from '../../src/model'
import { scenarioFiles } from '../fixtures/sample'

const REFS = `
modules:
  - { id: app.solution.core, parent: app.solution, name: SolCore, responsibility: x, codeRefs: [src/app/**] }
  - { id: domain.models.core, parent: domain.models, name: ModCore, responsibility: x, codeRefs: [src/domain/**] }
  - { id: infra.framework.extra, parent: infra.framework, name: Extra, responsibility: x, codeRefs: [src/framework/**] }
  - { id: infra.framework.sm.impl, parent: infra.framework.sm, name: SmImpl, responsibility: x, codeRefs: [src/sm/**] }
  - { id: infra.framework.pipeline.impl, parent: infra.framework.pipeline, name: PipeImpl, responsibility: x, codeRefs: [src/pipe/**] }
`
const FILES = ['src/app/s.ts', 'src/domain/m.ts', 'src/framework/extra.ts', 'src/sm/a.ts', 'src/pipe/b.ts']
const invoke = (from: string, to: string, line = 1): FileDep => ({ from, to, via: to, kind: 'value', line, uses: true, invokes: true })
/**
 * 事实：Extra → SolCore、SmImpl → SolCore（交互使用，后者撑着 r1）；SolCore → ModCore（只有值使用）；ModCore → Extra（只引类型）；
 * SolCore → PipeImpl（交互使用，应用层只许依赖领域层：违规、没有交互覆盖即未解释）；另有三条只引类型（见下）
 */
const DEPS: FileDep[] = [
  invoke('src/framework/extra.ts', 'src/app/s.ts', 3),
  invoke('src/sm/a.ts', 'src/app/s.ts', 5),
  { from: 'src/app/s.ts', to: 'src/domain/m.ts', via: 'src/domain/m.ts', kind: 'value', line: 2, uses: true },
  { from: 'src/domain/m.ts', to: 'src/framework/extra.ts', via: 'src/framework/extra.ts', kind: 'type', line: 1 },
  invoke('src/app/s.ts', 'src/pipe/b.ts', 9),
  // 只引类型：PipeImpl、SmImpl → ModCore，Extra → PipeImpl（使 ModCore 稳定、Extra 易变，U17）
  { from: 'src/pipe/b.ts', to: 'src/domain/m.ts', via: 'src/domain/m.ts', kind: 'type', line: 1 },
  { from: 'src/sm/a.ts', to: 'src/domain/m.ts', via: 'src/domain/m.ts', kind: 'type', line: 2 },
  { from: 'src/framework/extra.ts', to: 'src/pipe/b.ts', via: 'src/pipe/b.ts', kind: 'type', line: 4 },
]
const source: SourceFetcher = {
  tree: async () => ({ status: 'local', root: '/repo', files: FILES, packages: {} }),
  file: async () => null,
  exports: async () => [],
  facts: async () => ({ deps: { deps: DEPS, external: {}, parsed: FILES.length }, baseline: null, ledger: [] }),
}

async function open(url: string, opts: { facts?: boolean } = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(
    async () => ({ dir: 'model/test', files: [...scenarioFiles(), { path: 'modules/zz-refs.yaml', text: REFS }] }),
    opts.facts === false ? {} : { source },
  )
  desk.attachRouter(router)
  await desk.init()
  await flushPromises()
  const wrapper = mount(Panel, { global: { provide: { [DESK_STATE as symbol]: desk }, plugins: [router] } })
  await flushPromises()
  return { desk, wrapper }
}

beforeEach(() => {
  localStorage.clear()
  resetStructurePrefs()
})

describe('模块面板「结构」一节（K15、K16、K17）', () => {
  it('只在结构视角出现：Ca / Ce / I 与三档、本层节点数、贡献最多的依赖方', async () => {
    const { wrapper, desk } = await open('/?v=s&sel=m:app')
    const sec = wrapper.find('.module-structure')
    expect(sec.exists()).toBe(true)
    const m = desk.facts.metricsOf('app')!
    expect([m.ca, m.ce]).toEqual([2, 2])
    const text = sec.text()
    expect(text).toContain('扇入 Ca2')
    expect(text).toContain('扇出 Ce2')
    expect(text).toContain('不稳定度 I0.50')
    expect(text).toContain('居中')
    // 本层（根层）：依赖它的 infra 一个节点，它依赖的 domain、infra 两个节点
    expect(text).toContain('入 1 · 出 2')
    expect(text).toContain('依赖它最多')
    expect(text).toContain('Extra')
    // 交互视角没有这一节
    desk.setMode('interaction')
    await flushPromises()
    expect(wrapper.find('.module-structure').exists()).toBe(false)
  })

  it('影响面按距离分组、列模块与文件数，缺省只展开距离 1；切到依赖面、两者；「只看值依赖」去掉只引类型重算', async () => {
    const { wrapper } = await open('/?v=s&sel=m:app')
    const side = () => wrapper.findAll('.module-structure .side')
    expect(side()).toHaveLength(1)
    expect(side()[0].attributes('data-dir')).toBe('in')
    // 传入：Extra、SmImpl 距离 1；ModCore 经 Extra（只引类型）距离 2；PipeImpl 经 ModCore 距离 3
    expect(side()[0].text()).toContain('全系统 4 个模块')
    const groups = side()[0].findAll('details.dist')
    expect(groups.map(g => g.find('summary').text())).toEqual(['距离 1 · 2', '距离 2 · 1', '距离 3+ · 1'])
    expect(groups[0].attributes('open')).toBeDefined()
    expect(groups[1].attributes('open')).toBeUndefined()
    expect(groups[0].text()).toContain('1 个文件')
    // 依赖面
    await wrapper
      .findAll('.module-structure .segmented button')
      .find(b => b.text() === '依赖面')!
      .trigger('click')
    expect(side()[0].attributes('data-dir')).toBe('out')
    await wrapper
      .findAll('.module-structure .segmented button')
      .find(b => b.text() === '两者')!
      .trigger('click')
    expect(side().map(s => s.attributes('data-dir'))).toEqual(['in', 'out'])
    await wrapper
      .findAll('.module-structure .segmented button')
      .find(b => b.text() === '影响面')!
      .trigger('click')
    // 只看值依赖：只引类型的去掉后 ModCore、PipeImpl 不在影响面里，Ca 不变（Extra、SmImpl）
    await wrapper.find('.module-structure .values-only input').setValue(true)
    await flushPromises()
    expect(side()[0].text()).toContain('全系统 2 个模块')
    expect(side()[0].findAll('details.dist')).toHaveLength(1)
    // 偏好记在本机，画布与面板共用同一份
    expect(JSON.parse(localStorage.getItem('h5p-arch-desk:structure-prefs:')!)).toMatchObject({ impactMode: 'in', valuesOnly: true })
  })

  it('交互图互查：有交互、两端之间没有任何依赖的关系（K6）列出，单击切到交互视角并选中它', async () => {
    const { wrapper, desk } = await open('/?v=s&sel=m:infra')
    const cross = wrapper.find('.module-structure [aria-label="交互图互查"]')
    // r6：StateMachine → Pipeline，两端（SmImpl、PipeImpl）之间没有依赖
    const item = cross.findAll('.cross-item').find(b => b.text() === 'StateMachine → Pipeline')!
    expect(item).toBeDefined()
    expect(desk.facts.relationFact('r6')).toMatchObject({ status: 'unconfirmed', isolated: true })
    // r1 有依赖撑着，不列
    expect(cross.text()).not.toContain('StateMachine → Solution')
    await item.trigger('click')
    await flushPromises()
    expect(desk.perspective.value).toBe('interaction')
    expect(desk.selection.value).toEqual({ kind: 'relation', id: 'r6' })
  })

  it('U17：稳定的模块依赖了更易变的，给出「逆稳定」提示行', async () => {
    // ModCore：入 SolCore、PipeImpl、SmImpl，出 Extra → I 0.25；Extra：入 ModCore，出 SolCore、PipeImpl → I 0.67
    const { wrapper, desk } = await open('/?v=s&level=domain&sel=m:domain.models.core')
    expect(desk.facts.metrics.value!.get('domain.models.core')!.instability).toBe(0.25)
    const note = wrapper.find('.module-structure .against')
    expect(note.text()).toContain('逆稳定')
    expect(note.text()).toContain('Extra（I 0.67）')
    // 不稳定的一端没有提示
    const other = await open('/?v=s&level=infra.framework&sel=m:infra.framework.extra')
    expect(other.wrapper.find('.module-structure .against').exists()).toBe(false)
  })

  it('没有代码事实（设计版本 / 源码不可用）时只说明原因', async () => {
    const { wrapper } = await open('/?v=s&sel=m:app', { facts: false })
    expect(wrapper.find('.module-structure').text()).toContain('没有代码事实')
    expect(wrapper.find('.module-structure .side').exists()).toBe(false)
  })
})

describe('依赖边面板（结构视角 sel=d:）', () => {
  it('违规的依赖边：种类与档、文件依赖条数与清单、未解释、违规判定、两端 I', async () => {
    const { wrapper } = await open('/?v=s&sel=d:app->infra')
    expect(wrapper.find('.dep-panel .badges').text()).toContain('依赖边')
    const rows = wrapper.findAll('.dep-structure .edge-row')
    expect(rows.map(r => r.attributes('data-kind'))).toEqual(['dependency'])
    expect(rows[0].text()).toContain('交互使用')
    expect(rows[0].text()).toContain('未解释')
    expect(rows[0].text()).toContain('文件依赖 1 条 · 模块依赖 1 条')
    expect(rows[0].text()).toContain('src/app/s.ts:9')
    expect(wrapper.find('.dep-coverage').text()).toContain('没有交互覆盖它')
    expect(wrapper.find('.dep-ruling').text()).toContain('违规')
    expect(wrapper.find('.dep-ruling').text()).toContain('无基线')
    expect(wrapper.find('.dep-stability').text()).toMatch(/Application\s*I 0\.50/)
  })

  it('允许的依赖边：交互覆盖明细可单击切到交互视角并选中，允许它的规则写明', async () => {
    const { wrapper, desk } = await open('/?v=s&sel=d:infra->app')
    const cover = wrapper.find('.dep-coverage')
    expect(cover.find('h3').text()).toContain('1')
    expect(cover.text()).toContain('端口实现者 0 · 子类 0 · 组装 0')
    expect(wrapper.find('.dep-ruling').text()).toContain('允许')
    expect(wrapper.find('.dep-ruling').text()).toContain('层规则：「Infrastructure」可依赖')
    await cover.find('.cover-rel').trigger('click')
    await flushPromises()
    expect(desk.perspective.value).toBe('interaction')
    expect(desk.selection.value).toEqual({ kind: 'relation', id: 'r1' })
  })

  it('只引类型与值使用的依赖边：档分别为只引类型 / 值使用，覆盖为 0 不标未解释', async () => {
    const t = await open('/?v=s&sel=d:domain->infra')
    expect(t.wrapper.find('.dep-structure .badge.tier').text()).toBe('只引类型')
    expect(t.wrapper.find('.dep-structure').text()).not.toContain('未解释')
    expect(t.wrapper.find('.dep-coverage').text()).toContain('正常的知识依赖')
    expect(t.wrapper.find('.dep-ruling').text()).toContain('无约束')
    const v = await open('/?v=s&sel=d:app->domain')
    expect(v.wrapper.find('.dep-structure .badge.tier').text()).toBe('值使用')
  })

  it('交互视角选中代码依赖：仍是原来的代码依赖面板，没有结构边一节', async () => {
    const { wrapper } = await open('/?sel=d:app->infra')
    expect(wrapper.find('.dep-panel .badges').text()).toContain('代码依赖')
    expect(wrapper.find('.dep-structure').exists()).toBe(false)
  })
})

describe('V12：被清空的选中', () => {
  it('关系切到结构视角没有对应的依赖边：面板顶部说明，下一次动作即收回', async () => {
    const { wrapper, desk } = await open('/?sel=r:r6&level=infra.framework')
    desk.setMode('structure')
    await flushPromises()
    expect(desk.selection.value).toBeNull()
    expect(wrapper.find('.dropped').text()).toContain('切换视角后原选中（关系 StateMachine → Pipeline）没有对应的依赖边')
    desk.select({ kind: 'module', id: 'infra.framework.sm' })
    await flushPromises()
    expect(wrapper.find('.dropped').exists()).toBe(false)
  })
})

describe('D-25：步骤的包含链', () => {
  const { index } = loadModel(scenarioFiles({ 'x.yaml': 'relations: [{ id: rb, from: infra.player, to: app.solution, type: notifies, via: "channel:http" }]' }))
  const dep: ModuleDep = { key: 'a->b', from: 'infra.framework.sm', to: 'app.solution', files: [invoke('src/sm/a.ts', 'src/app/s.ts', 5)] } as ModuleDep

  it('三级都在：交互与依赖（文件:行在面板上可预览）', () => {
    const c = stepChain(index, { relation: 'r1', relationInferred: false }, { status: 'confirmed', deps: [dep] })
    expect(c.interaction).toMatchObject({ state: 'ok', relation: 'r1' })
    expect(c.interaction.text).toContain('StateMachine → Solution')
    expect(c.dependency).toMatchObject({ state: 'ok', text: 'StateMachine → Solution · 1 处' })
  })

  it('未绑定交互：交互一级缺，依赖一级不适用', () => {
    const c = stepChain(index, { relationInferred: false }, null)
    expect(c.interaction).toMatchObject({ state: 'missing', text: '未绑定交互（交互中未建模）' })
    expect(c.dependency.state).toBe('na')
  })

  it('交互未证实：依赖一级缺', () => {
    const c = stepChain(index, { relation: 'r6', relationInferred: true }, { status: 'unconfirmed', deps: [], isolated: true })
    expect(c.interaction.text).toContain('（推断）')
    expect(c.dependency).toMatchObject({ state: 'missing' })
    expect(c.dependency.text).toContain('交互未证实')
  })

  it('经总线或通道：不判定', () => {
    const c = stepChain(index, { relation: 'rb', relationInferred: false }, { status: 'skipped', deps: [], via: 'channel:http' })
    expect(c.dependency.state).toBe('skipped')
    expect(c.dependency.text).toMatch(/^经 .+，越过导入图，不判定$/)
  })

  it('步骤面板「代码证据」一节在证据等级之上列包含链', async () => {
    const { wrapper } = await open('/?sc=sc.play&step=sc.play%23update&alt=0')
    const chain = wrapper.find('[aria-label="包含链"]')
    expect(chain.exists()).toBe(true)
    const section = chain.element.closest('section')!
    expect([...section.children].indexOf(chain.element)).toBeLessThan([...section.children].indexOf(section.querySelector('.evidence-level')!))
    expect(chain.text()).toContain('这一步')
    expect(chain.find('.link-dependency').text()).toContain('交互未证实')
    // 附录 B：步骤面板的折叠节改名
    expect(wrapper.text()).toContain('交互关系')
    expect(wrapper.text()).not.toContain('结构关系')
  })
})
