// @vitest-environment jsdom
/**
 * 面板信息骨架（G11，ADR-0050）：V15 五段段序与视角敏感段、V15a 头部徽标槽位表、V15b ③ 需要注意、V15c ④ 出入边汇总与 ⑤ 折叠带计数。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import Panel from '../../src/components/panel/Panel.vue'
import { createDeskState } from '../../src/state/useDeskState'
import { DESK_STATE } from '../../src/state/inject'
import { orderNotices, splitSignalCount, typeSummary, type PanelNotice } from '../../src/components/panel/panelNotices'
import { sampleFiles, scenarioFiles } from '../fixtures/sample'
import type { FileDep } from '../../src/model'

/** 跳转目标是模块级的单值：测试里每个用例结束卸载面板，免得早先面板的监听先消费掉目标 */
const mounted: VueWrapper[] = []

async function mountPanel(url: string, files = sampleFiles()) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => ({ dir: 'model/test', files }))
  desk.attachRouter(router)
  await desk.init()
  const wrapper = mount(Panel, { global: { provide: { [DESK_STATE as symbol]: desk }, plugins: [router] } })
  mounted.push(wrapper)
  await flushPromises()
  return { wrapper, desk }
}

/** 模块面板的直接子节，按出现次序给出标题文字（折叠节含 ▸ 与计数） */
const titlesOf = (wrapper: VueWrapper) => wrapper.findAll('.module-panel > .section').map(s => s.find('h3')!.text())

/** 带代码事实源的面板挂载（G11 波 2 铺开的 ③/⑤ 断言需要 facts） */
async function mountWithSource(
  url: string,
  source: Record<string, unknown>,
  files = sampleFiles(),
): Promise<{ wrapper: VueWrapper; desk: ReturnType<typeof createDeskState> }> {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => ({ dir: 'model/test', files }), { source: source as never })
  desk.attachRouter(router)
  await desk.init()
  const wrapper = mount(Panel, { global: { provide: { [DESK_STATE as symbol]: desk }, plugins: [router] } })
  mounted.push(wrapper)
  await flushPromises()
  return { wrapper, desk }
}

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
})

describe('V15：五段段序', () => {
  it('② 说明在最前，层的「可依赖的层」跟在其后；③ 无异常不出现；⑤ 折叠节在 ④ 之后，footer 最底', async () => {
    const { wrapper } = await mountPanel('/?sel=m:infra')
    const titles = titlesOf(wrapper)
    expect(titles[0]).toContain('说明')
    expect(titles[1]).toContain('可依赖的层')
    expect(titles.join('|')).not.toContain('需要注意')
    // ④：本层模块在 ② 之后
    const boundary = titles.findIndex(t => t.includes('本层模块'))
    expect(boundary).toBeGreaterThan(1)
    // ⑤：折叠节（确认）在 ④ 之后；出处 footer 是最后一个元素
    const secs = wrapper.findAll('.module-panel > .section')
    const confirmSec = secs.find(x => x.find('button.fold').exists() && x.find('button.fold').text().includes('确认'))
    expect(confirmSec).toBeTruthy()
    expect(secs.indexOf(confirmSec!)).toBeGreaterThan(boundary)
    const kids = wrapper.find('.module-panel').element.children
    expect(kids[kids.length - 1].classList.contains('src')).toBe(true)
  })

  it('交互视角 ④ 没有「结构 / 表面」；结构视角 ④ 在端口之后是结构、表面', async () => {
    const files = sampleFiles({
      'modules/zz-facts.yaml':
        'modules:\n  - { id: infra.framework.extra, parent: infra.framework, name: Extra, responsibility: x, codeRefs: [src/framework/**] }\n  - { id: app.solution.core, parent: app.solution, name: Core, responsibility: x, codeRefs: [src/app/**] }',
    })
    const dep = (from: string, to: string): FileDep => ({ from, to, via: to, kind: 'value', line: 1, uses: true, invokes: true })
    const source = {
      tree: async () => ({ status: 'local', root: '/repo', files: ['src/app/s.ts', 'src/framework/e.ts'], packages: {} }),
      file: async () => null,
      exports: async () => [],
      facts: async () => ({ deps: { deps: [dep('src/framework/e.ts', 'src/app/s.ts')], external: {}, parsed: 2 }, baseline: null, ledger: [] }),
    } as never
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
    await router.push('/?v=s&sel=m:app.solution')
    const desk = createDeskState(async () => ({ dir: 'model/test', files }), { source })
    desk.attachRouter(router)
    await desk.init()
    await flushPromises()
    const wrapper = mount(Panel, { global: { provide: { [DESK_STATE as symbol]: desk }, plugins: [router] } })
    mounted.push(wrapper)
    await flushPromises()
    const titles = titlesOf(wrapper)
    // ④ 段内：结构指标与影响面、表面贴在结构块首（端口之后）；样例模块没有入口，表面节不出现
    const ports = titles.findIndex(t => t.includes('端口'))
    const structure = titles.findIndex(t => t.startsWith('结构'))
    expect(structure).toBeGreaterThan(ports)
    // 切到交互视角：结构消失（④ 视角敏感）
    desk.setMode('interaction')
    await flushPromises()
    const after = titlesOf(wrapper).join('|')
    expect(after).not.toContain('结构')
  })
})

describe('V15a：① 头部徽标槽位表', () => {
  it('槽位次序 ID → 类别 → 状态 → 核心 → 标签 → 变更 → 确认；标签超过 2 个收「+N」，悬停看全量、单击展开', async () => {
    const files = sampleFiles({
      'modules/zz-tags.yaml':
        'modules:\n  - { id: app.tagged, parent: app, kind: subsystem, name: Tagged, role: core, status: target, responsibility: x, tags: [核心链路, 高频, 易变] }',
    })
    const { wrapper } = await mountPanel('/?sel=m:app.tagged', files)
    const badges = wrapper.findAll('.module-panel .head .badges > *')
    const texts = badges.map(b => b.text())
    expect(texts[0]).toBe('app.tagged')
    expect(texts[1]).toBe('subsystem')
    expect(texts[2]).toBe('目标态')
    expect(texts[3]).toBe('核心')
    expect(texts[4]).toBe('核心链路')
    expect(texts[5]).toBe('高频')
    expect(texts[6]).toBe('+1')
    expect(texts).toContain('未确认')
    expect(texts.indexOf('未确认')).toBeGreaterThan(texts.indexOf('+1'))
    // 悬停看全量、单击展开
    expect(badges[6].attributes('title')).toBe('易变')
    await badges[6].trigger('click')
    expect(wrapper.findAll('.module-panel .head .badges > *').map(b => b.text())).toEqual(expect.arrayContaining(['易变', '收起']))
  })

  it('变更槽在标签槽之后、确认徽标之前（评审轮 1 B3）：设计版本相对基线改了职责时「修改」徽标落在 +N 与确认徽标之间', async () => {
    const TAGS =
      'modules:\n  - { id: app.tagged, parent: app, kind: subsystem, name: Tagged, role: core, status: target, responsibility: x, tags: [核心链路, 高频, 易变] }'
    const base = sampleFiles({ 'modules/zz-tags.yaml': TAGS })
    // 设计版本的描述相对基线改了 app.tagged 的职责一行 → 头部「变更」槽亮起
    const design = sampleFiles({ 'modules/zz-tags.yaml': TAGS.replace('responsibility: x', 'responsibility: y') })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
    await router.push('/?sel=m:app.tagged')
    const desk = createDeskState(
      async () => ({
        dir: 'model/test',
        files: design,
        designs: [{ id: 'd', name: 'D', status: 'reviewing', revisions: [{ id: 'r1' }], problems: [] }],
        version: { design: 'd', revision: 'r1' },
        compare: { current: { label: '当前版本', dir: 'model/base', files: base } },
      }),
      { project: 'test', version: { design: 'd', revision: 'r1' } },
    )
    desk.attachRouter(router)
    await desk.init()
    const wrapper = mount(Panel, { global: { provide: { [DESK_STATE as symbol]: desk }, plugins: [router] } })
    mounted.push(wrapper)
    await flushPromises()
    const texts = wrapper.findAll('.module-panel .head .badges > *').map(b => b.text())
    expect(texts).toContain('修改')
    expect(texts.indexOf('修改')).toBeGreaterThan(texts.indexOf('+1'))
    expect(texts.indexOf('未确认')).toBeGreaterThan(texts.indexOf('修改'))
  })
})

describe('V15b：③ 需要注意', () => {
  const REFS = `
modules:
  - { id: app.solution.core, parent: app.solution, name: Core, responsibility: x, codeRefs: [src/app/**] }
  - { id: infra.framework.extra, parent: infra.framework, name: Extra, responsibility: x, codeRefs: [src/framework/**] }
`
  const dep = (from: string, to: string): FileDep => ({ from, to, via: to, kind: 'value', line: 7 })
  const source = {
    tree: async () => ({ status: 'local', root: '/repo', files: ['src/app/s.ts', 'src/framework/extra.ts'], packages: {} }),
    file: async () => null,
    exports: async () => [],
    facts: async () => ({
      deps: { deps: [dep('src/app/s.ts', 'src/framework/extra.ts'), dep('src/framework/extra.ts', 'src/app/s.ts')], external: {}, parsed: 2 },
      baseline: null,
      ledger: [],
    }),
  } as never

  async function openWithFacts(url: string, extra: Record<string, string> = {}) {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
    await router.push(url)
    const desk = createDeskState(
      async () => ({
        dir: 'model/test',
        files: [...sampleFiles({ 'modules/zz-refs.yaml': REFS }), ...Object.entries(extra).map(([path, text]) => ({ path, text }))],
      }),
      { source },
    )
    desk.attachRouter(router)
    await desk.init()
    await flushPromises()
    const wrapper = mount(Panel, { global: { provide: { [DESK_STATE as symbol]: desk }, plugins: [router] } })
    mounted.push(wrapper)
    await flushPromises()
    return { wrapper, desk }
  }

  it('每类异常一行、带计数，按严重度排序；单击跳到对应节——折叠节自动展开（架构治理、确认改动）', async () => {
    const REVIEWED = `reviewed:\n  - { module: infra, at: '2026-10-20', hash: stale, source: manual }\n`
    const { wrapper } = await openWithFacts('/?v=s&sel=m:infra', { 'reviewed.yaml': REVIEWED })
    const rows = wrapper.findAll('.notice-sec .notice')
    const keys = rows.map(r => r.attributes('data-notice'))
    expect(keys).toContain('violations')
    expect(keys).toContain('cycles')
    expect(keys).toContain('stale')
    // 严重度：违规、环在最前，确认过期在其后（V15b 排序）
    expect(keys.indexOf('violations')).toBeLessThan(keys.indexOf('stale'))
    expect(rows[0].attributes('data-notice')).toBe('violations')
    // 审核轮 2 B1：「违规」行的计数口径在悬停写明——治理信号（含基线内已知），不是门禁红（U8），也不含返工清单的 info 级（K24）
    expect(rows[0].attributes('title')).toContain('门禁卡的是基线外的新增')
    expect(rows[0].attributes('title')).toContain('返工清单的 info 级提示（K24 层符合性）不在此计数')
    // 其余行没有口径说明时悬停仍是跳转提示
    const staleRow = rows.find(r => r.attributes('data-notice') === 'stale')!
    expect(staleRow.attributes('title')).toBe('跳到「自上次确认以来的改动」')
    // 单击「确认过期」：⑤ 的「自上次确认以来的改动」折叠节自动展开
    const diffFold = wrapper.find('[data-sec="review.diff"] .fold')
    expect(diffFold.attributes('aria-expanded')).toBe('false')
    await wrapper.find('.notice-sec [data-notice="stale"]').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(wrapper.find('[data-sec="review.diff"] .fold').attributes('aria-expanded')).toBe('true')
    // 单击「违规」：架构治理折叠节自动展开（展开后重渲染换了节点，重新取行）
    await wrapper.find('.notice-sec [data-notice="violations"]').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(wrapper.find('[data-sec="evidence.governance"] .fold').attributes('aria-expanded')).toBe('true')
  })

  it('无异常时整段不出现（没有代码事实的样例面板没有 ③）', async () => {
    const { wrapper } = await mountPanel('/?sel=m:infra')
    expect(wrapper.find('.notice-sec').exists()).toBe(false)
  })

  it('模块环与本层环各自一行、各自计数（评审轮 1 A2）：样例事实两类环同时存在，③ 出两行', async () => {
    const { wrapper } = await openWithFacts('/?v=s&sel=m:infra')
    const rows = wrapper.findAll('.notice-sec .notice')
    const cyclesRow = rows.find(r => r.attributes('data-notice') === 'cycles')
    const levelRow = rows.find(r => r.attributes('data-notice') === 'levelCycles')
    expect(cyclesRow).toBeTruthy()
    expect(levelRow).toBeTruthy()
    // 计数各来自自己的派生：模块环 = moduleDetail().cycles 的环数（1 个），本层环 = selectedCycle 有即 1
    expect(cyclesRow!.text()).toContain('模块环 1')
    expect(levelRow!.text()).toContain('本层环 1')
    // 两行都跳「架构治理」
    expect(cyclesRow!.text()).toContain('架构治理')
    expect(levelRow!.text()).toContain('架构治理')
  })
})

describe('V15c：④ 汇总与 ⑤ 折叠', () => {
  it('出边先按类型汇总一行（只列非零类型），展开才逐条；RelationRow 的跨层定位保留', async () => {
    const files = sampleFiles({
      'zz-rel.yaml':
        'relations:\n  - { id: rq, from: infra.framework.sm, to: infra.mus, type: queries }\n  - { id: rn, from: infra.framework.sm, to: domain.services, type: notifies }',
    })
    const { wrapper, desk } = await mountPanel('/?level=infra.framework&sel=m:infra.framework.sm', files)
    const group = wrapper.find('[data-sec="boundary.edges-out"] details.rel-group')
    expect(group.find('summary').text()).toContain('未分类 2')
    expect(group.find('summary').text()).toContain('查询 1')
    expect(group.find('summary').text()).toContain('通知 1')
    // 缺省收起：展开才逐条（ RelationRow 在 details 里，单击后可跨层定位）
    expect(group.attributes('open')).toBeUndefined()
    await group.find('summary').trigger('click')
    const rows = group.findAll('.rel-row')
    expect(rows.length).toBe(4)
    await rows[0].find('.link').trigger('click')
    expect(desk.selection.value).toEqual({ kind: 'relation', id: 'r1' })
  })

  it('⑤ 折叠带计数、count 为 0 的节不出现', async () => {
    const { wrapper } = await mountPanel('/?sel=m:infra')
    const folds = wrapper.findAll('.module-panel > .section button.fold').map(f => f.text())
    expect(folds.some(t => t.includes('确认'))).toBe(true)
    expect(folds.join('|')).not.toContain('核心数据结构')
    expect(wrapper.find('[data-testid="split-signals"]').exists()).toBe(false)
    expect(wrapper.find('.module-panel > .section button.fold[aria-expanded="true"]').exists()).toBe(false)
  })

  it('运行视角下 ⑤ 的折叠由外层「模块信息」details 代行（评审轮 1 B1）：外层展开即内层全展开，结构视角仍折叠', async () => {
    // 运行视角：打开场景 + 选中模块 → 运行信息在上、模块信息 details 折叠在下（V6）
    const run = await mountPanel('/?sc=sc.play&sel=m:infra', scenarioFiles())
    const outer = run.wrapper.find('details.structure')
    expect(outer.exists()).toBe(true)
    expect(outer.attributes('open')).toBeUndefined()
    // 内层不再叠加折叠：⑤ 各节没有折叠按钮（外层展开即全展开）
    expect(outer.findAll('h3 .fold').length).toBe(0)
    // 对照：结构视角没有外层 details，⑤ 仍缺省折叠
    const structure = await mountPanel('/?v=s&sel=m:infra')
    expect(structure.wrapper.find('details.structure').exists()).toBe(false)
    expect(structure.wrapper.findAll('.module-panel > .section h3 .fold').length).toBeGreaterThan(0)
  })
})

describe('V15 波 2 铺开：其余面板的段序（G11）', () => {
  /** K6 用：两端各一个子模块、一对文件依赖；deps 参数决定证实状态 */
  const REFS = `
modules:
  - { id: infra.framework.sm.impl, parent: infra.framework.sm, name: SmImpl, responsibility: x, codeRefs: [src/sm/**] }
  - { id: infra.framework.pipeline.impl, parent: infra.framework.pipeline, name: PipeImpl, responsibility: x, codeRefs: [src/pipe/**] }
`
  const dep = (from: string, to: string): FileDep => ({ from, to, via: to, kind: 'value', line: 7 })
  const sourceWith = (deps: FileDep[], files = ['src/sm/a.ts', 'src/pipe/b.ts']) =>
    ({
      tree: async () => ({ status: 'local', root: '/repo', files, packages: {} }),
      file: async () => null,
      exports: async () => [],
      facts: async () => ({ deps: { deps, external: {}, parsed: files.length }, baseline: null, ledger: [] }),
    }) as never

  it('关系面板：② 说明置顶 → ③ 需要注意 → ④ 关系维度 / 经由接口 / 数据结构 → ⑤ 代码事实；未证实行（K6）单击跳到代码事实', async () => {
    // r6 两端之间没有依赖 → isolated，未证实（K6）
    const { wrapper } = await mountWithSource('/?level=infra.framework&sel=r:r6', sourceWith([]), [
      ...sampleFiles(),
      { path: 'modules/zz-refs.yaml', text: REFS },
    ])
    const cls = (x: Element) => x.getAttribute('class') ?? ''
    const order = [...(wrapper.find('.relation-panel').element as HTMLElement).children].map(cls)
    expect(order.some(c => c.includes('no-summary'))).toBe(true) // 未写说明（② 的空态在同一位置）
    // 段序：③ 需要注意在 ④「关系」维度节之前；出处 footer 最底
    const secs = wrapper.findAll('.relation-panel > .section')
    const titles = secs.map(s => s.find('h3')!.text())
    expect(titles[0]).toContain('需要注意')
    expect(titles[1]).toContain('关系')
    expect(wrapper.find('.relation-panel > .src').exists()).toBe(true)
    // 未证实行 → 单击跳到 ⑤ 代码事实（isolated 没有文件证据：折叠必有计数，没有可计的物就不折，一行判定常显）
    expect(wrapper.find('[data-sec="evidence.fact"] .fold').exists()).toBe(false)
    expect(wrapper.find('[data-sec="evidence.fact"]').text()).toContain('两端之间在代码里没有任何依赖')
    await wrapper.find('[data-notice="unconfirmed"]').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(wrapper.find('[data-sec="evidence.fact"]').classes()).toContain('jump-flash')
  })

  it('关系面板：已证实且有文件证据时代码事实缺省折叠带计数（V15c），展开见「已证实」', async () => {
    const { wrapper } = await mountWithSource('/?level=infra.framework&sel=r:r6', sourceWith([dep('src/sm/a.ts', 'src/pipe/b.ts')]), [
      ...sampleFiles(),
      { path: 'modules/zz-refs.yaml', text: REFS },
    ])
    const fold = wrapper.find('[data-sec="evidence.fact"] .fold')
    expect(fold.exists()).toBe(true)
    expect(fold.text()).toContain('代码事实')
    expect(fold.text()).toMatch(/代码事实\s*1/)
    expect(fold.attributes('aria-expanded')).toBe('false')
    await fold.trigger('click')
    expect(wrapper.find('[data-sec="evidence.fact"]').text()).toContain('已证实')
  })

  it('聚合边面板：③「向上却不是控制反转」一行带计数、单击跳到 ④ 原始关系（K22）', async () => {
    const files = sampleFiles({ 'zz-up.yaml': 'relations:\n  - { id: r8, from: app.solution, to: infra.player, type: queries }' })
    const { wrapper } = await mountPanel('/?sel=e:app.solution->infra.player:queries', files)
    const notice = wrapper.find('[data-notice="upward"]')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('向上却不是控制反转')
    await notice.trigger('click')
    await flushPromises()
    await flushPromises()
    const target = wrapper.find('[data-sec="boundary.relations"]')
    expect(target.exists()).toBe(true)
    expect(target.classes()).toContain('jump-flash')
  })

  it('聚合边面板：向上的控制反转（有机制）是应有之义，只在头部注记、③ 不出现（V15b）', async () => {
    const files = sampleFiles({
      'zz-up.yaml': 'relations:\n  - { id: r8b, from: app.solution, to: infra.player, type: notifies, via: "channel:cb@app.solution" }',
    })
    const { wrapper } = await mountPanel('/?sel=e:app.solution->infra.player:notifies', files)
    expect(wrapper.find('[data-testid="upward-note"]').text()).toContain('控制反转')
    expect(wrapper.find('[data-notice="upward"]').exists()).toBe(false)
  })

  it('端口面板：「说明」在端口结构详情之前（「先答做什么」的铺开修正），出处最底', async () => {
    const files = sampleFiles({
      'zz-if.yaml':
        'interfaces:\n  - { id: if.io, name: IO, owner: app.solution, description: 对外入口, signature: "io(): void", implementedBy: [infra.player] }',
    })
    const { wrapper } = await mountPanel('/?sel=p:if.io', files)
    // ② 说明（purpose）在 ④ 端口结构（boundary.port）之前，footer 最底
    const order = [...wrapper.find('.port-panel').element.children]
    const purpose = order.findIndex(x => x.getAttribute?.('data-sec') === 'purpose')
    const port = order.findIndex(x => x.getAttribute?.('data-sec') === 'boundary.port')
    expect(purpose).toBeGreaterThan(-1)
    expect(port).toBeGreaterThan(purpose)
    expect(order[order.length - 1].classList.contains('src')).toBe(true)
  })

  it('代码依赖 / 依赖边面板：③ 违规行跳 ⑤ 违规明细（折叠带计数），④ DepStructure（结构视角）在前', async () => {
    const source = sourceWith(
      [dep('src/app/s.ts', 'src/framework/extra.ts'), dep('src/framework/extra.ts', 'src/app/s.ts')],
      ['src/app/s.ts', 'src/framework/extra.ts'],
    )
    const { wrapper } = await mountWithSource('/?v=s&sel=d:app->infra', source, [
      ...sampleFiles(),
      {
        path: 'modules/zz-refs.yaml',
        text: `
modules:
  - { id: app.solution.core, parent: app.solution, name: Core, responsibility: x, codeRefs: [src/app/**] }
  - { id: infra.framework.extra, parent: infra.framework, name: Extra, responsibility: x, codeRefs: [src/framework/**] }
`,
      },
    ])
    // ④ 边界在前：结构视角是 DepStructure（文件依赖等）
    expect(wrapper.find('[data-sec="boundary.deps"]').exists()).toBe(true)
    const notice = wrapper.find('.dep-panel [data-notice="violations"]')
    const fold = wrapper.find('[data-sec="evidence.violations"] .fold')
    if (fold.exists()) {
      // 有违规：③ 一行带计数、明细缺省折叠；单击 ③ 折叠自动展开
      expect(notice.exists()).toBe(true)
      expect(fold.attributes('aria-expanded')).toBe('false')
      await notice.trigger('click')
      await flushPromises()
      await flushPromises()
      expect(wrapper.find('[data-sec="evidence.violations"] .fold').attributes('aria-expanded')).toBe('true')
    } else {
      // 样例规则对这对节点没有违规：③ 不出现（无异常不强造）
      expect(notice.exists()).toBe(false)
    }
  })

  it('参与者 / 场景面板：② 说明（触发）在前、④ 入口关系 / 场景与证据、⑤ 引用折叠带计数', async () => {
    const a = await mountPanel('/?sel=a:actor.biz', scenarioFiles())
    const aOrder = [...a.wrapper.find('.actor-panel').element.children]
    expect(aOrder.findIndex(x => x.getAttribute?.('data-sec') === 'purpose')).toBeGreaterThan(-1)
    expect(aOrder.findIndex(x => x.getAttribute?.('data-sec') === 'boundary.relations')).toBeGreaterThan(
      aOrder.findIndex(x => x.getAttribute?.('data-sec') === 'purpose'),
    )
    expect(aOrder[aOrder.length - 1].classList.contains('src')).toBe(true)

    const s = await mountPanel('/?sc=sc.play', scenarioFiles())
    const refsSec = s.wrapper.find('[data-sec="evidence.refs"]')
    expect(refsSec.exists()).toBe(true)
    // 运行视角 ⑤ 的折叠由外层「模块信息」details 代行（评审轮 1 B1）：标题带计数、内容直接可见
    expect(refsSec.find('h3').text()).toMatch(/引用\s*\d/)
    expect(refsSec.text()).toContain('引用了')
    // ④ 证据保持常显带计数
    expect(s.wrapper.find('[data-sec="boundary.evidence"] .fold').exists()).toBe(false)
  })
})

describe('V15b、V15c 的纯函数', () => {
  it('orderNotices 过滤零计数并按严重度排序；关系级与边级信号（缺段、向上）归入对应档（波 2 铺开）', () => {
    const n = (key: PanelNotice['key'], count: number): PanelNotice => ({ key, label: key, count, target: 'x', to: 'y' })
    expect(
      orderNotices([n('stale', 2), n('surface', 0), n('violations', 1), n('against', 3), n('undescribed', 1), n('levelCycles', 1), n('cycles', 1)]).map(
        x => x.key,
      ),
    ).toEqual(['violations', 'cycles', 'levelCycles', 'undescribed', 'stale', 'against'])
    // 向上却不是控制反转（K22）与违规同档（违背分层）；缺段（K20）与未证实同档，同档按 label 次序
    expect(orderNotices([n('unconfirmed', 1), n('carrierGap', 2), n('upward', 1), n('stale', 1)]).map(x => x.key)).toEqual([
      'upward',
      'carrierGap',
      'unconfirmed',
      'stale',
    ])
  })

  it('splitSignalCount 与「拆分信号」清单同一口径', () => {
    const s = {
      noFiles: true,
      shared: [{ file: 'a', modules: ['x', 'y'] }],
      children: { noFiles: ['c1'], shared: [{ file: 'b', modules: ['c1', 'c2'] }] },
      noDeps: false,
      undepended: [
        { from: 'a', to: 'b' },
        { from: 'c', to: 'd' },
      ],
    }
    expect(splitSignalCount(s, 3)).toBe(7)
    expect(splitSignalCount(s, 0)).toBe(6)
    expect(splitSignalCount(null, 3)).toBe(0)
  })

  it('typeSummary 只列非零类型、按登记次序', () => {
    const of = (id: string) =>
      id === 'a' ? { type: 'queries' as const } : id === 'b' ? { type: 'notifies' as const } : id === 'c' ? { type: 'queries' as const } : undefined
    expect(typeSummary(of, ['a', 'b', 'c', 'missing'])).toEqual([
      { type: 'queries', label: '查询', n: 2 },
      { type: 'notifies', label: '通知', n: 1 },
    ])
  })
})
