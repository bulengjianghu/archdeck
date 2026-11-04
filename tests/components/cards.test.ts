// @vitest-environment jsdom
/**
 * 卡片（第十八轮 Y2、Y3，ADR-0057；走查 4 修订，ADR-0061）：CD-1 设计变量、CD-3 身份卡（粘顶，名称后附「图解 ›」）、
 * CD-5 卡头、CD-6 散块成卡、CD-7 回放胶囊、CD-8 胶囊的位置（playerPlacement）、CD-9 路线的编号与「选路线」、CD-10 帮助。
 * CD-4 名称胶囊已作废（ADR-0061：身份卡改回粘顶，不再需要）。CD-2（属性列即画布、悬浮时空隙落到画布）与
 * CD-7、CD-8 的实际版面由 E2E `e2e/cards.spec.ts` 守。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import Panel from '../../src/components/panel/Panel.vue'
import PlayerBar from '../../src/components/PlayerBar.vue'
import GuideDialog from '../../src/components/GuideDialog.vue'
import { playerPlacement } from '../../src/components/shared/playerPlacement'
import { createDeskState } from '../../src/state/useDeskState'
import { DESK_STATE } from '../../src/state/inject'
import { sampleFiles, scenarioFiles } from '../fixtures/sample'

const mounted: VueWrapper[] = []
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
})

async function setup(url: string, files = sampleFiles()) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => ({ dir: 'model/test', files }))
  desk.attachRouter(router)
  await desk.init()
  await flushPromises()
  return { desk, global: { provide: { [DESK_STATE as symbol]: desk }, plugins: [router] } }
}

async function mountPanel(url: string, files = sampleFiles()) {
  const { desk, global } = await setup(url, files)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const wrapper = mount(Panel, { global, attachTo: host })
  mounted.push(wrapper)
  await flushPromises()
  return { wrapper, desk, host }
}

const src = (p: string) => readFileSync(resolve(__dirname, '../../src', p), 'utf8')

describe('CD-1：卡片设计变量', () => {
  it('共用样式定义一组卡片变量与 .desk-card / .desk-pill，暗色主题另给边框与投影', () => {
    const css = src('styles.css')
    for (const v of ['--card-bg', '--card-border', '--card-radius: 12px', '--pill-radius', '--card-shadow', '--card-gap: 12px']) expect(css).toContain(v)
    const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'))
    expect(dark).toContain('--card-border')
    expect(dark).toContain('--card-shadow')
    expect(css).toMatch(/\.desk-card \{\s*border-radius: var\(--card-radius\)/)
  })

  it('图例、缩放胶囊、回放胶囊、属性卡片都用这套变量，不自写圆角与阴影', () => {
    expect(src('components/display/Legend.vue')).toMatch(/border-radius: var\(--pill-radius\)[\s\S]*box-shadow: var\(--card-shadow\)/)
    expect(src('components/GraphCanvas.vue')).toContain('zoom-pill desk-pill')
    expect(src('components/PlayerBar.vue')).toContain('class="player desk-pill"')
    expect(src('components/panel/Panel.vue')).toMatch(/\.panel \.card,[\s\S]*border-radius: var\(--card-radius\);\s*box-shadow: var\(--card-shadow\)/)
  })
})

describe('CD-3：身份卡', () => {
  const OBJECTS: [string, string][] = [
    ['系统', '/'],
    ['模块', '/?level=infra.framework&sel=m:infra.framework.sm'],
    ['参与者', '/?sel=a:actor.biz'],
    ['聚合边', '/?sel=e:app.solution->infra.player:queries'],
    ['端口', '/?sel=p:if.io'],
    ['层', '/?sel=s:app/top'],
  ]
  for (const [what, url] of OBJECTS)
    it(`${what}：面板的第一张卡是身份卡（名称 h2 与徽标行），粘在属性列上沿（ADR-0061）`, async () => {
      const files = url.includes('a:')
        ? scenarioFiles()
        : url.includes('e:')
          ? sampleFiles({ 'zz-up.yaml': 'relations:\n  - { id: r8, from: app.solution, to: infra.player, type: queries }' })
          : sampleFiles()
      const { wrapper } = await mountPanel(url, files)
      const first = wrapper.find('.panel > div:not(.sk-panel) > :first-child, .panel > .id-card')
      expect(first.classes()).toContain('id-card')
      expect(first.find('h2').exists()).toBe(true)
      expect(first.find('.badges').exists()).toBe(true)
      expect(src('components/panel/Panel.vue')).toMatch(/\.panel \.id-card \{[^}]*position: sticky/)
    })

  it('模块的「进入 ⌄」「在此设计」在徽标之下另起一行（.acts），不在名称一行', async () => {
    const { wrapper } = await mountPanel('/?sel=m:infra')
    const card = wrapper.find('.id-card')
    const acts = card.find('.acts')
    expect(acts.exists()).toBe(true)
    expect(acts.text()).toContain('进入 ⌄')
    const children = card.element.children
    expect(children[0].querySelector('h2')?.textContent).toBeTruthy()
    expect(children[children.length - 1].classList.contains('acts')).toBe(true)
  })

  it('× 在身份卡右上角、悬停身份卡或键盘聚焦时显出（DeskView 的样式）', () => {
    const desk = src('components/DeskView.vue')
    expect(desk).toMatch(/\.props-close \{[\s\S]*?opacity: 0;/)
    expect(desk).toContain('.panel-area:has(.id-card:hover) .props-close')
    expect(desk).toContain('.props-close:focus-visible')
  })
})

describe('CD-4：名称胶囊（已作废，ADR-0061）', () => {
  it('Panel 不再有名称胶囊机制——身份卡粘顶，胶囊与回顶部一并移除', () => {
    const panel = src('components/panel/Panel.vue')
    expect(panel).not.toContain('props-mini')
    expect(panel).not.toContain('mini-row')
    expect(panel).toMatch(/\.panel \.id-card \{[^}]*position: sticky;\s*top: 0/)
  })
})

describe('CD-5：卡头', () => {
  it('卡头为「标题 ▾」——记号跟在标题之后，收起为 ▸，结论在其后', async () => {
    const { wrapper } = await mountPanel('/?sel=m:infra')
    const t = wrapper.find('[data-card="understand"] .card-toggle')
    const parts = t.findAll('span').map(s => s.classes()[0])
    expect(parts.slice(0, 2)).toEqual(['card-title', 'caret'])
    expect(t.find('.caret').text()).toBe('▾')
    await t.trigger('click')
    expect(wrapper.find('[data-card="understand"] .caret').text()).toBe('▸')
    expect(wrapper.find('[data-card="understand"] .card-sum').exists()).toBe(true)
  })
})

describe('CD-6：其余块也成卡', () => {
  it('设计说明、清空说明、出处、设计 / 提交节都有卡片外观', () => {
    const panel = src('components/panel/Panel.vue')
    for (const sel of ['.panel .dropped', '.panel .design-section', '.panel .commit-section', '.panel .sk-panel']) expect(panel).toContain(sel)
    expect(panel).toMatch(/\.panel \.src \{[\s\S]*?background: var\(--card-bg\)/)
    expect(src('components/panel/DesignNote.vue')).toMatch(/\.design-note \{[\s\S]*?border-radius: var\(--card-radius\)/)
  })
})

describe('CD-8：回放胶囊的位置', () => {
  const base = { playerWidth: 400, zoomRight: 130, margin: 12 }
  it('并排（没有遮挡）：居中于画布', () => {
    expect(playerPlacement({ ...base, canvasWidth: 1000, inset: 0 })).toEqual({ left: 300, fits: true })
  })
  it('悬浮：居中于未被卡片盖住的部分', () => {
    expect(playerPlacement({ ...base, canvasWidth: 1400, inset: 346 })).toEqual({ left: (1054 - 400) / 2, fits: true })
  })
  it('与缩放胶囊相碰时右移让开', () => {
    expect(playerPlacement({ ...base, canvasWidth: 1300, inset: 346 }).left).toBe(277)
    expect(playerPlacement({ ...base, canvasWidth: 600, inset: 0 })).toEqual({ left: 142, fits: true })
  })
  it('剩余宽度放不下：居中于整个画布（仍让开缩放胶囊），fits 为假（悬浮卡片列让出底部）', () => {
    expect(playerPlacement({ ...base, canvasWidth: 801, inset: 346 })).toEqual({ left: 200.5, fits: false })
    expect(playerPlacement({ ...base, canvasWidth: 600, inset: 346 })).toEqual({ left: 142, fits: false })
  })
})

describe('CD-7、CD-9：回放胶囊与路线', () => {
  async function mountPlayer() {
    const { desk, global } = await setup('/?sc=sc.play', scenarioFiles())
    const wrapper = mount(PlayerBar, { global })
    mounted.push(wrapper)
    await flushPromises()
    return { desk, wrapper }
  }

  it('胶囊：◀ 第 n / ≥N 步 ▶、进度条；没有自动播放', async () => {
    const { wrapper, desk } = await mountPlayer()
    expect(wrapper.classes()).toContain('desk-pill')
    expect(wrapper.find('.prev').attributes('aria-label')).toContain('上一步')
    expect(wrapper.find('.count').text()).toMatch(/^第 0 \/ (≥ )?\d+ 步$/)
    await wrapper.find('.next').trigger('click')
    expect(desk.run.walked.value).toBe(1)
    expect(wrapper.find('.count').text()).toMatch(/^第 1 \//)
    expect(wrapper.text()).not.toMatch(/播放|暂停/)
  })

  it('路线：平时只显示编号；停在未选的分支点为「选路线」并自动展开浮层（分支选择 + 路线总览）；选了以后为「路线 k」', async () => {
    const { wrapper, desk } = await mountPlayer()
    for (let i = 0; i < 20 && !desk.run.branchPoint.value; i++) desk.next()
    await flushPromises()
    const bp = desk.run.branchPoint.value!
    expect(bp).toBeTruthy()
    const btn = wrapper.find('[data-testid="route-btn"]')
    expect(btn.text()).toBe('选路线 ▾')
    expect(btn.classes()).toContain('need')
    const pop = wrapper.find('[data-testid="route-pop"]')
    expect(pop.exists()).toBe(true)
    expect(pop.find('.branches').exists()).toBe(true)
    expect(pop.find('.route').exists()).toBe(true)
    await pop.findAll('.branches .opt')[1].trigger('click')
    await flushPromises()
    expect(desk.run.branchPoint.value?.id).not.toBe(bp.id)
    const label = wrapper.find('[data-testid="route-btn"]').text()
    expect(label).toMatch(/^路线 2(·\d)* ▾$|^选路线 ▾$/)
    if (!desk.run.branchPoint.value) {
      expect(label.startsWith('路线 2')).toBe(true)
      expect(wrapper.find('[data-testid="route-btn"]').classes()).not.toContain('need')
    }
  })

  it('浮层可收起（再单击按钮），到下一个分支点前不再自动展开', async () => {
    const { wrapper, desk } = await mountPlayer()
    for (let i = 0; i < 20 && !desk.run.branchPoint.value; i++) desk.next()
    await flushPromises()
    await wrapper.find('[data-testid="route-btn"]').trigger('click')
    expect(wrapper.find('[data-testid="route-pop"]').exists()).toBe(false)
    desk.prev()
    desk.next()
    await flushPromises()
    expect(wrapper.find('[data-testid="route-pop"]').exists()).toBe(false)
  })
})

describe('CD-10：帮助写明回放控制', () => {
  it('运行一节：回放在画布底部的胶囊里、← → 单步、时序图上单击某一步即跳到那一步', () => {
    const wrapper = mount(GuideDialog)
    mounted.push(wrapper)
    const t = wrapper.find('[data-testid="guide-replay"]').text()
    expect(t).toContain('胶囊')
    expect(t).toContain('← →')
    expect(t).toContain('时序图上单击某一步即跳到那一步')
  })
})
