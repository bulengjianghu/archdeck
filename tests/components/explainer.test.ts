// @vitest-environment jsdom
/**
 * 图解的呈现（ADR-0055）：EX-2 引用填充与 EX-3 桥接（iframe 文档、消息来源校验）、EX-4 导航、EX-5 画布标记、
 * EX-7 过期提示（标签、相关资料卡、核对卡「确认」行），以及 PC-9 的判定注入。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createDeskState } from '../../src/state/useDeskState'
import { DESK_STATE } from '../../src/state/inject'
import ExplainerDoc from '../../src/components/dock/ExplainerDoc.vue'
import DockGroup from '../../src/components/dock/DockGroup.vue'
import ExplainerMark from '../../src/components/nodes/ExplainerMark.vue'
import Panel from '../../src/components/panel/Panel.vue'
import { HAS_EXPLAINER } from '../../src/components/panel/related'
import { explainerSrcdoc, isExplainerMessage } from '../../src/components/dock/explainerFrame'
import { moduleCheckRows, type ModuleCheckInput } from '../../src/components/panel/panelCheck'
import { explainerBasis, formatBasis, loadModel, type ExplainerRef } from '../../src/model'
import { sampleFiles } from '../fixtures/sample'

const page = (body: string, meta = '') => `<!doctype html><html><head><meta charset="utf-8">${meta}</head><body>${body}</body></html>`
const INFRA = '<p><b data-arch="infra.framework">内核</b>：<span data-arch="infra.framework" data-field="summary"></span></p><p data-arch="nope">坏链</p>'

/** 样例描述加两份图解：infra 记了现在的依据，infra.framework 没有记录 */
function files(summary = '机制内核') {
  const base = sampleFiles()
  const idx = loadModel(base).index
  const meta = `<meta name="arch-basis" content="${formatBasis(explainerBasis(idx, 'infra'))}">`
  const all = sampleFiles({ 'explainers/infra.html': page(INFRA, meta), 'explainers/infra.framework.html': page('<p>内部</p>') })
  return summary === '机制内核'
    ? all
    : all.map(f =>
        f.path === 'modules/infra.yaml' ? { ...f, text: f.text.replace('responsibility: 机制内核', `responsibility: 机制内核\n      summary: ${summary}`) } : f,
      )
}

const mounted: VueWrapper[] = []
afterEach(() => mounted.splice(0).forEach(w => w.unmount()))

async function desk(url = '/', fs = files()) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const d = createDeskState(async () => ({ dir: 'model/test', files: fs }))
  d.attachRouter(router)
  await d.init()
  return { d, router }
}
const provide = (d: unknown, extra: Record<symbol, unknown> = {}) => ({ provide: { [DESK_STATE as symbol]: d, ...extra } })

describe('EX-3 iframe 文档', () => {
  const refs: Record<string, ExplainerRef> = {
    a: {
      name: '甲',
      summary: { text: '按序施用</script>命令', pending: false },
      invariants: [{ text: '单通道', adr: 12 }, { text: '唯一写者' }],
      explainer: true,
    },
    b: { name: '乙', summary: { text: '回退句', pending: true }, invariants: [], explainer: false },
  }
  const html = page(
    '<span id="s" data-arch="a" data-field="summary">旧</span><ul id="i" data-arch="a" data-field="invariants"></ul><b id="x" data-arch="a">甲</b><i id="b" data-arch="b" data-field="summary"></i><u id="m" data-arch="zz">坏</u>',
  )
  const doc = explainerSrcdoc(html, refs, 'http://desk.test')

  it('CSP 与样式插在 head 最前（禁止网络请求），桥接脚本在 body 末尾；脚本里的 JSON 不会提前结束 script', () => {
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<meta charset'))
    expect(doc).toContain("default-src 'none'")
    expect(doc.lastIndexOf('<script>')).toBeLessThan(doc.indexOf('</body>'))
    expect(doc).not.toContain('按序施用</script>')
  })

  it('EX-2：桥接脚本填入 summary（回退标待提炼）与不变式（带 ADR）；不存在的模块加删除线；「图解 ›」每个模块只附一次；单击发消息给父页', () => {
    const dom = new JSDOM(doc, { runScripts: 'dangerously' })
    const w = dom.window
    const $ = (id: string) => w.document.getElementById(id)!
    expect($('s').textContent).toBe('按序施用</script>命令')
    expect([...$('i').querySelectorAll('li')].map(li => li.textContent)).toEqual(['单通道ADR-0012', '唯一写者'])
    expect($('b').textContent).toBe('回退句待提炼')
    expect($('m').classList.contains('arch-missing')).toBe(true)
    expect(w.document.querySelectorAll('a.arch-exp')).toHaveLength(1)
    const post = vi.spyOn(w, 'postMessage').mockImplementation(() => {})
    $('x').dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
    expect(post).toHaveBeenLastCalledWith({ type: 'arch:select', module: 'a' }, 'http://desk.test')
    w.document.querySelector('a.arch-exp')!.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
    expect(post).toHaveBeenLastCalledWith({ type: 'arch:open', module: 'a' }, 'http://desk.test')
    post.mockClear()
    $('m').dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
    expect(post).not.toHaveBeenCalled()
  })

  it('消息形状校验', () => {
    expect(isExplainerMessage({ type: 'arch:select', module: 'a' })).toBe(true)
    expect(isExplainerMessage({ type: 'arch:select', module: 1 })).toBe(false)
    expect(isExplainerMessage({ type: 'other', module: 'a' })).toBe(false)
    expect(isExplainerMessage(null)).toBe(false)
  })
})

describe('EX-3、EX-4、EX-7 图解标签', () => {
  it('↓ 有图解的后代；依据一致时不显示过期；只接受来自这个 iframe 的消息：选中模块，资料区不动', async () => {
    const { d } = await desk()
    d.workspace.open({ kind: 'explainer', module: 'infra' })
    const w = mount(ExplainerDoc, { props: { module: 'infra' }, global: provide(d), attachTo: document.body })
    mounted.push(w)
    expect(w.findAll('.nav.down').map(b => b.text())).toEqual(['↓ Framework'])
    expect(w.find('[data-testid="explainer-stale"]').exists()).toBe(false)
    const frame = w.find('iframe').element as HTMLIFrameElement
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    const before = d.workspace.state.value
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'arch:select', module: 'infra.mus' }, source: window }))
    expect(d.selection.value).toBeNull()
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'arch:select', module: 'infra.mus' }, source: frame.contentWindow }))
    await flushPromises()
    expect(d.selection.value).toEqual({ kind: 'module', id: 'infra.mus' })
    expect(d.workspace.state.value).toBe(before)
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'arch:open', module: 'infra.framework' }, source: frame.contentWindow }))
    expect(d.workspace.isOpen({ kind: 'explainer', module: 'infra.framework' })).toBe(true)
    // 预览替换：infra 的预览被 infra.framework 换掉
    expect(d.workspace.isOpen({ kind: 'explainer', module: 'infra' })).toBe(false)
  })

  it('↑ 最近的有图解的祖先；没有依据时标「未记录依据」', async () => {
    const { d } = await desk()
    const w = mount(ExplainerDoc, { props: { module: 'infra.framework' }, global: provide(d) })
    mounted.push(w)
    expect(w.find('.nav.up').text()).toBe('↑ Infrastructure')
    // 「在画布上选中」选中这份图解的模块，资料区不动
    await w.find('.nav.sel').trigger('click')
    expect(d.selection.value).toEqual({ kind: 'module', id: 'infra.framework' })
    expect(w.find('[data-testid="explainer-stale"]').text()).toContain('未记录依据')
  })

  it('子模块的 summary 改了：标签与内容区都标「基于旧描述 · 1 处改动」，展开列出改动', async () => {
    const { d } = await desk('/', files('提供状态机与流水线'))
    d.workspace.open({ kind: 'explainer', module: 'infra' }, true)
    const g = mount(DockGroup, { props: { group: d.workspace.state.value.groups[0], gi: 0, count: 1, focused: true }, global: provide(d) })
    mounted.push(g)
    expect(g.find('.tab .lbl').text()).toBe('▣Infrastructure')
    expect(g.find('[data-testid="tab-stale"]').text()).toBe('基于旧描述 · 1 处改动')
    const stale = g.find('[data-testid="explainer-stale"]')
    expect(stale.text()).toContain('基于旧描述 · 1 处改动')
    await stale.trigger('click')
    expect(g.find('.changes').text()).toContain('Framework的一句话职责')
  })
})

describe('EX-5 画布标记', () => {
  it('有图解才显示；单击以预览打开、不改选中，双击固定；运行视角不显示', async () => {
    const { d } = await desk('/?sel=m:app')
    const w = mount(ExplainerMark, { props: { moduleId: 'infra' }, global: provide(d) })
    mounted.push(w)
    expect(
      mount(ExplainerMark, { props: { moduleId: 'app' }, global: provide(d) })
        .find('button')
        .exists(),
    ).toBe(false)
    await w.find('button').trigger('click')
    const tab = () => d.workspace.state.value.groups[0].tabs.find(t => t.id === 'exp:infra')
    expect(tab()?.preview).toBe(true)
    expect(d.selection.value).toEqual({ kind: 'module', id: 'app' })
    await w.find('button').trigger('dblclick')
    expect(tab()?.preview).toBe(false)
  })
})

describe('EX-7 属性栏', () => {
  const input: ModuleCheckInput = {
    facts: true,
    relations: 0,
    unconfirmed: [],
    undescribed: [],
    violations: [],
    cycles: [],
    against: [],
    surfaceWidth: null,
    surface: [],
    split: [],
    evolution: null,
    review: { status: 'reviewed', date: '2026-10-30', inScope: true },
  }
  const review = (x: Partial<ModuleCheckInput>) => moduleCheckRows({ ...input, ...x }).find(r => r.key === 'review')!

  it('核对卡「确认」行：图解过期为提示级细节，单击到清单「图解依据的改动」；确认本身过期时仍是问题级', () => {
    expect(review({}).state).toBe('ok')
    const r = review({ explainerStale: '基于旧描述 · 2 处改动' })
    expect(r.state).toBe('hint')
    expect(r.items).toEqual([{ text: '图解基于旧描述 · 2 处改动', target: 'review.explainer', hint: true }])
    const bad = review({ review: { status: 'stale', changes: 1, inScope: true }, explainerStale: '未记录依据' })
    expect(bad.state).toBe('bad')
    expect(bad.items).toHaveLength(2)
  })

  it('PC-9 已删（第二十轮读先方案）：模块抽屉没有相关资料卡；图解过期提示在辅助栏标签（上面的 EX-7 用例守）', async () => {
    const { d, router } = await desk('/?sel=m:infra', files('提供状态机与流水线'))
    const w = mount(Panel, { global: { ...provide(d, { [HAS_EXPLAINER as symbol]: (id: string) => d.explainers.has(id) }), plugins: [router] } })
    mounted.push(w)
    await flushPromises()
    expect(w.find('[data-testid="related-stale"]').exists()).toBe(false)
    expect(w.find('[data-card="related"]').exists()).toBe(false)
    expect(w.find('[data-card="check"]').exists()).toBe(true)
  })
})

describe('理解页随选中自动打开（第二十轮读先方案；ADR-0061 的 WS-8 例外扩展）', () => {
  it('有图解的模块打开「事实卡 + 故事」页，无图解的打开纯事实卡页；抽屉不再有「图解 ›」按钮', async () => {
    const { d, router } = await desk('/?sel=m:app')
    const w = mount(Panel, { global: { ...provide(d, { [HAS_EXPLAINER as symbol]: (id: string) => d.explainers.has(id) }), plugins: [router] } })
    mounted.push(w)
    await flushPromises()
    // 抽屉不再有图解入口按钮（入口在辅助栏理解页与画布 ▣）
    expect(w.find('[data-testid="open-explainer"]').exists()).toBe(false)
    // 选中带图解的模块 → exp 页（事实卡 + 故事）；250ms 稳定窗后打开
    d.select({ kind: 'module', id: 'infra' })
    await flushPromises()
    await new Promise(r => setTimeout(r, 300))
    const tab = (id: string) => d.workspace.state.value.groups[0].tabs.find(t => t.id === id)
    expect(tab('exp:infra')?.preview).toBe(true)
    // 选中无图解的模块 → fact 页（只有事实卡）
    d.select({ kind: 'module', id: 'app' })
    await flushPromises()
    await new Promise(r => setTimeout(r, 300))
    expect(tab('fact:app')?.preview).toBe(true)
  })

  it('理解页按 WS-5 替换预览、不累积；已固定的不被自动打开降级', async () => {
    const { d } = await desk('/?sel=m:app')
    const tabs = () => d.workspace.state.value.groups[0].tabs
    d.select({ kind: 'module', id: 'infra' })
    await flushPromises()
    await new Promise(r => setTimeout(r, 300))
    expect(tabs().map(t => t.id)).toEqual(['exp:infra'])
    // 选另一个模块：新的理解页替换预览标签（WS-5），不累积
    d.select({ kind: 'module', id: 'app' })
    await flushPromises()
    await new Promise(r => setTimeout(r, 300))
    expect(tabs().map(t => t.id)).toEqual(['fact:app'])
    // 固定的页不被替换；回到已开着的 infra 不再新开
    d.workspace.open({ kind: 'explainer', module: 'infra.framework' }, true)
    d.select({ kind: 'module', id: 'infra' })
    await flushPromises()
    await new Promise(r => setTimeout(r, 300))
    expect(
      tabs()
        .filter(t => t.id.startsWith('exp:') || t.id.startsWith('fact:'))
        .map(t => t.id),
    ).toEqual(['exp:infra', 'exp:infra.framework'])
    expect(tabs().find(t => t.id === 'exp:infra.framework')!.preview).toBe(false)
    expect(tabs().find(t => t.id === 'exp:infra')!.preview).toBe(true)
  })
})
