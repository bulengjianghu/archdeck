// @vitest-environment jsdom
/** 「显示」面板的图例按视角整体替换（L19、D-26）、共享通道三处同文（L18）、结构视角的「只引类型」开关与计数（L15）、帮助的四组（W-10） */
import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import DisplayPanel from '../../src/components/DisplayPanel.vue'
import GuideDialog from '../../src/components/GuideDialog.vue'
import { resetStructurePrefs, useStructurePrefs } from '../../src/components/display/useDisplayPrefs'
import { BUNDLE_TEXT, SHARED_CHANNELS } from '../../src/components/display/labels'
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

async function open(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => ({ dir: 'model/test', files: [...scenarioFiles(), { path: 'modules/zz-refs.yaml', text: REFS }] }), {
    source,
  })
  desk.attachRouter(router)
  await desk.init()
  await flushPromises()
  const wrapper = mount(DisplayPanel, { global: { provide: { [DESK_STATE as symbol]: desk }, plugins: [router] } })
  await flushPromises()
  return { desk, wrapper }
}

const titles = (w: Awaited<ReturnType<typeof open>>['wrapper']) => w.findAll('.group-btn').map(b => b.text().replace(/^[▾▸]/, ''))

beforeEach(() => {
  localStorage.clear()
  resetStructurePrefs()
})

describe('L19：图例按视角整体替换', () => {
  it('交互视角：关系、节点、代码事实、组装、演化与共享；没有结构视图的组', async () => {
    const { wrapper } = await open('/')
    expect(titles(wrapper)).toEqual(['关系 · 三问四修饰', '节点', '代码事实 · 标签', '组装', '演化 · 角标与波浪线', '共享 · 三个视角同义'])
  })

  it('结构视角：依赖 · 形态与档、节点、规则叠加、指标、演化与共享；隐藏代码事实叠加组与关系类型筛选', async () => {
    const { wrapper } = await open('/?v=s')
    expect(titles(wrapper)).toEqual(['依赖 · 形态与档', '节点', '规则叠加 · 只标违规', '指标 · 不稳定度与共用件', '演化 · 角标与波浪线', '共享 · 三个视角同义'])
    expect(wrapper.find('[aria-label="关系类型筛选"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="代码事实"]').exists()).toBe(false)
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
    // L21：四种形态按强弱次序（子类 ＞ 组装 ＞ 端口实现 ＞ 使用）
    expect(wrapper.findAll('[data-form]').map(x => x.attributes('data-form'))).toEqual(['subclass', 'assembly', 'implements', 'use'])
    expect(wrapper.findAll('svg[data-kind]').length).toBeGreaterThanOrEqual(7)
    // L18：依赖一律断开的线——虚线，只引类型点线（L43，档的新通道）
    for (const svg of wrapper.findAll('svg[data-kind]'))
      expect(svg.findAll('line').some(l => l.attributes('stroke-dasharray') === (svg.attributes('data-tier') === 'type' ? '1.5 3.5' : '6 4'))).toBe(true)
    expect(wrapper.find('[data-testid="legend-salience-exception"]').text()).toContain('例外')
    // L20：表面一段——元素四类、越过入口、界外
    expect(wrapper.find('[aria-label="表面元素四类"]').text()).toMatch(/端口.*操作.*类型.*数据/)
    expect(text).toContain('越过入口')
    expect(text).toContain('界外')
  })

  it('运行视角：关系（只读）、节点、回放与共享；没有结构视图与代码事实的组', async () => {
    const { wrapper } = await open('/?sc=sc.play')
    // 运行视角缺省收起
    expect(wrapper.find('.body').exists()).toBe(false)
    await wrapper.find('.head-btn').trigger('click')
    expect(titles(wrapper)).toEqual(['关系 · 三问四修饰', '节点', '回放', '共享 · 三个视角同义'])
    expect(wrapper.text()).toContain('交互中未建模')
    expect(wrapper.text()).not.toContain('结构中未建模')
  })

  it('L18：共享通道三处同文', async () => {
    const texts: string[] = []
    for (const url of ['/', '/?v=s', '/?sc=sc.play']) {
      const { wrapper } = await open(url)
      if (!wrapper.find('.body').exists()) await wrapper.find('.head-btn').trigger('click')
      const btn = wrapper.findAll('.group-btn').find(b => b.text().includes('共享'))!
      await btn.trigger('click')
      texts.push(wrapper.find('[aria-label="共享通道"]').text())
    }
    expect(new Set(texts).size).toBe(1)
    for (const c of SHARED_CHANNELS) expect(texts[0]).toContain(c.text)
    // ADR-0035：线型在共享组只剩实线 = 交互、虚线 = 依赖，波浪线是唯一例外
    expect(texts[0]).toContain('实线 = 交互')
    expect(texts[0]).toContain('虚线 = 依赖')
    expect(texts[0]).toContain('线型的唯一例外')
  })
})

describe('L21：三个开关与收起计数（B1、B4）、跨界折叠计数（B2），L20：总是展开表面', () => {
  it('只引类型缺省收起并给出本层束条数；打开写显示偏好 typeOnly（画布同读），折叠摘要列出；开关在设置块的「结构筛选与表面」组（L45）', async () => {
    const { wrapper, desk } = await open('/?v=s')
    const OFF = { typeOnly: false, invokesOnly: false, uncoveredOnly: false }
    expect(desk.facts.structureDisplay(OFF)!.hidden.type).toBe(2)
    // L45：开关在设置块，行上互指它控制的记号（点线）；图例组标题旁互指
    const settings = wrapper.find('[aria-label="设置"]')
    expect(settings.text()).toContain('设置')
    expect(wrapper.text()).toContain('图例')
    expect(wrapper.find('[aria-label="依赖 · 形态与档"], .group-btn').exists()).toBe(true)
    const count = wrapper.find('[data-testid="type-only-count"]')
    expect(count.text()).toContain('只引类型（点线） · 2 条已收起')
    expect(wrapper.find('[data-testid="legend-salience-exception"]').exists()).toBe(true)
    await wrapper.find('input[aria-label="只引类型"]').setValue(true)
    expect(wrapper.find('[data-testid="type-only-count"]').text()).toContain('只引类型（点线） · 2 条已显示')
    expect(useStructurePrefs('').prefs.value.typeOnly).toBe(true)
    expect(JSON.parse(localStorage.getItem('h5p-arch-desk:structure-prefs:')!)).toMatchObject({ typeOnly: true })
    await wrapper.find('.head-btn').trigger('click')
    expect(wrapper.find('.summary').text()).toContain('只引类型已显示')
  })

  it('只看交互使用、只看未解释：关着时给出打开后会收起的条数，打开后为已收起的条数（structureDisplay.hidden），写显示偏好', async () => {
    const { wrapper, desk } = await open('/?v=s')
    const OFF = { typeOnly: false, invokesOnly: false, uncoveredOnly: false }
    const value = desk.facts.structureDisplay({ ...OFF, invokesOnly: true })!.hidden.value
    const covered = desk.facts.structureDisplay({ ...OFF, uncoveredOnly: true })!.hidden.covered
    expect(wrapper.find('[data-testid="value-count"]').text()).toContain(`打开后收起值使用的束 ${value} 条`)
    const unc = wrapper.find('[data-testid="uncovered-count"]')
    expect(unc.text()).toContain(`打开后收起已解释的束 ${covered} 条`)
    // 未解释的口径在开关行的悬停提示里（L45：设置行互指记号，长说明放悬停）
    expect((unc.element.closest('label') as HTMLElement).getAttribute('title')).toContain('既没有交互覆盖、形态也不是端口实现 / 子类 / 组装')
    await wrapper.find('input[aria-label="只看交互使用"]').setValue(true)
    await wrapper.find('input[aria-label="只看未解释"]').setValue(true)
    await wrapper.find('input[aria-label="总是展开表面"]').setValue(true)
    expect(wrapper.find('[data-testid="value-count"]').text()).toMatch(/值使用的束 \d+ 条已收起/)
    expect(wrapper.find('[data-testid="uncovered-count"]').text()).toMatch(/已解释的束 \d+ 条已收起/)
    expect(useStructurePrefs('').prefs.value).toMatchObject({ invokesOnly: true, uncoveredOnly: true, surfaceAlways: true })
    // 跨界折叠的条数（留在图例块）
    expect(wrapper.find('[data-testid="cross-count"]').text()).toMatch(/一端是边界节点的束 \d+ 条折叠/)
    await wrapper.find('.head-btn').trigger('click')
    const summary = wrapper.find('.summary').text()
    for (const s of ['只看交互使用', '只看未解释', '总是展开表面']) expect(summary).toContain(s)
  })

  it('L45：图例的类型行只读，筛选在设置块的「关系筛选」组；代码事实与组装的开关在设置块', async () => {
    const { wrapper } = await open('/')
    // 图例的类型行不再可点击（L45：一行不兼两职）
    expect(wrapper.find('.type-list').findAll('button')).toHaveLength(0)
    // 组标题旁互指
    expect(wrapper.text()).toContain('筛选在设置 · 关系筛选')
    expect(wrapper.text()).toContain('开关在设置 · 代码事实')
    expect(wrapper.text()).toContain('开关在设置 · 组装')
    expect(wrapper.text()).toContain('开关在设置 · 演化')
    // 设置块里的关系筛选：勾掉「未分类」后「全部显示」出现
    const settings = wrapper.find('[aria-label="设置"]')
    const unclassified = settings.find('input[aria-label="关系类型：未分类"]')
    expect(unclassified.exists()).toBe(true)
    await unclassified.setValue(false)
    expect(settings.text()).toContain('全部显示')
    await settings.find('button.link').trigger('click')
    expect((wrapper.find('[aria-label="设置"]').find('input[aria-label="关系类型：未分类"]').element as HTMLInputElement).checked).toBe(true)
    // 代码事实与组装的开关在设置块（图例组标题右侧不再有开关）
    expect(wrapper.find('[aria-label="代码事实"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="组装"]').exists()).toBe(true)
    expect(wrapper.find('.group-head .switch').exists()).toBe(false)
  })

  it('交互视角「代码事实 · 标签」组列出标签词表（L26）与承载叠加一句（缺段为警示色虚线）', async () => {
    const { wrapper } = await open('/')
    expect(wrapper.find('[data-testid="carrier-legend"]').text()).toContain('缺的一段画成警示色虚线')
    expect(wrapper.findAll('[data-tag]').map(x => x.attributes('data-tag'))).toEqual(['未证实', '违规', '未解释', '缺段'])
    expect(wrapper.text()).not.toContain('虚线 + ?')
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
