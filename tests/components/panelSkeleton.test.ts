// @vitest-environment jsdom
/**
 * 属性栏三卡（ADR-0053）：V15 头部 + 理解 · 核对 · 相关资料、V15a 头部徽标槽位表、V15b 核对卡的分项、V15c 核对卡的清单；
 * PC-1–PC-10（三卡骨架、展开、五问、协作、悬停、六行、异常平铺、清单、相关资料、其他对象）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import Panel from '../../src/components/panel/Panel.vue'
import ScenarioPanel from '../../src/components/panel/ScenarioPanel.vue'
import ModuleDoc from '../../src/components/dock/ModuleDoc.vue'
import { createDeskState } from '../../src/state/useDeskState'
import { DESK_STATE } from '../../src/state/inject'
import { orderNotices, splitSignalCount, type PanelNotice } from '../../src/components/panel/panelNotices'
import { checkSummary, moduleCheckRows, rowsFromNotices, type CheckRow } from '../../src/components/panel/panelCheck'
import { useRelationHover } from '../../src/components/panel/surfaceFocus'
import { sampleFiles, scenarioFiles } from '../fixtures/sample'
import type { FileDep } from '../../src/model'

/** 跳转目标是模块级的单值：测试里每个用例结束卸载面板，免得早先面板的监听先消费掉目标 */
const mounted: VueWrapper[] = []

/** 第二十轮读先方案：理解卡搬去辅助栏的理解页（ModuleDoc = 事实卡 + 故事）；理解叙述的断言挂这里 */
async function mountDoc(moduleId: string, url: string, files = sampleFiles(), provide: Record<string | symbol, unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => ({ dir: 'model/test', files }))
  desk.attachRouter(router)
  await desk.init()
  const wrapper = mount(ModuleDoc, { props: { module: moduleId }, global: { provide: { [DESK_STATE as symbol]: desk, ...provide }, plugins: [router] } })
  mounted.push(wrapper)
  await flushPromises()
  return { wrapper, desk }
}

async function mountPanel(url: string, files = sampleFiles(), provide: Record<string | symbol, unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => ({ dir: 'model/test', files }))
  desk.attachRouter(router)
  await desk.init()
  const wrapper = mount(Panel, { global: { provide: { [DESK_STATE as symbol]: desk, ...provide }, plugins: [router] } })
  mounted.push(wrapper)
  await flushPromises()
  return { wrapper, desk }
}

/** 卡片次序（data-card） */
const cardsOf = (wrapper: VueWrapper) => wrapper.findAll('.card').map(c => c.attributes('data-card'))
/** 展开核对卡（已展开时不动） */
async function openCheck(wrapper: VueWrapper) {
  const t = wrapper.find('[data-card="check"] .card-toggle')
  if (t.attributes('aria-expanded') === 'false') await t.trigger('click')
}
/** 核对卡清单的标题（折叠节含 ▸ 与计数） */
const listsOf = (wrapper: VueWrapper) => wrapper.findAll('[data-card="check"] .lists .section h3').map(h => h.text())

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

describe('V15、PC-1：头部 + 三卡', () => {
  it('模块：头部在最前，其后核对卡（理解卡已搬去辅助栏的理解页，相关资料卡删除）；出处 footer 最底', async () => {
    const { wrapper } = await mountPanel('/?sel=m:infra')
    const kids = [...wrapper.find('.module-panel').element.children]
    expect(kids[0].tagName).toBe('HEADER')
    expect(cardsOf(wrapper)).toEqual(['check'])
    expect(kids[kids.length - 1].classList.contains('src')).toBe(true)
  })

  it('PC-9 已删（第二十轮读先方案）：抽屉没有相关资料卡——场景归运行视角，图解入口在理解页与画布 ▣', async () => {
    const { wrapper } = await mountPanel('/?level=infra.framework&sel=m:infra.framework.sm', scenarioFiles())
    expect(wrapper.find('[data-card="related"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="related"]').exists()).toBe(false)
  })
})

describe('PC-2：卡片的展开', () => {
  it('核对卡没有 ⚠ 时收起、可展开、卡头给结论；换选中即回缺省', async () => {
    const { wrapper, desk } = await mountPanel('/?sel=m:infra')
    const c = wrapper.find('[data-card="check"] .card-toggle')
    expect(c.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-card="check"] .card-sum').text()).toBe('暂无核对结果')
    await c.trigger('click')
    expect(wrapper.find('[data-card="check"] .card-body').exists()).toBe(true)
    desk.select({ kind: 'module', id: 'app' })
    await flushPromises()
    desk.select({ kind: 'module', id: 'infra' })
    await flushPromises()
    expect(wrapper.find('[data-card="check"] .card-toggle').attributes('aria-expanded')).toBe('false')
  })
})

describe('V15a：头部徽标槽位表', () => {
  it('槽位次序 ID → 类别 → 状态 → 核心 → 标签 → 变更；标签超过 2 个收「+N」；确认徽标不在头部（在核对卡的「确认」行）', async () => {
    const files = sampleFiles({
      'modules/zz-tags.yaml':
        'modules:\n  - { id: app.tagged, parent: app, kind: subsystem, name: Tagged, role: core, status: target, responsibility: x, tags: [核心链路, 高频, 易变] }',
    })
    const { wrapper } = await mountPanel('/?sel=m:app.tagged', files)
    const badges = wrapper.findAll('.module-panel .head .badges > *')
    expect(badges.map(b => b.text())).toEqual(['app.tagged', 'subsystem', '目标态', '核心', '核心链路', '高频', '+1'])
    expect(badges[6].attributes('title')).toBe('易变')
    await badges[6].trigger('click')
    expect(wrapper.findAll('.module-panel .head .badges > *').map(b => b.text())).toEqual(expect.arrayContaining(['易变', '收起']))
    await wrapper.find('[data-card="check"] .card-toggle').trigger('click')
    expect(wrapper.find('[data-check="review"]').text()).toContain('未确认')
  })

  it('变更槽在标签槽之后（评审轮 1 B3）：设计版本相对基线改了职责时「修改」徽标在 +N 之后', async () => {
    const TAGS =
      'modules:\n  - { id: app.tagged, parent: app, kind: subsystem, name: Tagged, role: core, status: target, responsibility: x, tags: [核心链路, 高频, 易变] }'
    const base = sampleFiles({ 'modules/zz-tags.yaml': TAGS })
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
    expect(texts.indexOf('修改')).toBeGreaterThan(texts.indexOf('+1'))
    expect(texts).not.toContain('未确认')
  })
})

const STRATA =
  'strata:\n  app:\n    - { id: top, name: 入口层, order: 1, asks: 从哪进来？, members: [app.solution], mayDependOn: [base] }\n    - { id: base, name: 基础层, order: 2, asks: 靠什么？, members: [app.fragments] }\n'

describe('PC-3：模块的理解卡按五问', () => {
  const BIG =
    'modules:\n' +
    '  - id: app.big\n' +
    '    parent: app\n' +
    '    name: Big\n' +
    '    responsibility: 编排一切。其余是细节\n' +
    '    summary: 编排方案的执行\n' +
    '    abstraction: 按阶段切分\n' +
    '    invariants: [{ text: 只经队列改状态, adr: 12 }, 不碰浏览器]\n' +
    '    provides: [if.f1, if.f2, if.f3, if.f4, if.f5, if.f6]\n' +
    '    children:\n' +
    ['一', '二', '三', '四', '五', '六', '七', '八'].map((n, i) => `      - { id: app.big.c${i + 1}, name: ${n}号, responsibility: 第${n}件事 }\n`).join('') +
    'interfaces:\n' +
    [1, 2, 3, 4, 5, 6].map(i => `  - { id: if.f${i}, name: F${i}, owner: app.big, signature: 'f${i}()', description: 第 ${i} 个能力。细节 }\n`).join('')
  const files = () => sampleFiles({ 'modules/zz-big.yaml': BIG })

  it('① 一句话职责粗体（写了 summary 不标待提炼），职责全文折叠在下；没写 summary 的标「待提炼」', async () => {
    const { wrapper } = await mountDoc('app.big', '/?sel=m:app.big', files())
    const one = wrapper.find('[data-testid="summary"]')
    expect(one.text()).toMatch(/^编排方案的执行\s*全文 ▸$/)
    expect(one.text()).not.toContain('待提炼')
    expect(wrapper.find('.full-text').exists()).toBe(false)
    await wrapper.find('.understand .full').trigger('click')
    expect(wrapper.find('.full-text').text()).toContain('编排一切')
    const other = await mountDoc('app.solution', '/?sel=m:app.solution')
    expect(other.wrapper.find('[data-testid="summary"]').text()).toContain('待提炼')
  })

  it('② 怎么分（ADR-0060）：原则全文不截；未声明分层的写明并只列子模块名（一句话在悬停、不在卡上）；⑤ 对外表面名字全文一行、用途在悬停，超过 5 个收「+N」，单击展开详情', async () => {
    const { wrapper } = await mountDoc('app.big', '/?sel=m:app.big', files())
    const split = wrapper.find('[data-sec="split"]')
    expect(split.find('.principle').text()).toContain('按阶段切分')
    expect(split.find('.principle').attributes('style') ?? '').not.toContain('line-clamp')
    expect(split.find('[data-testid="module-nostrata"]').text()).toContain('未声明分层 · 8 个子模块')
    const names = split.findAll('[data-testid="module-children"] .link').filter(l => !l.classes().includes('more'))
    expect(names).toHaveLength(8)
    expect(split.text()).not.toContain('第一件事')
    expect(names[0].attributes('title')).toContain('第一件事')
    const surface = wrapper.find('[data-sec="surface"]')
    const ifaces = surface.findAll('.ifaces .k')
    expect(ifaces).toHaveLength(5)
    expect(ifaces[0].attributes('title')).toContain('第 1 个能力')
    expect(surface.text()).not.toContain('第 1 个能力')
    expect(surface.find('.more').text()).toBe('+1')
    expect(surface.text()).not.toContain('f1()')
    await ifaces[0].trigger('click')
    expect(wrapper.find('[data-sec="surface"]').text()).toContain('f1()')
  })

  it('⑤ 守住什么：不变式逐条，带 adr 的附 ADR 编号（文件不在源码清单里时不可点）', async () => {
    const { wrapper } = await mountDoc('app.big', '/?sel=m:app.big', files())
    const inv = wrapper.find('[data-testid="invariants"]')
    expect(inv.findAll('li')).toHaveLength(2)
    expect(inv.text()).toContain('只经队列改状态')
    expect(inv.find('.adr').text()).toBe('ADR-0012')
    const plain = await mountDoc('app.solution', '/?sel=m:app.solution')
    expect(plain.wrapper.find('[data-sec="invariants"]').exists()).toBe(false)
  })

  it('② 声明了分层的模块按层列（层名 · 层的问题 · 归属），成员作链接；单成员层的模块：excludes 作「不负责」一行（M32），另有「层的问题与包含」折叠块与「可依赖」链接', async () => {
    const { wrapper, desk } = await mountDoc('app', '/?sel=m:app', sampleFiles({ 'intent/strata.yaml': STRATA }))
    const rows = wrapper.findAll('[data-testid="module-strata"] .stratum')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('入口层')
    expect(rows[0].text()).toContain('从哪进来？')
    await rows[0].find('.members .link').trigger('click')
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'app.solution' })
    const EXT = 'modules:\n  - { id: ext, name: Ext, kind: layer, order: 4, responsibility: x, includes: [适配器], excludes: [规则, 状态 → app] }\n'
    const layer = await mountDoc('ext', '/?sel=m:ext', sampleFiles({ 'modules/zz-ext.yaml': EXT }))
    // ADR-0060：否定边界一行，带去向的是链接
    const neg = layer.wrapper.find('[data-testid="excludes"]')
    expect(neg.text()).toMatch(/^规则 · 状态\s*→ Application$/)
    expect(layer.wrapper.find('.inc summary').text()).toBe('层的问题与包含 1')
    expect(layer.wrapper.find('[data-testid="layer-deps"]').text()).toContain('可依赖')
    // 去向是链接：单击选中去向模块（面板随之换成它的）
    await neg.find('.to').trigger('click')
    expect(layer.desk.selection.value).toEqual({ kind: 'module', id: 'app' })
  })
})

describe('PC-4、PC-5：协作', () => {
  const files = () =>
    sampleFiles({
      'zz-rel.yaml':
        'relations:\n  - { id: rq, from: infra.framework.sm, to: infra.mus, type: queries, purpose: 取媒体单元 }\n  - { id: rq2, from: infra.framework.pipeline, to: infra.mus, type: streams }',
    })

  it('缺省折叠为一行「← N · → M」（ADR-0060）；展开后按（方向，对端）合成一行：对端为画布上相邻的节点，多条标「×N」、类型在悬停，单击目的展开逐条；单击对端名选中对端', async () => {
    const { wrapper, desk } = await mountDoc('infra.framework', '/?level=infra&sel=m:infra.framework', files())
    const fold = wrapper.find('[data-testid="collab-fold"]')
    expect(fold.text()).toMatch(/协作\s*2\s*← 0 · → 2/)
    expect(wrapper.find('[data-testid="collab"]').exists()).toBe(false)
    await fold.trigger('click')
    const rows = wrapper.findAll('[data-testid="collab"] .co')
    expect(rows.map(r => r.attributes('data-peer'))).toEqual(['app', 'infra.mus'])
    const mus = rows[1]
    expect(mus.find('.dir').text()).toBe('→')
    expect(mus.find('.n').text()).toBe('×3')
    expect(mus.attributes('data-types')).toBe('streams queries')
    expect(mus.find('.line').attributes('title')).toContain('流、查询 ×3')
    expect(mus.find('.each').exists()).toBe(false)
    await mus.find('.why').trigger('click')
    expect(wrapper.findAll('[data-peer="infra.mus"] .rel-row')).toHaveLength(3)
    // 展开后逐条带目的（写了 purpose 的）
    expect(wrapper.find('[data-peer="infra.mus"] .each').text()).toContain('取媒体单元')
    await wrapper.find('[data-peer="app"] .peer').trigger('click')
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'app' })
  })

  it('悬停一行：写入悬停的关系（画布据此高亮承载它们的边，L25）；移开清空', async () => {
    const { wrapper } = await mountDoc('infra.framework', '/?level=infra&sel=m:infra.framework', files())
    await wrapper.find('[data-testid="collab-fold"]').trigger('click')
    const hover = useRelationHover()
    await wrapper.find('[data-peer="infra.mus"]').trigger('mouseenter')
    expect(hover.value).toEqual(['r4', 'rq', 'rq2'])
    await wrapper.find('[data-peer="infra.mus"]').trigger('mouseleave')
    expect(hover.value).toBeNull()
  })
})

describe('V15b、PC-6、PC-7：核对卡的六行', () => {
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

  it('固定六行、次序不变；有 ⚠ 行时核对卡自动展开，卡头「⚠ N 项要看 · ✓ M 项正常」', async () => {
    const REVIEWED = `reviewed:\n  - { module: infra, at: '2026-10-20', hash: stale, source: manual }\n`
    const { wrapper } = await openWithFacts('/?v=s&sel=m:infra', { 'reviewed.yaml': REVIEWED })
    expect(wrapper.findAll('[data-check]').map(r => r.attributes('data-check'))).toEqual(['verify', 'governance', 'surface', 'split', 'evolution', 'review'])
    expect(wrapper.find('[data-card="check"] .card-toggle').attributes('aria-expanded')).toBe('true')
    const sum = wrapper.find('[data-card="check"] .card-sum')
    expect(sum.classes()).toContain('warn')
    expect(sum.text()).toMatch(/^⚠ \d 项要看 · ✓ \d 项正常$/)
    expect(wrapper.find('[data-check="governance"]').classes()).toContain('bad')
    expect(wrapper.find('[data-check="review"]').classes()).toContain('bad')
  })

  it('异常行下平铺条目：模块环与本层环各一条（评审轮 1 A2）；单击条目跳到对应清单——折叠的清单自动展开（架构治理、确认改动）', async () => {
    const REVIEWED = `reviewed:\n  - { module: infra, at: '2026-10-20', hash: stale, source: manual }\n`
    const { wrapper } = await openWithFacts('/?v=s&sel=m:infra', { 'reviewed.yaml': REVIEWED })
    const gov = wrapper.findAll('[data-check-item="governance"]').map(x => x.text())
    expect(gov.some(t => t.startsWith('模块环'))).toBe(true)
    expect(gov.some(t => t.startsWith('本层环'))).toBe(true)
    expect(wrapper.find('[data-sec="evidence.governance"] .fold').attributes('aria-expanded')).toBe('false')
    await wrapper.find('[data-check-item="governance"]').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(wrapper.find('[data-sec="evidence.governance"] .fold').attributes('aria-expanded')).toBe('true')
    // PC-7（ADR-0060）：全卡缺省至多 8 条，后面行的条目收在「+N 全部条目」里，单击展开
    const all = wrapper.find('[data-testid="check-expand-all"]')
    if (all.exists()) await all.trigger('click')
    await wrapper.find('[data-check-item="review"]').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(wrapper.find('[data-sec="review.diff"] .fold').attributes('aria-expanded')).toBe('true')
  })

  it('没有代码事实时前四行为 — 并写原因；演化没有数据为 —', async () => {
    const { wrapper } = await mountPanel('/?sel=m:infra')
    await wrapper.find('[data-card="check"] .card-toggle').trigger('click')
    for (const k of ['verify', 'governance', 'surface', 'split', 'evolution']) expect(wrapper.find(`[data-check="${k}"]`).classes()).toContain('none')
    expect(wrapper.find('[data-check="verify"]').text()).toContain('没有代码事实')
  })

  it('G12（V16）：清单「架构治理」内「生效的规则」仍折叠带计数', async () => {
    const { wrapper } = await openWithFacts('/?v=s&sel=m:infra')
    await wrapper.find('[data-sec="evidence.governance"] .fold').trigger('click')
    const rules = wrapper.find('.rules-fold')
    expect(rules.find('summary').text()).toMatch(/生效的规则\s*·\s*1/)
    expect(rules.attributes('open')).toBeUndefined()
  })
})

describe('V15c、PC-8：核对卡的清单', () => {
  it('清单折叠带计数、计数为 0 的不出现；次序为交互证据 → 源代码 → … → 确认', async () => {
    const { wrapper } = await mountPanel('/?sel=m:infra')
    await wrapper.find('[data-card="check"] .card-toggle').trigger('click')
    const lists = listsOf(wrapper)
    expect(lists[0]).toMatch(/交互证据\s*\d+/)
    expect(lists[lists.length - 1]).toContain('确认')
    expect(lists.join('|')).not.toContain('核心数据结构')
    expect(wrapper.find('[data-testid="split-signals"]').exists()).toBe(false)
    expect(wrapper.find('[data-card="check"] .lists button.fold[aria-expanded="true"]').exists()).toBe(false)
  })

  it('结构视角才有「结构指标」「表面元素」两个清单（④ 视角敏感，ADR-0031）', async () => {
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
    }
    const { wrapper, desk } = await mountWithSource('/?v=s&sel=m:app.solution', source, files)
    await openCheck(wrapper)
    expect(listsOf(wrapper).some(t => t.includes('结构指标'))).toBe(true)
    desk.setMode('interaction')
    await flushPromises()
    expect(listsOf(wrapper).some(t => t.includes('结构指标'))).toBe(false)
  })
})

describe('PC-10：其他对象的三卡', () => {
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

  it('关系：理解卡先目的、再说明与维度；核对卡「证实」未证实为 ⚠，条目单击跳到代码事实；出处 footer 最底', async () => {
    const { wrapper } = await mountWithSource('/?level=infra.framework&sel=r:r6', sourceWith([]), [
      ...sampleFiles(),
      { path: 'modules/zz-refs.yaml', text: REFS },
    ])
    expect(cardsOf(wrapper)).toEqual(['understand', 'check'])
    expect(wrapper.find('[data-card="understand"] .no-summary').text()).toBe('未写说明')
    expect(wrapper.find('[data-card="understand"] .dims').exists()).toBe(true)
    expect(wrapper.find('[data-check="verify"]').classes()).toContain('bad')
    expect(wrapper.find('[data-sec="evidence.fact"]').text()).toContain('两端之间在代码里没有任何依赖')
    await wrapper.find('[data-check-item="verify"]').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(wrapper.find('[data-sec="evidence.fact"]').classes()).toContain('jump-flash')
    expect(wrapper.find('.relation-panel > .src').exists()).toBe(true)
  })

  it('关系：已证实且有文件证据时「证实」为 ✓、核对卡收起，代码事实清单折叠带计数', async () => {
    const { wrapper } = await mountWithSource('/?level=infra.framework&sel=r:r6', sourceWith([dep('src/sm/a.ts', 'src/pipe/b.ts')]), [
      ...sampleFiles(),
      { path: 'modules/zz-refs.yaml', text: REFS },
    ])
    expect(wrapper.find('[data-card="check"] .card-toggle').attributes('aria-expanded')).toBe('false')
    await wrapper.find('[data-card="check"] .card-toggle').trigger('click')
    expect(wrapper.find('[data-check="verify"]').classes()).toContain('ok')
    const fold = wrapper.find('[data-sec="evidence.fact"] .fold')
    expect(fold.text()).toMatch(/代码事实\s*1/)
    await fold.trigger('click')
    expect(wrapper.find('[data-sec="evidence.fact"]').text()).toContain('已证实')
  })

  it('聚合边：「方向」行——向上却不是控制反转为 ⚠，条目跳到原始关系（K22）；控制反转只在头部注记', async () => {
    const up = sampleFiles({ 'zz-up.yaml': 'relations:\n  - { id: r8, from: app.solution, to: infra.player, type: queries }' })
    const { wrapper } = await mountPanel('/?sel=e:app.solution->infra.player:queries', up)
    expect(wrapper.find('[data-check="direction"]').classes()).toContain('bad')
    await wrapper.find('[data-check-item="direction"]').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(wrapper.find('[data-sec="boundary.relations"]').classes()).toContain('jump-flash')
    const inv = sampleFiles({
      'zz-up.yaml': 'relations:\n  - { id: r8b, from: app.solution, to: infra.player, type: notifies, via: "channel:cb@app.solution" }',
    })
    const ok = await mountPanel('/?sel=e:app.solution->infra.player:notifies', inv)
    expect(ok.wrapper.find('[data-testid="upward-note"]').text()).toContain('控制反转')
    expect(ok.wrapper.find('[data-check="direction"]').exists()).toBe(false)
  })

  it('端口：理解卡先一句用途、说明在端口结构详情之前；出处最底', async () => {
    const files = sampleFiles({
      'zz-if.yaml':
        'interfaces:\n  - { id: if.io, name: IO, owner: app.solution, description: 对外入口。细节, signature: "io(): void", implementedBy: [infra.player] }',
    })
    const { wrapper } = await mountPanel('/?sel=p:if.io', files)
    const body = [...wrapper.find('[data-card="understand"] .card-body').element.children]
    expect(body[0].textContent).toBe('对外入口')
    const purpose = body.findIndex(x => x.getAttribute?.('data-sec') === 'purpose')
    expect(body.findIndex(x => x.getAttribute?.('data-sec') === 'boundary.port')).toBeGreaterThan(purpose)
    const kids = [...wrapper.find('.port-panel').element.children]
    expect(kids[kids.length - 1].classList.contains('src')).toBe(true)
  })

  it('层：理解卡按五问（问题 → 说明 → 成员 · 一句话 → 可依赖的层）；核对卡为「结构」一行', async () => {
    const { wrapper } = await mountPanel('/?sel=s:app/top', sampleFiles({ 'intent/strata.yaml': STRATA }))
    expect(cardsOf(wrapper)).toEqual(['understand', 'check'])
    expect(wrapper.find('[data-testid="stratum-members"]').text()).toContain('Solution')
    await wrapper.find('[data-card="check"] .card-toggle').trigger('click')
    expect(wrapper.find('[data-check="structure"]').exists()).toBe(true)
  })

  it('参与者：理解卡为说明与入口关系，相关资料卡列由它触发的场景；场景：核对卡「证据」一行与「引用」清单，相关资料卡为时序图', async () => {
    const a = await mountPanel('/?sel=a:actor.biz', scenarioFiles())
    expect(cardsOf(a.wrapper)).toEqual(['understand', 'related'])
    expect(a.wrapper.find('[data-card="understand"] [data-sec="boundary.relations"]').exists()).toBe(true)
    // 第二十轮 §6：场景面板住辅助栏步骤节（抽屉在运行视角不渲染）——直接挂场景面板
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
    await router.push('/?sc=sc.play')
    const sd = createDeskState(async () => ({ dir: 'model/test', files: scenarioFiles() }))
    sd.attachRouter(router)
    await sd.init()
    const sw = mount(ScenarioPanel, { global: { provide: { [DESK_STATE as symbol]: sd }, plugins: [router] } })
    mounted.push(sw)
    await flushPromises()
    const s = { wrapper: sw }
    // 第二十轮读先方案：场景面板的相关资料卡删除（时序图在辅助栏按场景自动打开）
    expect(cardsOf(s.wrapper)).toEqual(['understand', 'check'])
    await openCheck(s.wrapper)
    expect(s.wrapper.find('[data-check="evidence"]').exists()).toBe(true)
    expect(s.wrapper.find('[data-sec="evidence.refs"] h3').text()).toMatch(/引用\s*\d/)
  })

  it('依赖边：理解卡为文件依赖（结构视角）；核对卡「治理」一行', async () => {
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
    expect(wrapper.find('[data-card="understand"] [data-sec="boundary.deps"]').exists()).toBe(true)
    await openCheck(wrapper)
    expect(wrapper.find('[data-check="governance"]').exists()).toBe(true)
  })
})

describe('V15b 的纯函数', () => {
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
})

describe('PC-2、PC-6、PC-10 的纯函数', () => {
  const none = {
    facts: false,
    relations: 0,
    unconfirmed: [],
    undescribed: [],
    violations: [],
    cycles: [],
    against: [],
    surfaceWidth: null,
    surface: [],
    split: [],
  }
  const review = { status: 'unreviewed' as const, inScope: true }

  it('checkSummary：⚠ 与 ✓ 计数，为 0 的一半不写，— 行不计', () => {
    const r = (state: CheckRow['state']): CheckRow => ({ key: state, label: state, state, text: '', items: [] })
    expect(checkSummary([r('bad'), r('hint'), r('ok'), r('none')]).text).toBe('⚠ 2 项要看 · ✓ 1 项正常')
    expect(checkSummary([r('ok'), r('ok')]).text).toBe('✓ 2 项正常')
    expect(checkSummary([r('bad')]).text).toBe('⚠ 1 项要看')
    expect(checkSummary([r('none')]).text).toBe('暂无核对结果')
  })

  it('moduleCheckRows：固定六行；没有代码事实前四行为 —；演化只陈述不判 ⚠；未确认为 —、需复核为 ⚠', () => {
    const rows = moduleCheckRows({ ...none, noFactsReason: '代码事实读取中', evolution: { changes: 5, fixes: 1, heat: 3, days: 180 }, review })
    expect(rows.map(r => r.key)).toEqual(['verify', 'governance', 'surface', 'split', 'evolution', 'review'])
    expect(rows.slice(0, 4).map(r => [r.state, r.text])).toEqual(Array(4).fill(['none', '代码事实读取中']))
    expect(rows[4]).toMatchObject({ state: 'ok', text: '近 180 天修改 5 次 · 缺陷 1 · 热度 3' })
    expect(rows[5]).toMatchObject({ state: 'none', text: '从未确认' })
    const stale = moduleCheckRows({ ...none, evolution: null, review: { status: 'stale', changes: 2, inScope: true } })
    expect(stale[4].state).toBe('none')
    expect(stale[5]).toMatchObject({ state: 'bad', text: '确认已过期 · 2 处改动' })
    expect(stale[5].items[0].target).toBe('review.diff')
  })

  it('moduleCheckRows：有代码事实时按信号归行——证实（未证实 + 未解释）、治理（违规、环为问题级，逆稳定为提示级）、表面与拆分为提示级', () => {
    const item = (text: string) => ({ text })
    const rows = moduleCheckRows({
      ...none,
      facts: true,
      relations: 4,
      unconfirmed: [item('a'), item('b')],
      against: [item('c')],
      surfaceWidth: 3,
      surface: [item('d')],
      evolution: null,
      review: { status: 'reviewed', date: '2026-10-20', inScope: true },
    })
    expect(rows[0]).toMatchObject({ state: 'bad', text: '4 条交互中 2 条未证实' })
    expect(rows[1]).toMatchObject({ state: 'hint', text: '违规 0 · 环 0 · 逆稳定 1' })
    expect(rows[2]).toMatchObject({ state: 'hint', text: 'W 3 · 1 处提示' })
    expect(rows[3]).toMatchObject({ state: 'ok', text: '无' })
    expect(rows[5]).toMatchObject({ state: 'ok', text: '2026-10-20 已确认' })
    const clean = moduleCheckRows({ ...none, facts: true, relations: 3, evolution: null, review })
    expect(clean[0].text).toBe('3 条交互全部被代码证实')
    expect(clean[1]).toMatchObject({ state: 'ok', text: '违规 0 · 环 0' })
  })

  it('rowsFromNotices：信号按行归位，行内按严重度排序；没有信号为 ✓ 或 —', () => {
    const n = (key: PanelNotice['key'], count: number, hint = false): PanelNotice => ({ key, label: key, count, target: `t.${key}`, to: 'x', hint })
    const rows = rowsFromNotices(
      [n('cycles', 1), n('violations', 2), n('stale', 0)],
      [
        { key: 'governance', label: '治理', notices: ['violations', 'cycles'], ok: '没有违规' },
        { key: 'review', label: '确认', notices: ['stale'], none: '未确认' },
        { key: 'split', label: '拆分', notices: ['split'], ok: '无' },
      ],
    )
    expect(rows[0]).toMatchObject({ state: 'bad', text: 'violations 2 · cycles 1' })
    expect(rows[0].items.map(i => i.target)).toEqual(['t.violations', 't.cycles'])
    expect(rows[1]).toMatchObject({ state: 'none', text: '未确认' })
    expect(rows[2]).toMatchObject({ state: 'ok', text: '无' })
    expect(rowsFromNotices([n('split', 1, true)], [{ key: 'split', label: '拆分', notices: ['split'], ok: '无' }])[0].state).toBe('hint')
  })
})
