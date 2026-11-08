// @vitest-environment jsdom
/**
 * 人确认层的界面（RV-3、RV-4；Z3–Z5）：模块面板的状态标记、「自上次确认以来的改动」与「确认 / 复核并确认」；模块树的需复核标记与「只看需复核」；根层健康度一行。
 * G11（V15c）起 ⑤ 证据与细节缺省折叠，断言节内内容前先全部展开。
 */
import { NO_WRITER } from '../../src/state/sync/writer'
import { describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import Panel from '../../src/components/panel/Panel.vue'
import SideBar from '../../src/components/tree/SideBar.vue'
import { createDeskState, type ModelWriter } from '../../src/state/useDeskState'
import { DESK_STATE } from '../../src/state/inject'
import { loadModel, reviewEntries, reviewHash, type ReviewedInput } from '../../src/model'
import { sampleFiles } from '../fixtures/sample'

/** 展开面板里全部折叠的节（⑤ 段缺省折叠，V15c） */
async function expandAll(wrapper: VueWrapper) {
  for (const b of wrapper.findAll('button.fold[aria-expanded="false"]')) await b.trigger('click')
  await flushPromises()
}

const idx = loadModel(sampleFiles()).index
const [ok] = reviewEntries(idx, ['infra.framework'], { source: 'manual', at: '2026-10-22', note: '看过' })
const REVIEWED = `reviewed:\n  - ${JSON.stringify(ok)}\n  - { module: infra.mus, at: '2026-10-20', hash: stale, source: 'sketch:next', summary: { responsibility: 旧职责, provides: [{ id: if.gone, signature: 'gone(): void' }] } }\n`

async function mountWith(Comp: typeof Panel | typeof SideBar, url: string, reviewed = REVIEWED, version?: { design: string; revision: string }) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const batches: ReviewedInput[][] = []
  const writer: ModelWriter = {
    ...NO_WRITER,
    feedback: async () => ({ ok: false, error: 'x' }),
    allow: async () => ({ ok: false, error: 'x' }),
    ignore: async () => ({ ok: false, error: 'x' }),
    reviewed: async b => (batches.push(b.entries), { ok: true, file: 'model/test/reviewed.yaml' }),
    accept: async () => ({ ok: false, error: 'x' }),
    archive: async () => ({ ok: false, error: 'x' }),
  }
  const desk = createDeskState(async () => ({ dir: 'model/test', files: sampleFiles({ 'reviewed.yaml': reviewed }) }), {
    writer,
    ...(version ? { version } : {}),
  })
  desk.attachRouter(router)
  await desk.init()
  const wrapper = mount(Comp, { global: { provide: { [DESK_STATE as symbol]: desk, panelUnfold: { value: true } }, plugins: [router] } })
  await flushPromises()
  return { wrapper, desk, batches }
}

describe('模块面板的确认（RV-3）', () => {
  it('已确认：标题旁「已确认 <日期>」，没有改动块，底部「确认」说明再次确认会更新记录', async () => {
    const { wrapper } = await mountWith(Panel, '/?sel=m:infra.framework')
    const badge = wrapper.find('.badge.review')
    expect(badge.text()).toBe('已确认 2026-10-22')
    expect(badge.attributes('title')).toContain('看过')
    expect(wrapper.text()).not.toContain('自上次确认以来的改动')
    await expandAll(wrapper)
    expect(wrapper.text()).toContain('再次确认会更新那一条记录')
    expect(wrapper.find('button[type=submit]').text()).toBe('确认')
  })
  it('需复核：标记「需复核」，职责下列出差异（职责按行、接口按 ID），按钮为「复核并确认」', async () => {
    const { wrapper } = await mountWith(Panel, '/?sel=m:infra.mus')
    expect(wrapper.find('.badge.review').text()).toBe('需复核')
    const text = wrapper.text()
    expect(text).toContain('自上次确认以来的改动')
    await expandAll(wrapper)
    const expanded = wrapper.text()
    expect(expanded).toContain('2026-10-20 确认（草图归档 next）')
    expect(expanded).toContain('旧职责')
    expect(expanded).toContain('if.gone')
    expect(wrapper.find('button[type=submit]').text()).toBe('复核并确认')
  })
  it('确认：发出记录（来源 manual、带 note）；勾「也确认子模块」时子树各一条', async () => {
    const { wrapper, batches, desk } = await mountWith(Panel, '/?sel=m:infra.framework')
    await expandAll(wrapper)
    await wrapper.find('input[aria-label=确认说明]').setValue('第二级看过')
    await wrapper.find('form.confirm').trigger('submit')
    await flushPromises()
    expect(batches).toHaveLength(1)
    expect(batches[0].map(e => e.module)).toEqual(['infra.framework'])
    expect(batches[0][0]).toMatchObject({ source: 'manual', note: '第二级看过' })
    expect(wrapper.text()).toContain('已写入')
    await wrapper.find('.kids input').setValue(true)
    await wrapper.find('form.confirm').trigger('submit')
    await flushPromises()
    const sub = desk.review.subtree('infra.framework')
    expect(sub.length).toBeGreaterThan(1)
    expect(batches[1].map(e => e.module)).toEqual(sub)
  })
  it('范围外的叶子模块：没有记录时不显示标记与确认；设计版本只显示状态、没有确认（Z1、Z4）', async () => {
    const leaf = await mountWith(Panel, '/?level=infra.framework&sel=m:infra.framework.sm')
    expect(leaf.wrapper.find('.badge.review').exists()).toBe(false)
    expect(leaf.wrapper.find('form.confirm').exists()).toBe(false)
    const design = await mountWith(Panel, '/?sel=m:infra.mus', REVIEWED, { design: 'next', revision: 'r2' })
    expect(design.wrapper.find('.badge.review').text()).toBe('需复核')
    expect(design.wrapper.find('form.confirm').exists()).toBe(false)
  })
  it('根层健康度一行：核心模块已确认 a / b · 需复核 c（Z5）', async () => {
    const { wrapper, desk } = await mountWith(Panel, '/')
    const c = desk.review.counts.value
    expect(wrapper.text()).toContain(`核心模块已确认 ${c.reviewed} / ${c.scope} · 需复核 ${c.stale}`)
    expect(c).toMatchObject({ reviewed: 1, stale: 1 })
  })
})

describe('系统与层的确认（RV-7、Z7，ADR-0042）', () => {
  it('根层系统面板：「简介」是第一节，标题旁有系统的确认状态，简介下「确认」发出以系统 ID 记的一条', async () => {
    const { wrapper, batches, desk } = await mountWith(Panel, '/')
    const sid = desk.index.value!.rootId
    expect(wrapper.find('.system-panel .section').text()).toContain('简介')
    // V15a：确认徽标在核对卡的「确认」行
    expect(wrapper.find('.system-panel [data-card="check"] .badge.review').text()).toBe('未确认')
    await expandAll(wrapper)
    expect(wrapper.text()).toContain('认可上面的定位与核心原则')
    await wrapper.find('form.confirm').trigger('submit')
    await flushPromises()
    expect(batches[0].map(e => e.module)).toEqual([sid])
    expect(batches[0][0].hash).toBe(reviewHash(desk.index.value!, sid))
  })
  it('层：面板提供「确认」（层原来不在 Z4 范围），不计入健康度', async () => {
    const { wrapper, desk } = await mountWith(Panel, '/?sel=m:infra')
    await expandAll(wrapper)
    expect(wrapper.find('form.confirm').exists()).toBe(true)
    expect(desk.review.scope.value.has('infra')).toBe(false)
  })
})

describe('模块树的需复核标记（RV-4）', () => {
  it('需复核的节点带「需复核」，已确认的带 ✓；「只看需复核」只列含需复核模块的分支并展开到它', async () => {
    // LY-4d：「只看需复核」收在侧栏「筛选 ▾」弹层里
    const { wrapper } = await mountWith(SideBar, '/')
    const row = (id: string) => wrapper.find(`[data-id="${id}"]`)
    expect(row('infra').exists()).toBe(true)
    await wrapper.find('[data-side-filter]').trigger('click')
    expect(wrapper.find('.chk').text()).toContain('只看需复核 1')
    await wrapper.find('.chk input').setValue(true)
    await flushPromises()
    expect(row('infra.mus').exists()).toBe(true)
    expect(row('infra.mus').find('.tag.stale').text()).toBe('需复核')
    expect(row('infra.framework').exists()).toBe(false)
    expect(row('app').exists()).toBe(false)
    expect(wrapper.find('[data-filter-count]').text()).toBe('1')
    await wrapper.find('.chk input').setValue(false)
    await flushPromises()
    expect(row('infra.framework').find('.tag.reviewed').text()).toBe('✓')
    expect(row('app').exists()).toBe(true)
  })
})
