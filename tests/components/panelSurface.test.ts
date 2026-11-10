// @vitest-environment jsdom
/**
 * 第八轮 T3（ADR-0031 修订、ADR-0032）：属性面板的束与表面、承载——
 * 依赖边面板「文件依赖」按元素分组与越过入口建议（A6、L21⑥）、画布单击元素时面板定位（C9）；
 * 模块「表面」一节（C7、L20③、K18、K19）；关系面板「承载」一节（D5、L22、K5d、K20）；
 * 步骤包含链改元素级、证据等级由承载判定导出（D-25、S18b，裁决 T0-10），时序图「?」同口径。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import Panel from '../../src/components/panel/Panel.vue'
import StepPanel from '../../src/components/panel/StepPanel.vue'
import { resetStructurePrefs } from '../../src/components/display/useDisplayPrefs'
import { focusSurfaceElement, resetSurfaceFocus } from '../../src/components/panel/surfaceFocus'
import { VERDICT_LEVEL, alignedEvidence, alignedLevel, weakestLevel, stepChain } from '../../src/components/panel/chain'
import { createDeskState, type SourceFetcher } from '../../src/state/useDeskState'
import { DESK_STATE } from '../../src/state/inject'
import { EVIDENCE_LEVEL_LABELS } from '../../src/components/shared/labels'
import type { Carrier, ExportedSymbol, FileDep, SourcePayload } from '../../src/model'

const MODEL = `
modules:
  - { id: a, name: A, responsibility: 发起方, codeRefs: [src/a/**] }
  - { id: b, name: B, responsibility: 只引类型, codeRefs: [src/b/**] }
  - { id: c, name: C, responsibility: 越过入口, codeRefs: [src/c/**] }
  - { id: d, name: D, responsibility: 第三个使用者, codeRefs: [src/d/**] }
  - { id: lib, name: Lib, responsibility: 被依赖方, codeRefs: [src/lib/**], entry: src/lib/index.ts, provides: [if.run] }
  - { id: bus, name: Bus, role: bus, responsibility: 总线, codeRefs: [src/bus/**], entry: src/bus/index.ts }
  - { id: bare, name: Bare, responsibility: 没有入口, codeRefs: [src/bare/**] }
interfaces:
  - { id: if.run, name: 'run()', owner: lib }
relations:
  - { id: r1, from: a, to: lib, type: queries, interface: if.run }
  - { id: r2, from: b, to: c, type: commands }
  - { id: r3, from: a, to: c, type: notifies, via: 'bus:bus' }
`
const SCENARIO = `
scenario:
  id: sc.t
  name: 测试
  steps:
    - { call: { from: a, to: lib, label: run, relation: r1 } }
    - { call: { from: b, to: c, label: go, relation: r2 } }
    - { async: { from: a, to: c, label: ping, relation: r3 } }
`
const FILES = [
  'src/a/a.ts',
  'src/b/b.ts',
  'src/c/c.ts',
  'src/d/d.ts',
  'src/lib/index.ts',
  'src/lib/run.ts',
  'src/bus/index.ts',
  'src/bus/emit.ts',
  'src/bare/x.ts',
]
const LOCAL: SourcePayload = { status: 'local', root: '/repo', files: FILES, packages: {} }
const DEPS: FileDep[] = [
  // a → lib：经入口用 run（交互使用）与 Item（类型）
  { from: 'src/a/a.ts', to: 'src/lib/run.ts', via: 'src/lib/index.ts', kind: 'value', line: 1, names: ['run', 'Item'], uses: true, invokes: true },
  { from: 'src/b/b.ts', to: 'src/lib/run.ts', via: 'src/lib/index.ts', kind: 'type', line: 1, names: ['Item'] },
  { from: 'src/d/d.ts', to: 'src/lib/run.ts', via: 'src/lib/index.ts', kind: 'type', line: 4, names: ['Item'] },
  // c → lib：越过入口（直接导入 run.ts）
  { from: 'src/c/c.ts', to: 'src/lib/run.ts', via: 'src/lib/run.ts', kind: 'value', line: 7, names: ['run'], uses: true, invokes: true },
  // a → bus：发布操作；c 没有依赖总线（经总线缺订阅段）
  { from: 'src/a/a.ts', to: 'src/bus/emit.ts', via: 'src/bus/index.ts', kind: 'value', line: 3, names: ['emit'], uses: true, invokes: true },
  // a → bare：没有入口的模块
  { from: 'src/a/a.ts', to: 'src/bare/x.ts', via: 'src/bare/x.ts', kind: 'value', line: 5, names: ['x'], uses: true, invokes: true },
]
const EXPORTS: Record<string, ExportedSymbol[]> = {
  'src/lib/index.ts': [
    { name: 'run', kind: 'function', line: 1, from: 'src/lib/run.ts' },
    { name: 'Item', kind: 'type', line: 3, from: 'src/lib/run.ts' },
  ],
  'src/bus/index.ts': [{ name: 'emit', kind: 'function', line: 1, from: 'src/bus/emit.ts' }],
}
const fetcher: SourceFetcher = {
  tree: async () => LOCAL,
  file: async () => null,
  exports: async p => EXPORTS[p] ?? [],
  facts: async () => ({ deps: { deps: DEPS, external: {}, parsed: FILES.length }, baseline: null, ledger: [] }),
}
const flush = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0))
    await flushPromises()
  }
}

async function open(url: string, opts: { facts?: boolean } = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(
    async () => ({
      dir: 'model/test',
      files: [
        { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
        { path: 'modules.yaml', text: MODEL },
        { path: 'scenarios/t.yaml', text: SCENARIO },
      ],
    }),
    opts.facts === false ? {} : { source: fetcher },
  )
  desk.attachRouter(router)
  await desk.init()
  await flush()
  // 入口导出按需取：先读一次表面，取到后派生重算
  desk.facts.surfaceOf('lib')
  desk.facts.surfaceOf('bus')
  await flush()
  // 第二十轮 §6：运行视角的步骤面板住辅助栏步骤节（抽屉不渲染）——场景里挂步骤面板本身
  const comp = url.includes('sc=') ? StepPanel : Panel
  const wrapper = mount(comp, { global: { provide: { [DESK_STATE as symbol]: desk, panelUnfold: { value: true } }, plugins: [router] } })
  await flush()
  return { desk, wrapper }
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  localStorage.clear()
  resetStructurePrefs()
  resetSurfaceFocus()
})

describe('A6：依赖边面板「文件依赖」按元素分组', () => {
  it('元素组带名字、种类、声明状态、形态与档、文件:行；整模块一组', async () => {
    const { wrapper } = await open('/?v=s&sel=d:a->lib')
    expect(wrapper.find('.dep-panel h2').text()).toBe('A → Lib')
    const groups = wrapper.findAll('.dep-files .group')
    expect(groups.map(g => g.attributes('data-element'))).toEqual(['Item', 'run'])
    const run = groups.find(g => g.attributes('data-element') === 'run')!
    expect(run.text()).toContain('操作')
    expect(run.text()).toContain('已声明且导出')
    expect(run.text()).toContain('使用 · 交互使用')
    expect(run.text()).toContain('src/a/a.ts:1')
    const item = groups.find(g => g.attributes('data-element') === 'Item')!
    expect(item.text()).toContain('类型')
    expect(item.text()).toContain('导出未声明')
    expect(wrapper.find('.dep-files .sum').text()).toContain('2 个元素')
    // 交互覆盖（K17 明细）：r1
    expect(wrapper.find('.dep-coverage h3').text()).toContain('1')
  })

  it('越过入口单列一组，带「经入口访问 / 提升到入口」建议', async () => {
    const { wrapper } = await open('/?v=s&sel=d:c->lib')
    const g = wrapper.find('.dep-files .group.bypass')
    expect(g.attributes('data-element')).toBe('!')
    expect(g.text()).toContain('越过入口')
    expect(g.text()).toContain('src/c/c.ts:7')
    const advice = g.find('.advice').text()
    expect(advice).toContain('经入口访问')
    expect(advice).toContain('src/lib/index.ts')
    expect(advice).toContain('提升到入口')
    expect(advice).toContain('run')
  })

  it('C9：画布单击元素级边时（surfaceFocus）面板滚到该元素的分组并高亮', async () => {
    const { wrapper } = await open('/?v=s&sel=d:a->lib')
    focusSurfaceElement('lib', 'run')
    await flush()
    expect(wrapper.find('.dep-files .group[data-element="run"]').classes()).toContain('flash')
  })
})

describe('C7：模块「表面」一节', () => {
  it('结构视角在「结构」之后：W / B、元素清单（种类 · 声明状态 · 扇入 · 使用它的模块）按扇入排序', async () => {
    const { wrapper, desk } = await open('/?v=s&sel=m:lib')
    // PC-8：结构指标与表面元素是核对卡相邻的两个清单
    const sections = wrapper.findAll('[data-card="check"] .lists > section, [data-card="check"] .lists > div > section').map(x => x.classes())
    const iStructure = sections.findIndex(c => c.includes('module-structure'))
    const iSurface = sections.findIndex(c => c.includes('module-surface'))
    expect(iStructure).toBeGreaterThanOrEqual(0)
    expect(iSurface).toBe(iStructure + 1)
    const sec = wrapper.find('.module-surface')
    const m = desk.facts.surfaceMetricsOf('lib')!
    expect(sec.text()).toContain(`表面宽度 W${m.w}`)
    expect(sec.text()).toContain(`越过入口 B${m.b}`)
    expect(m.b).toBe(1)
    const els = sec.findAll('.element')
    expect(els.map(e => e.attributes('data-element'))).toEqual(['Item', 'run'])
    expect(els[0].text()).toContain('扇入 3')
    expect(els[0].text()).toContain('导出未声明')
    expect(els[0].text()).toMatch(/使用它的模块\s*A、B、D/)
    // 单击使用它的模块即定位
    await els[0].find('.users button').trigger('click')
    await flush()
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'a' })
  })

  it('越过入口清单（依赖方文件:行 → 符号）与三类建议', async () => {
    const { wrapper } = await open('/?v=s&sel=m:lib')
    const sec = wrapper.find('.module-surface')
    const bp = sec.find('[aria-label="越过入口"]')
    expect(bp.text()).toContain('src/c/c.ts:7')
    expect(bp.text()).toContain('run')
    const advice = sec.find('[aria-label="建议"]')
    expect(advice.find('[data-advice="promote"]').text()).toContain('提升到入口')
    expect(advice.find('[data-advice="declare"]').text()).toContain('Item')
    expect(advice.find('[data-advice="declare"]').text()).toContain('声明接口')
    expect(advice.find('[data-advice="via-entry"]').text()).toContain('改经入口')
  })

  it('G12（V16）：越过入口清单与建议二级折叠带计数，W / B 度量与元素清单常显', async () => {
    const { wrapper } = await open('/?v=s&sel=m:lib')
    const sec = wrapper.find('.module-surface')
    // 越过入口清单：details 折叠、summary 带计数，缺省收起（O11 面板版）
    const bp = sec.find('[aria-label="越过入口"] details')
    expect(bp.exists()).toBe(true)
    expect(bp.attributes('open')).toBeUndefined()
    expect(bp.find('summary').text()).toContain('越过入口 · 1 条')
    await bp.find('summary').trigger('click')
    expect(bp.text()).toContain('src/c/c.ts:7')
    // 建议：折叠带计数（提升到入口 / 声明接口 / 改经入口共 3 条）
    const advice = sec.find('[aria-label="建议"] details')
    expect(advice.exists()).toBe(true)
    expect(advice.attributes('open')).toBeUndefined()
    expect(advice.find('summary').text()).toContain('建议 · 3 条')
    // 常显：W / B 度量与元素清单不折叠
    expect(sec.find('dl.dims').exists()).toBe(true)
    expect(sec.findAll('.element').length).toBeGreaterThan(0)
    expect(sec.find('dl.dims .fold').exists()).toBe(false)
  })

  it('没有入口时说明原因；交互视角没有这一节；没有代码事实时只有声明接口', async () => {
    const { wrapper, desk } = await open('/?v=s&sel=m:bare')
    expect(wrapper.find('.module-surface .no-entry').text()).toContain('没有入口')
    desk.setMode('interaction')
    await flush()
    expect(wrapper.find('.module-surface').exists()).toBe(false)
    const nf = await open('/?v=s&sel=m:lib', { facts: false })
    expect(nf.wrapper.find('.module-surface').text()).toContain('没有代码事实：表面只有声明的接口')
    expect(nf.wrapper.find('.module-surface').text()).toContain('run')
  })

  it('C9：画布单击元素（surfaceFocus）时滚到该元素', async () => {
    const { wrapper } = await open('/?v=s&sel=m:lib')
    focusSurfaceElement('lib', 'run')
    await flush()
    expect(wrapper.find('.module-surface .element[data-element="run"]').classes()).toContain('flash')
  })
})

describe('D5、L22：关系面板「承载」一节', () => {
  it('齐全：模板、判定、各段的元素与文件:行', async () => {
    const { wrapper } = await open('/?sel=r:r1')
    const sec = wrapper.find('.relation-carrier')
    // PC-10：承载是核对卡的清单，标题带段数
    expect(sec.find('h3').text()).toMatch(/^承载\d+$/)
    expect(sec.find('.verdict').text()).toContain('直接')
    expect(sec.find('.verdict').text()).toContain('齐全')
    const seg = sec.find('.segment')
    expect(seg.text()).toContain('A → Lib的操作')
    expect(seg.find('code').text()).toBe('run')
    expect(seg.find('.file').text()).toBe('src/a/a.ts:1')
  })

  it('缺段：缺的段标「缺」并给建议；第三个节点（总线）可定位', async () => {
    const { wrapper, desk } = await open('/?sel=r:r3')
    const sec = wrapper.find('.relation-carrier')
    expect(sec.find('.verdict').text()).toContain('经总线')
    expect(sec.find('.verdict').text()).toContain('缺段')
    const segs = sec.findAll('.segment')
    expect(segs.map(s => s.attributes('data-role'))).toEqual(['publish', 'subscribe'])
    expect(segs[0].text()).toContain('emit')
    expect(segs[1].classes()).toContain('missing')
    expect(segs[1].text()).toContain('缺')
    expect(segs[1].text()).toContain('接收方没有依赖总线的订阅操作')
    const third = sec.find('.third')
    expect(third.text()).toBe('Bus')
    await third.trigger('click')
    await flush()
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'bus' })
  })

  it('无承载', async () => {
    const { wrapper } = await open('/?sel=r:r2')
    expect(wrapper.find('.relation-carrier .verdict').text()).toContain('无承载')
  })
})

describe('D-25、S18b：包含链改元素级，证据等级由承载判定导出（裁决 T0-10）', () => {
  const carrier = (verdict: Carrier['verdict']): Carrier => ({ relation: 'r', template: 'direct', segments: [], verdict })

  it('承载判定 → 证据等级：齐全 ↔ 按名字匹配、模块级 ↔ 按模块依赖、无承载 ↔ 无证据、外部 ↔ 不判定', () => {
    expect(VERDICT_LEVEL).toEqual({ complete: 'name', 'module-level': 'module', partial: 'module', none: 'none', external: 'skipped' })
    expect(alignedLevel('none', carrier('complete'))).toBe('name')
    expect(alignedLevel('module', carrier('none'))).toBe('none')
    expect(alignedLevel('module', null)).toBe('module')
    // 时序图：一条消息取各帧（状态层已按承载对齐）最弱的一档，无承载才「?」
    const levels = new Map([
      ['f1', 'module' as const],
      ['f2', 'name' as const],
    ])
    expect(weakestLevel(['f1', 'f2'], levels)).toBe('module')
    expect(weakestLevel(['f1', 'f2'], new Map([...levels, ['f2', 'none' as const]]))).toBe('none')
  })

  it('步骤面板只有一条链：步骤 → 交互（承载判定词）→ 承载段（文件:行）；等级与链同一个词，候选调用点取承载段', async () => {
    const { wrapper, desk } = await open('/?sc=sc.t')
    const frames = [...desk.run.plan.value!.frames.values()]
    const f1 = frames.find(f => f.relation === 'r1')!
    desk.seek(f1.id)
    await flush()
    const chain = wrapper.find('[aria-label="包含链"]')
    expect(chain.find('.link-interaction .verdict').text()).toBe('齐全')
    expect(chain.find('.link-carrier').text()).toContain('直接：各段都接到元素')
    expect(chain.find('.link-segment').text()).toContain('run')
    expect(chain.find('.link-segment').text()).toContain('src/a/a.ts:1')
    expect(chain.find('.link-dependency').exists()).toBe(false)
    expect(wrapper.find('.evidence-level .badge').text()).toBe(EVIDENCE_LEVEL_LABELS.name)
    expect(wrapper.findAll('.candidates li').map(li => li.find('button').text())).toEqual(['src/a/a.ts:1'])

    // 无承载 ↔ 无证据
    desk.seek(frames.find(f => f.relation === 'r2')!.id)
    await flush()
    expect(wrapper.find('[aria-label="包含链"] .link-interaction .verdict').text()).toBe('无承载')
    expect(wrapper.find('.evidence-level .badge').text()).toBe(EVIDENCE_LEVEL_LABELS.none)

    // 经总线缺段：不再一律不判定；缺段 ↔ 按模块依赖，逐段标出
    desk.seek(frames.find(f => f.relation === 'r3')!.id)
    await flush()
    const c3 = wrapper.find('[aria-label="包含链"]')
    expect(c3.find('.link-interaction .verdict').text()).toBe('缺段')
    expect(c3.find('.link-carrier').text()).toContain('经总线：缺 C → Bus的订阅操作')
    expect(c3.findAll('.link-segment.st-missing')).toHaveLength(1)
    expect(wrapper.find('.evidence-level .badge').text()).toBe(EVIDENCE_LEVEL_LABELS.module)
  })

  it('alignedEvidence：齐全时候选取承载段；无承载没有候选', async () => {
    const { desk } = await open('/')
    const idx = desk.index.value!
    const c1 = desk.facts.carrierOf('r1')!
    const e1 = alignedEvidence(idx, { level: 'module', candidates: [], total: 0 }, c1)
    expect(e1.level).toBe('name')
    expect(e1.candidates.map(f => `${f.from}:${f.line}`)).toEqual(['src/a/a.ts:1'])
    const e2 = alignedEvidence(idx, { level: 'module', candidates: [DEPS[0]], total: 1 }, desk.facts.carrierOf('r2')!)
    expect(e2).toMatchObject({ level: 'none', candidates: [], total: 0 })
    expect(stepChain(idx, { relation: 'r2', relationInferred: false }, desk.facts.carrierOf('r2'), null).carrier.state).toBe('missing')
  })
})
