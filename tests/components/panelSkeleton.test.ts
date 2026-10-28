// @vitest-environment jsdom
/**
 * 面板信息骨架（G11，ADR-0050）：V14 五段段序与视角敏感段、V14a 头部徽标槽位表、V14b ③ 需要注意、V14c ④ 出入边汇总与 ⑤ 折叠带计数。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import Panel from '../../src/components/panel/Panel.vue'
import { createDeskState } from '../../src/state/useDeskState'
import { DESK_STATE } from '../../src/state/inject'
import { orderNotices, splitSignalCount, typeSummary, type PanelNotice } from '../../src/components/panel/panelNotices'
import { sampleFiles } from '../fixtures/sample'
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

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
})

describe('V14：五段段序', () => {
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

describe('V14a：① 头部徽标槽位表', () => {
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
})

describe('V14b：③ 需要注意', () => {
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
    // 严重度：违规、环在最前，确认过期在其后（V14b 排序）
    expect(keys.indexOf('violations')).toBeLessThan(keys.indexOf('stale'))
    expect(rows[0].attributes('data-notice')).toBe('violations')
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
})

describe('V14c：④ 汇总与 ⑤ 折叠', () => {
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
})

describe('V14b、V14c 的纯函数', () => {
  it('orderNotices 过滤零计数并按严重度排序', () => {
    const n = (key: PanelNotice['key'], count: number): PanelNotice => ({ key, label: key, count, target: 'x', to: 'y' })
    expect(orderNotices([n('stale', 2), n('surface', 0), n('violations', 1), n('against', 3), n('undescribed', 1)]).map(x => x.key)).toEqual([
      'violations',
      'undescribed',
      'stale',
      'against',
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
