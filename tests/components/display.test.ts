// @vitest-environment jsdom
/** 「显示」面板的图例按视角整体替换（L19、D-26）、共享通道三处同文（L18）、结构视角的「只引类型」开关与计数（L15）、帮助的四组（W-10） */
import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import DisplayPanel from '../../src/components/DisplayPanel.vue'
import GuideDialog from '../../src/components/GuideDialog.vue'
import { resetStructurePrefs, useStructurePrefs } from '../../src/components/display/useDisplayPrefs'
import { SHARED_CHANNELS } from '../../src/components/display/labels'
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
    expect(titles(wrapper)).toEqual(['关系 · 三问四修饰', '节点', '代码事实 · 线型', '组装', '演化 · 角标与波浪线', '共享 · 三个视角同义'])
  })

  it('结构视角：结构边、节点、规则叠加、指标、演化与共享；隐藏代码事实叠加组与关系类型筛选', async () => {
    const { wrapper } = await open('/?v=s')
    expect(titles(wrapper)).toEqual([
      '结构边 · 种类与档',
      '节点',
      '规则叠加 · 只标违规',
      '指标 · 不稳定度与共用件',
      '演化 · 角标与波浪线',
      '共享 · 三个视角同义',
    ])
    expect(wrapper.find('[aria-label="关系类型筛选"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="代码事实"]').exists()).toBe(false)
    const text = wrapper.text()
    for (const s of [
      '依赖 = 虚线 + 开口箭头',
      '子类 = 继承：实线 + 空心三角',
      '端口实现 = 虚线 + 空心三角',
      '组装 = 实线 + 实心菱形',
      '交互使用',
      '值使用',
      '只引类型',
    ])
      expect(text).toContain(s)
    expect(wrapper.findAll('svg[data-kind]').length).toBeGreaterThanOrEqual(7)
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
  })
})

describe('L15：只引类型开关与计数', () => {
  it('缺省收起并给出本层条数；打开写显示偏好 typeOnly（画布同读），折叠摘要列出', async () => {
    const { wrapper, desk } = await open('/?v=s')
    const sv = desk.facts.structure.value!
    expect(sv.facts && sv.typeOnly).toBe(2)
    const count = wrapper.find('[data-testid="type-only-count"]')
    expect(count.text()).toContain('本层只引类型的边 2 条已收起')
    // 口径说明（03-t4 裁决 1、02-t2-t3 T2 裁决 1）
    expect(count.text()).toContain('一对节点只按最强的一档计；含聚焦才画的')
    await wrapper.find('input[aria-label="只引类型"]').setValue(true)
    expect(wrapper.find('[data-testid="type-only-count"]').text()).toContain('本层只引类型的边 2 条已显示')
    expect(useStructurePrefs('').prefs.value.typeOnly).toBe(true)
    expect(JSON.parse(localStorage.getItem('h5p-arch-desk:structure-prefs:')!)).toMatchObject({ typeOnly: true })
    await wrapper.find('.head-btn').trigger('click')
    expect(wrapper.find('.summary').text()).toContain('只引类型已显示')
  })
})

describe('W-10：帮助按结构 / 交互 / 运行 / 对照与治理分组，另有共享一段', () => {
  it('四组标题与改名', () => {
    const w = mount(GuideDialog)
    expect(w.findAll('.group h3').map(h => h.text())).toEqual(['结构', '交互', '读一条线：三问四修饰', '运行', '对照与治理'])
    expect(w.text()).toContain('交互图变成舞台')
    expect(w.text()).not.toContain('结构图变成舞台')
    expect(w.find('[aria-label="三个视角共享"]').text()).toContain(SHARED_CHANNELS[5].text)
  })
})
