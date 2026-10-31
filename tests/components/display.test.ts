// @vitest-environment jsdom
/**
 * 图例按视角整体替换（L19、D-26）、共享通道三处同文（L18）、图例行即开关与留痕（L45）、关着的开关行常列（L47）、位置与收放（L48）、
 * 「显示 ▾」菜单（L49）、悬停释义（L50）、教学内容只在帮助（L51）、帮助的四组（W-10）
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import Legend from '../../src/components/display/Legend.vue'
import DisplayMenu from '../../src/components/display/DisplayMenu.vue'
import GuideDialog from '../../src/components/GuideDialog.vue'
import { legendOpenKey, resetStructurePrefs, useStructurePrefs } from '../../src/components/display/useDisplayPrefs'
import { heatControls, resetHeatKind } from '../../src/components/display/useEvolutionPrefs'
import { effectScope, nextTick, shallowRef } from 'vue'
import {
  ASSEMBLY_LINE_TEXT,
  BUNDLE_TEXT,
  COUPLE_TEXT,
  DEP_FORM_HINT,
  DEP_TIER_HINT,
  FACT_TAG_HINT,
  MECHANISM_HINTS,
  SHARED_CHANNELS,
  TYPE_HINT,
  UPPER_TEXT,
} from '../../src/components/display/labels'
import { depGloss, GLOSS_HEAD, labelGloss, routeGloss, withGloss } from '../../src/components/display/gloss'
import { OPEN_GUIDE } from '../../src/components/shared/guide'
import { THREE_QUESTIONS } from '../../src/components/shared/labels'
import { RELATION_TYPES } from '../../src/model'
import { createDeskState, type SourceFetcher } from '../../src/state/useDeskState'
import { DESK_STATE } from '../../src/state/inject'
import type { FileDep } from '../../src/model'
import { scenarioFiles } from '../fixtures/sample'

const REFS = `
modules:
  - { id: app.solution.core, parent: app.solution, name: SolCore, responsibility: x, codeRefs: [src/app/**] }
  - { id: domain.models.core, parent: domain.models, name: ModCore, responsibility: x, codeRefs: [src/domain/**] }
  - { id: infra.framework.extra, parent: infra.framework, name: Extra, responsibility: x, codeRefs: [src/framework/**] }
`
const FILES = ['src/app/s.ts', 'src/domain/m.ts', 'src/framework/extra.ts']
const DEPS: FileDep[] = [
  { from: 'src/framework/extra.ts', to: 'src/app/s.ts', via: 'src/app/s.ts', kind: 'value', line: 1, uses: true, invokes: true },
  // 根层两条只引类型的依赖边：应用 → 领域、领域 → 基础设施
  { from: 'src/app/s.ts', to: 'src/domain/m.ts', via: 'src/domain/m.ts', kind: 'type', line: 1 },
  { from: 'src/domain/m.ts', to: 'src/framework/extra.ts', via: 'src/framework/extra.ts', kind: 'type', line: 1 },
]
const source: SourceFetcher = {
  tree: async () => ({ status: 'local', root: '/repo', files: FILES, packages: {} }),
  file: async () => null,
  exports: async () => [],
  facts: async () => ({ deps: { deps: DEPS, external: {}, parsed: FILES.length }, baseline: null, ledger: [] }),
}

async function open(url: string, deps: FileDep[] = DEPS) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => ({ dir: 'model/test', files: [...scenarioFiles(), { path: 'modules/zz-refs.yaml', text: REFS }] }), {
    source: { ...source, facts: async () => ({ deps: { deps, external: {}, parsed: FILES.length }, baseline: null, ledger: [] }) },
  })
  desk.attachRouter(router)
  await desk.init()
  await flushPromises()
  const guide: string[] = []
  const provide = { [DESK_STATE as symbol]: desk, [OPEN_GUIDE as symbol]: (s?: string) => guide.push(s ?? '') }
  const wrapper = mount(Legend, { global: { provide, plugins: [router] } })
  const menu = mount(DisplayMenu, { global: { provide, plugins: [router] } })
  await flushPromises()
  return { desk, wrapper, menu, guide }
}

/** 展开「显示 ▾」菜单 */
async function openMenu(menu: Awaited<ReturnType<typeof open>>['menu']) {
  if (!menu.find('[role="menu"]').exists()) await menu.find('.menu-btn').trigger('click')
  return menu.find('[role="menu"]')
}
const toggleOf = (w: Awaited<ReturnType<typeof open>>['wrapper'], sel: string) => w.find(`button[role="switch"]${sel}`)

const titles = (w: Awaited<ReturnType<typeof open>>['wrapper']) => w.findAll('.group-btn').map(b => b.text().replace(/^[▾▸]/, ''))

beforeEach(() => {
  localStorage.clear()
  resetStructurePrefs()
  resetHeatKind()
})

describe('L19：图例按视角整体替换', () => {
  it('交互视角：关系、节点、代码事实、组装、演化与共享；没有结构视图的组', async () => {
    const { wrapper } = await open('/')
    expect(titles(wrapper)).toEqual(['关系', '节点', '代码事实', '组装', '演化', '共享 · 三个视角同义'])
  })

  it('结构视角：依赖 · 形态与档、节点、规则叠加、指标、演化与共享；没有关系类型与代码事实的开关行', async () => {
    const { wrapper } = await open('/?v=s')
    expect(titles(wrapper)).toEqual(['依赖 · 形态与档', '节点', '规则叠加 · 只标违规', '指标 · 不稳定度与共用件', '演化', '共享 · 三个视角同义'])
    expect(wrapper.find('[data-type]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="toggle-facts"]').exists()).toBe(false)
    const text = wrapper.text()
    for (const s of [
      // L16（ADR-0035）：全部虚线，形态只靠端点记号；端口实现为 ◇
      '子类 = 虚线 + 空心三角',
      '组装 = 虚线 + 实心菱形',
      '端口实现 = 虚线 + 空心菱形 ◇',
      '使用 = 虚线 + 开口箭头',
      '交互使用',
      '值使用',
      '只引类型',
      BUNDLE_TEXT,
    ])
      expect(text).toContain(s)
    // L47（G14）：形态行只列画出来的，按强弱次序（子类 ＞ 组装 ＞ 端口实现 ＞ 使用）排列
    expect(wrapper.findAll('[data-form]').map(x => x.attributes('data-form'))).toEqual(['subclass', 'assembly', 'implements', 'use'])
    expect(wrapper.findAll('svg[data-kind]').length).toBeGreaterThanOrEqual(7)
    // L18：依赖一律断开的线——虚线，只引类型点线（L43，档的新通道）
    for (const svg of wrapper.findAll('svg[data-kind]'))
      expect(svg.findAll('line').some(l => l.attributes('stroke-dasharray') === (svg.attributes('data-tier') === 'type' ? '1.5 3.5' : '6 4'))).toBe(true)
    expect(wrapper.find('[data-testid="legend-salience-exception"]').text()).toContain('例外')
    // L47（G14）：本层没有的记号行不列——夹具没有越过入口与跨界折叠，两行不出现
    expect(text).not.toContain('越过入口')
    expect(wrapper.find('[data-testid="cross-count"]').exists()).toBe(false)
    // L47（G14）：临时可见小节常列——表面元素四类与「+N」是展开表面才出现的记号，照列
    expect(wrapper.find('[aria-label="表面元素四类"]').text()).toMatch(/端口.*操作.*类型.*数据/)
    expect(wrapper.find('[data-testid="surface-cap"]').text()).toContain('+N')
    expect(text).toContain('临时可见 · 展开表面的节点上出现')
  })

  it('运行视角：关系（只读）、节点、回放与共享；没有结构视图与代码事实的组', async () => {
    const { wrapper } = await open('/?sc=sc.play')
    expect(titles(wrapper)).toEqual(['关系', '节点', '回放', '共享 · 三个视角同义'])
    expect(wrapper.text()).toContain('交互中未建模')
    expect(wrapper.text()).toContain(UPPER_TEXT)
    expect(wrapper.text()).not.toContain('结构中未建模')
    // L45：运行视角的类型行只读（回放不受筛选影响，L9）；运行视角缺省只展开「回放」（L48）
    await wrapper
      .findAll('.group-btn')
      .find(b => b.text().includes('关系'))!
      .trigger('click')
    expect(wrapper.find('[data-type]').exists()).toBe(true)
    expect(wrapper.find('button[role="switch"][data-type]').exists()).toBe(false)
  })

  it('L18：共享通道的行文字三处取自同一份词表；选中与变淡是临时记号，三处「临时可见」常列（L47）', async () => {
    const rows: string[][] = []
    for (const url of ['/', '/?v=s', '/?sc=sc.play']) {
      const { wrapper } = await open(url)
      const btn = wrapper.findAll('.group-btn').find(b => b.text().includes('共享'))!
      if (btn.attributes('aria-expanded') !== 'true') await btn.trigger('click')
      rows.push(
        wrapper
          .find('[aria-label="共享通道"]')
          .findAll('.item')
          .map(x => x.text()),
      )
    }
    const vocab = SHARED_CHANNELS.map(c => c.text)
    for (const list of rows) for (const t of list) expect(vocab.some(v => t.includes(v))).toBe(true)
    for (const list of rows) {
      expect(list.some(t => t.includes(SHARED_CHANNELS[0].text))).toBe(true)
      expect(list.some(t => t.includes(SHARED_CHANNELS[1].text))).toBe(true)
    }
    expect(rows[0].some(t => t.includes('实线 = 交互'))).toBe(true)
    expect(rows[1].some(t => t.includes('实线 = 交互'))).toBe(true)
    expect(rows[2].some(t => t.includes('实线 = 交互'))).toBe(true)
    expect(rows[0].some(t => t.includes('虚线 = 依赖'))).toBe(true)
    expect(rows[1].some(t => t.includes('虚线 = 依赖'))).toBe(true)
    expect(rows[2].some(t => t.includes('虚线 = 依赖'))).toBe(false)
  })
})

describe('L45：图例行即开关；L47：关着的开关行常列', () => {
  it('关系类型行即开关：单击切换这一类，关着的行淡色、仍列着；再单击恢复（运行视角之外）', async () => {
    const { wrapper, desk } = await open('/')
    const row = () => toggleOf(wrapper, '[data-type="calls"]')
    expect(row().attributes('aria-checked')).toBe('true')
    await row().trigger('click')
    expect(desk.toggles.relationTypes).not.toContain('calls')
    // L47：关着也常列（淡色），才能再打开
    expect(row().exists()).toBe(true)
    expect(row().attributes('aria-checked')).toBe('false')
    expect(row().classes()).toContain('off')
    await row().trigger('click')
    expect([...desk.toggles.relationTypes].sort()).toEqual([...RELATION_TYPES].sort())
  })

  it('L47：关着的类型即使本层没有也常列；开着且本层没有的类型不列', async () => {
    const { wrapper, desk } = await open('/')
    const listed = () =>
      wrapper
        .findAll('[data-type]')
        .filter(x => (x.element as HTMLElement).style.display !== 'none')
        .map(x => x.attributes('data-type'))
    const absent = RELATION_TYPES.find(t => !listed().includes(t))
    if (!absent) return
    desk.setToggles({ relationTypes: RELATION_TYPES.filter(t => t !== absent) })
    await flushPromises()
    expect(listed()).toContain(absent)
  })

  it('代码事实、组装、时间耦合的开关行在各组第一行；单击切换视图状态，关着淡色', async () => {
    const { wrapper, desk } = await open('/')
    const facts = () => wrapper.find('[data-testid="toggle-facts"]')
    expect(facts().attributes('aria-checked')).toBe('true')
    await facts().trigger('click')
    expect(desk.toggles.showFacts).toBe(false)
    expect(facts().classes()).toContain('off')
    // 关着时组内只剩开关行：标签词行不列
    expect(wrapper.find('[data-tag="未证实"]').exists()).toBe(false)
    await facts().trigger('click')
    expect(desk.toggles.showFacts).toBe(true)

    const asm = wrapper.find('[data-testid="toggle-assembly"]')
    expect(asm.attributes('aria-checked')).toBe('false')
    await asm.trigger('click')
    expect(desk.toggles.assembly).toBe(true)
  })

  it('演化热度行打开为记住的口径（缺省修改），再单击关；没有演化事实时置灰', async () => {
    const { wrapper, desk } = await open('/')
    const heat = wrapper.find('[data-testid="toggle-heat"]')
    if (desk.evolution.status.value !== 'ready') {
      expect(heat.attributes('disabled')).toBeDefined()
      return
    }
    await heat.trigger('click')
    expect(desk.toggles.heat).toBe('changes')
    await heat.trigger('click')
    expect(desk.toggles.heat).toBe('off')
  })

  it('结构视角：「只引类型」的档行即开关——缺省关、淡色常列并给出收起条数；单击写显示偏好（画布同读）', async () => {
    const { wrapper, desk, menu } = await open('/?v=s')
    const OFF = { typeOnly: false, invokesOnly: false, uncoveredOnly: false }
    expect(desk.facts.structureDisplay(OFF)!.hidden.type).toBe(2)
    const row = () => wrapper.find('[data-testid="type-only-count"]')
    expect(row().attributes('aria-checked')).toBe('false')
    expect(row().text()).toContain('2 条已收起')
    await row().trigger('click')
    expect(row().text()).toContain('2 条已显示')
    expect(useStructurePrefs('').prefs.value.typeOnly).toBe(true)
    expect(JSON.parse(localStorage.getItem('h5p-arch-desk:structure-prefs:')!)).toMatchObject({ typeOnly: true })
    expect(menu.find('[data-testid="display-summary"]').attributes('data-summary')!).toContain('只引类型已显示')
  })

  it('一个开关只出现在一处：图例里的开关行不在「显示 ▾」里，反之亦然', async () => {
    for (const url of ['/', '/?v=s']) {
      const { wrapper, menu } = await open(url)
      const m = await openMenu(menu)
      const inMenu = m.findAll('[aria-label]').map(x => x.attributes('aria-label'))
      const inLegend = wrapper.findAll('button[role="switch"]').map(x => x.attributes('aria-label'))
      expect(inLegend.length).toBeGreaterThan(0)
      for (const l of inLegend) expect(inMenu).not.toContain(l)
    }
  })
})

describe('L48：图例的位置与收放', () => {
  it('第一次进入项目时展开，之后按本机记住的收放（按项目，不分视角）', async () => {
    const a = await open('/')
    expect(a.wrapper.find('.body').exists()).toBe(true)
    await a.wrapper.find('.head-btn').trigger('click')
    expect(a.wrapper.find('.body').exists()).toBe(false)
    expect(localStorage.getItem(legendOpenKey(''))).toBe('false')
    // 再次进入（换视角也一样）：按记住的收起
    const b = await open('/?v=s')
    expect(b.wrapper.find('.body').exists()).toBe(false)
    expect(b.wrapper.find('.head-btn').text()).toContain('图例')
  })
})

describe('L49：「显示 ▾」菜单', () => {
  it('交互视角：边界节点、只看现状、热度口径；没有结构筛选与交互关系方式', async () => {
    const { menu } = await open('/')
    const m = await openMenu(menu)
    expect(m.find('input[aria-label="边界节点"]').exists()).toBe(true)
    expect(m.find('input[aria-label="只看现状"]').exists()).toBe(true)
    expect(m.find('input[aria-label="只看交互使用"]').exists()).toBe(false)
    expect(m.find('[aria-label="交互关系"]').exists()).toBe(false)
  })

  it('结构视角：只看交互使用、只看未解释带收起计数，写显示偏好；按钮上的点与悬停提示列出非默认设置（TB-3）', async () => {
    const { desk, menu } = await open('/?v=s')
    const OFF = { typeOnly: false, invokesOnly: false, uncoveredOnly: false }
    const value = desk.facts.structureDisplay({ ...OFF, invokesOnly: true })!.hidden.value
    const covered = desk.facts.structureDisplay({ ...OFF, uncoveredOnly: true })!.hidden.covered
    const m = await openMenu(menu)
    expect(m.find('[data-testid="value-count"]').text()).toContain(`打开后收起值使用的束 ${value} 条`)
    const unc = m.find('[data-testid="uncovered-count"]')
    expect(unc.text()).toContain(`打开后收起已解释的束 ${covered} 条`)
    expect((unc.element.closest('label') as HTMLElement).getAttribute('title')).toContain('既没有交互覆盖、形态也不是端口实现 / 子类 / 组装')
    expect(menu.find('[data-testid="display-summary"]').exists()).toBe(false)
    await m.find('input[aria-label="只看交互使用"]').setValue(true)
    await m.find('input[aria-label="只看未解释"]').setValue(true)
    await m.find('input[aria-label="总是展开表面"]').setValue(true)
    expect(m.find('[data-testid="value-count"]').text()).toMatch(/值使用的束 \d+ 条已收起/)
    expect(useStructurePrefs('').prefs.value).toMatchObject({ invokesOnly: true, uncoveredOnly: true, surfaceAlways: true })
    const summary = menu.find('[data-testid="display-summary"]').attributes('data-summary')!
    for (const s of ['只看交互使用', '只看未解释', '总是展开表面']) expect(summary).toContain(s)
  })

  it('运行视角：只有交互关系的显示方式与一行说明；显示方式是缺省的「隐藏」时没有点（TB-3）', async () => {
    const { menu } = await open('/?sc=sc.play')
    expect(menu.find('[data-testid="display-summary"]').exists()).toBe(false)
    const m = await openMenu(menu)
    expect(m.find('[aria-label="交互关系"]').exists()).toBe(true)
    expect(m.find('input[aria-label="边界节点"]').exists()).toBe(false)
    expect(m.text()).toContain('场景中显示全部节点与关系类型')
  })

  it('交互视角的非默认设置（TB-3）：隐藏的关系类别、代码事实已关（来自图例行的开关）', async () => {
    const { wrapper, menu } = await open('/')
    await toggleOf(wrapper, '[data-type="calls"]').trigger('click')
    await wrapper.find('[data-testid="toggle-facts"]').trigger('click')
    const summary = menu.find('[data-testid="display-summary"]').attributes('data-summary')!
    expect(summary).toContain('隐藏 1 类关系')
    expect(summary).toContain('代码事实已关')
  })

  it('热度口径：热度关着时只记下、不打开；开着时立即换口径', async () => {
    const { desk, menu } = await open('/')
    if (desk.evolution.status.value !== 'ready') return
    const m = await openMenu(menu)
    const fixes = m.findAll('[aria-label="热度口径"] button').find(b => b.text() === '缺陷')!
    await fixes.trigger('click')
    expect(desk.toggles.heat).toBe('off')
    expect(localStorage.getItem('h5p-arch-desk:heat-kind:')).toBe('fixes')
    desk.setToggles({ heat: 'changes' })
    await fixes.trigger('click')
    expect(desk.toggles.heat).toBe('fixes')
  })

  it('热度控制（纯逻辑，不依赖演化事实就绪）：开关用记住的口径；选口径关着只记、开着即换；开着时口径跟着视图状态', async () => {
    const state = shallowRef({ toggles: { heat: 'off' as 'off' | 'changes' | 'fixes' } })
    const desk = { state, setToggles: (p: { heat?: 'off' | 'changes' | 'fixes' }) => (state.value = { toggles: { ...state.value.toggles, ...p } }) }
    const scope = effectScope()
    const h = scope.run(() => heatControls('p', desk as never))!
    expect(h.kind.value).toBe('changes')
    h.choose('fixes')
    expect(state.value.toggles.heat).toBe('off')
    h.toggle()
    expect(state.value.toggles.heat).toBe('fixes')
    h.choose('changes')
    expect(state.value.toggles.heat).toBe('changes')
    h.toggle()
    expect(state.value.toggles.heat).toBe('off')
    desk.setToggles({ heat: 'fixes' })
    await nextTick()
    expect(h.kind.value).toBe('fixes')
    expect(localStorage.getItem('h5p-arch-desk:heat-kind:p')).toBe('fixes')
    scope.stop()
  })

  it('单击菜单外或 Esc 收起', async () => {
    const { menu } = await open('/')
    await openMenu(menu)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(menu.find('[role="menu"]').exists()).toBe(false)
    await openMenu(menu)
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flushPromises()
    expect(menu.find('[role="menu"]').exists()).toBe(false)
  })
})

describe('L47：环与代码事实的出现集合', () => {
  it('环编号在交互与结构视角都常显（T0 裁决 3）——本层有环时共享组列「↻N」行，没有环时不列', async () => {
    const openShared = async (wrapper: Awaited<ReturnType<typeof open>>['wrapper']) => {
      const btn = wrapper.findAll('.group-btn').find(b => b.text().includes('共享'))!
      if (btn.attributes('aria-expanded') !== 'true') await btn.trigger('click')
    }
    for (const url of ['/', '/?v=s']) {
      const { wrapper } = await open(url)
      await openShared(wrapper)
      expect(wrapper.find('[aria-label="共享通道"]').text()).not.toContain('↻N')
    }
    const CYCLE: FileDep[] = [
      ...DEPS,
      { from: 'src/app/s.ts', to: 'src/domain/m.ts', via: 'src/domain/m.ts', kind: 'value', line: 3, uses: true, invokes: true },
      { from: 'src/domain/m.ts', to: 'src/app/s.ts', via: 'src/app/s.ts', kind: 'value', line: 2, uses: true, invokes: true },
    ]
    for (const url of ['/', '/?v=s']) {
      const { wrapper } = await open(url, CYCLE)
      await openShared(wrapper)
      expect(wrapper.find('[aria-label="共享通道"]').text()).toContain('↻N：本层的环编号')
    }
  })

  it('交互视角「代码事实」组：只列本层出现的标签词（L26），缺段是选中交互才画出的临时记号、归「临时可见」常列', async () => {
    const { wrapper } = await open('/')
    expect(wrapper.find('[data-testid="carrier-legend"]').text()).toContain('缺的一段画成警示色虚线')
    expect(wrapper.findAll('[data-tag]').map(x => x.attributes('data-tag'))).toEqual(['未证实', '未解释', '缺段'])
    expect(wrapper.text()).toContain('临时可见 · 选中交互时画出')
  })
})

describe('L51：教学内容只在帮助', () => {
  it('图例里没有三问与「四修饰 · 读完类型再读」；关系组标题旁的「?」打开帮助并定位到「读一条线」', async () => {
    const { wrapper, guide } = await open('/')
    for (const x of THREE_QUESTIONS) expect(wrapper.text()).not.toContain(x.q)
    expect(wrapper.text()).not.toContain('读完类型再读')
    await wrapper.find('button[aria-label="怎么读一条线"]').trigger('click')
    expect(guide).toEqual(['read-line'])
  })

  it('帮助的「读一条线」一节有三问，可按 section 定位', () => {
    const w = mount(GuideDialog, { props: { section: 'read-line' } })
    const sec = w.find('[data-section="read-line"]')
    expect(sec.exists()).toBe(true)
    for (const x of THREE_QUESTIONS) expect(sec.text()).toContain(x.q)
    expect(sec.text()).toContain('三问四修饰')
  })
})

describe('L50：悬停释义取自图例同一份词表', () => {
  const edge = (type: 'commands' | 'queries') => ({ id: 'e', from: 'a', to: 'b', type, relationIds: [] }) as never
  it('交互线按关系类型附一句，标签里的异常词与机制词各附一句（同一词只附一次）', () => {
    expect(routeGloss({ edge: edge('commands'), label: '' })).toEqual([`委托 = ${TYPE_HINT.commands}`])
    const g = routeGloss({ edge: edge('queries'), label: '×5 · 未证实 2 · 端口 1' })
    expect(g[0]).toBe(`查询 = ${TYPE_HINT.queries}`)
    expect(g).toContain(`未证实：${FACT_TAG_HINT[0].text}`)
    expect(g).toContain(`端口：${MECHANISM_HINTS.find(m => m.tag === '端口')!.text}`)
    expect(labelGloss('未解释 · 未解释')).toHaveLength(1)
  })

  it('临时线按种类：代码依赖叠加线（未解释 / 违规）、组装、时间耦合、承载缺段、经上层', () => {
    const fact = (tag: string) => `${tag}：${FACT_TAG_HINT.find(f => f.tag === tag)!.text}`
    expect(routeGloss({ edge: edge('commands'), label: '', temp: 'code' })).toEqual([fact('未解释')])
    expect(routeGloss({ edge: edge('commands'), label: '违规', temp: 'code', violated: true })).toEqual([fact('违规')])
    expect(routeGloss({ edge: edge('commands'), label: '', temp: 'assembly' })).toEqual([ASSEMBLY_LINE_TEXT])
    expect(routeGloss({ edge: edge('commands'), label: '×3', temp: 'couple' })[0]).toBe(COUPLE_TEXT)
    expect(routeGloss({ edge: edge('commands'), label: '缺段', temp: 'carrier-gap' })).toEqual([fact('缺段')])
    expect(routeGloss({ edge: edge('commands'), label: '', temp: 'upper' })).toEqual([UPPER_TEXT])
  })

  it('结构边按形态与档；释义只追加在原有说明之后', () => {
    expect(depGloss({ kind: 'use', tier: 'type' })).toEqual([`使用 = ${DEP_FORM_HINT.use}`, `只引类型 = ${DEP_TIER_HINT.type}`])
    expect(withGloss('原说明', ['委托 = x'])).toBe(`原说明\n\n${GLOSS_HEAD}委托 = x`)
    expect(withGloss(undefined, ['a', 'b'])).toBe(`${GLOSS_HEAD}a\n${GLOSS_HEAD}b`)
  })
})

describe('W-10：帮助按结构 / 交互 / 运行 / 对照与治理分组，另有共享一段', () => {
  it('四组标题与改名', () => {
    const w = mount(GuideDialog)
    expect(w.findAll('.group h3').map(h => h.text())).toEqual(['结构', '交互', '读一条线：三问四修饰', '运行', '对照与治理', '层'])
    // L36、L37（第十四轮 F4、F16）：层的状态记号与节点注记的位置表
    expect(w.find('[data-testid="guide-layer-status"]').text()).toMatch(/已确认.*待确认.*算出/)
    expect(w.find('[data-testid="guide-node-marks"]').text()).toContain('最多三个')
    expect(w.text()).toContain('交互图变成舞台')
    expect(w.text()).not.toContain('结构图变成舞台')
    expect(w.find('[aria-label="三个视角共享"]').text()).toContain(SHARED_CHANNELS[5].text)
    // W-10：结构组另有「束与表面」「承载」两段（第八轮）
    const structure = w.find('[aria-label="结构"]')
    expect(structure.find('[data-testid="guide-bundle"]').text()).toContain('一对模块之间的线是一条束')
    expect(structure.find('[data-testid="guide-bundle"]').text()).toContain('入口导出与声明的接口')
    expect(structure.find('[data-testid="guide-carrier"]').text()).toMatch(/齐全、模块级、缺段、无承载或外部/)
  })
})
