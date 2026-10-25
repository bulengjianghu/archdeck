// @vitest-environment jsdom
/**
 * 视图状态层 · 结构视角第八轮派生（ADR-0032）：desk.facts 的束与元素级边、过滤（B1 只引类型 / 只看交互使用、B4 只看未覆盖）、跨界折叠的入 · 出计数（B2）、
 * 选中束的聚焦（B3）、表面展开（C6）、表面与 W / B（K18、K19）、承载与步骤 → 交互 → 承载（K5d、S18b）、交互束散开（D7）；显示偏好三个新开关的本地记忆。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createDeskState, type SourceFetcher } from '../../src/state/useDeskState'
import { DEFAULT_STRUCTURE_PREFS, resetStructurePrefs, useStructurePrefs } from '../../src/components/display/useDisplayPrefs'
import type { StructureFilter } from '../../src/state/desk/facts'
import type { ExportedSymbol, FactsPayload, FileDep, SourcePayload } from '../../src/model'

const flush = () => new Promise(r => setTimeout(r, 0))

const MODEL = `
modules:
  - { id: a, name: A, responsibility: 发起方, codeRefs: [src/a/**] }
  - { id: b, name: B, responsibility: 只引类型, codeRefs: [src/b/**] }
  - { id: lib, name: Lib, responsibility: 被依赖方, codeRefs: [src/lib/**], entry: src/lib/index.ts, provides: [if.run] }
  - { id: edge, name: Edge, role: adapter, responsibility: 适配器, codeRefs: [src/edge/**] }
interfaces:
  - { id: if.run, name: 'run()', owner: lib }
relations:
  - { id: r1, from: a, to: lib, type: queries, interface: if.run }
`
const LOCAL: SourcePayload = {
  status: 'local',
  root: '/repo',
  files: ['src/a/a.ts', 'src/b/b.ts', 'src/lib/index.ts', 'src/lib/run.ts', 'src/edge/e.ts'],
  packages: {},
}
const DEPS: FileDep[] = [
  { from: 'src/a/a.ts', to: 'src/lib/run.ts', via: 'src/lib/index.ts', kind: 'value', line: 1, names: ['run'], uses: true, invokes: true },
  { from: 'src/b/b.ts', to: 'src/lib/run.ts', via: 'src/lib/index.ts', kind: 'type', line: 1, names: ['Item'] },
  { from: 'src/a/a.ts', to: 'src/b/b.ts', via: 'src/b/b.ts', kind: 'value', line: 2, uses: true },
  { from: 'src/edge/e.ts', to: 'src/lib/run.ts', via: 'src/lib/index.ts', kind: 'value', line: 1, names: ['run'], uses: true, invokes: true },
]
const EXPORTS: Record<string, ExportedSymbol[]> = {
  'src/lib/index.ts': [
    { name: 'run', kind: 'function', line: 1, from: 'src/lib/run.ts' },
    { name: 'Item', kind: 'type', line: 3, from: 'src/lib/run.ts' },
  ],
}
const facts: FactsPayload = { deps: { deps: DEPS, external: {}, parsed: 5 }, baseline: null, ledger: [] }
const fetcher: SourceFetcher = { tree: async () => LOCAL, file: async () => null, exports: async p => EXPORTS[p] ?? [], facts: async () => facts }

async function open(url = '/?v=s', version?: { design: string; revision: string }) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(
    async () => ({
      dir: 'model/test',
      files: [
        { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
        { path: 'modules.yaml', text: MODEL },
      ],
    }),
    { source: fetcher, version },
  )
  desk.attachRouter(router)
  await desk.init()
  await flush()
  await nextTick()
  // 入口导出按需取：第一次读表面时发出，取到后派生重算
  desk.facts.surfaceOf('lib')
  await flush()
  return desk
}

const OFF: StructureFilter = { typeOnly: false, invokesOnly: false, uncoveredOnly: false }
const ids = (xs: { id: string }[]) => xs.map(x => x.id)

describe('L21、B1–B4 结构视角画布的束', () => {
  it('缺省：只引类型收起计数；一端是边界节点（适配器）的束折叠进另一端的「入 · 出」角标', async () => {
    const desk = await open()
    const d = desk.facts.structureDisplay(OFF)!
    expect(ids(d.shown)).toEqual(['bundle:a->b', 'bundle:a->lib'])
    expect(d.hidden).toEqual({ type: 1, value: 0, covered: 0, cross: 1 })
    expect(Object.fromEntries(d.cross)).toEqual({ lib: { in: 1, out: 0 } })
    expect(d.reach.get('bundle:edge->lib')).toBe('cross')
    expect(d.reach.get('bundle:a->lib')).toBe('sibling')
    expect(d.focus).toBeNull()
    expect(d.expanded.size).toBe(0)
    expect(d.elementEdges).toEqual([])
  })

  it('B1：打开只引类型后画出；只看交互使用时值使用也收起。B4：只看未解释时收起已解释的', async () => {
    const desk = await open()
    expect(ids(desk.facts.structureDisplay({ ...OFF, typeOnly: true })!.shown)).toContain('bundle:b->lib')
    const inv = desk.facts.structureDisplay({ ...OFF, invokesOnly: true })!
    expect(ids(inv.shown)).toEqual(['bundle:a->lib'])
    expect(inv.hidden.value).toBe(1)
    // B4（T0 裁决 6）：只看未解释——只有 edge → lib（有调用、没有交互覆盖，K7）未解释；它跨界折叠，悬停一端时画出
    const unc = desk.facts.structureDisplay({ ...OFF, uncoveredOnly: true })!
    expect(ids(unc.shown)).toEqual([])
    expect(unc.hidden.covered).toBe(3)
    expect(unc.hidden.cross).toBe(1)
    desk.setHover('edge')
    expect(ids(desk.facts.structureDisplay({ ...OFF, uncoveredOnly: true })!.shown)).toEqual(['bundle:edge->lib'])
  })

  it('B2：悬停或选中边界节点的一端时画出跨界的束', async () => {
    const desk = await open()
    desk.setHover('edge')
    expect(ids(desk.facts.structureDisplay(OFF)!.shown)).toContain('bundle:edge->lib')
    desk.setHover(null)
    desk.select({ kind: 'module', id: 'lib' })
    expect(ids(desk.facts.structureDisplay(OFF)!.shown)).toContain('bundle:edge->lib')
  })

  it('B3：选中束时与两端相连的束为聚焦集合；T2-7：选中束不展开被依赖方（元素在面板看）', async () => {
    const desk = await open()
    desk.select({ kind: 'dep', id: 'a->lib' })
    const d = desk.facts.structureDisplay(OFF)!
    expect(d.focus!.bundle).toBe('bundle:a->lib')
    expect(d.focus!.nodes).toEqual(['a', 'lib'])
    expect([...d.focus!.bundles].sort()).toEqual(['bundle:a->b', 'bundle:a->lib', 'bundle:b->lib', 'bundle:edge->lib'])
    expect(d.expanded.size).toBe(0)
    expect(d.elementEdges).toEqual([])
    expect(desk.facts.expansion.value).toBeNull()
  })

  it('C6：选中模块展开它的全部元素；总是展开表面时本层有元素的模块全部展开（展开集合在 DeskState，两个视角同一份，T2-1 / T2-2）', async () => {
    const desk = await open()
    desk.select({ kind: 'module', id: 'lib' })
    const d = desk.facts.structureDisplay({ ...OFF, typeOnly: true })!
    expect(d.expanded.get('lib')).toBeNull()
    expect(ids(d.elementEdges).sort()).toEqual(['el:a->lib:use:run', 'el:b->lib:use:Item', 'el:edge->lib:use:run'])
    expect(desk.facts.layoutLinks.value!.expand!.map(x => x.node)).toEqual(['lib'])
    desk.select(null)
    expect(desk.facts.expansion.value).toBeNull()
    desk.setSurfaceAlways(true)
    expect([...desk.facts.structureDisplay(OFF)!.expanded.keys()].sort()).toEqual(['lib'])
    // 交互视角同一份展开（V12）；运行视角不展开
    desk.setMode('interaction')
    expect(desk.facts.expansion.value!.expand.map(x => x.node)).toEqual(['lib'])
  })

  it('不在结构视角时为 null', async () => {
    const desk = await open('/')
    expect(desk.facts.structureDisplay(OFF)).toBeNull()
  })
})

describe('K18、K19 表面与 W / B，K5d、S18b 承载，D7 交互束散开', () => {
  it('表面按入口导出与声明接口匹配；W / B 与元素扇入；指标带 W / B', async () => {
    const desk = await open()
    const s = desk.facts.surfaceOf('lib')!
    expect(s.elements.map(e => `${e.name}:${e.kind}:${e.state}`)).toEqual(['run:operation:declared-exported', 'Item:type:exported-only'])
    const m = desk.facts.surfaceMetricsOf('lib')!
    expect(m).toMatchObject({ w: 2, b: 0 })
    expect(m.uses.map(u => `${u.element.name}×${u.modules.length}`)).toEqual(['run×2', 'Item×1'])
    expect(desk.facts.bypassesOf('lib')).toEqual([])
    expect(desk.facts.metrics.value!.get('lib')).toMatchObject({ w: 2, b: 0 })
  })

  it('交互的承载；步骤 → 交互 → 承载段；交互束按接收方表面散开', async () => {
    const desk = await open()
    expect(desk.facts.carrierOf('r1')).toMatchObject({ template: 'direct', verdict: 'complete' })
    expect(desk.facts.stepCarrierOf({ relation: 'r1' }).carrier!.segments[0].edge!.element!.name).toBe('run')
    expect(desk.facts.stepCarrierOf({})).toEqual({ relation: null, carrier: null })
    const edge = desk.view.value!.edges.find(e => e.relationIds.includes('r1'))!
    expect(desk.facts.interactionSpread(edge.id)!.items).toMatchObject([{ relation: 'r1', element: { name: 'run' } }])
    expect(desk.facts.interactionSpread('nope')).toBeNull()
  })

  it('设计版本（K8、C8）：表面只有声明接口，W / B、承载不给', async () => {
    const desk = await open('/?v=s', { design: 'd', revision: 'r1' })
    expect(desk.facts.surfaceOf('lib')!).toMatchObject({ facts: false, elements: [{ name: 'run', state: 'declared' }] })
    expect(desk.facts.surfaceMetricsOf('lib')).toBeNull()
    expect(desk.facts.carrierOf('r1')).toBeNull()
  })
})

describe('B1、B4、C6 显示偏好（按项目记本地，不进 URL）', () => {
  beforeEach(() => {
    localStorage.clear()
    resetStructurePrefs()
  })

  it('三个新开关缺省关；改动按项目记在本地，重开仍在', () => {
    const p = useStructurePrefs('p')
    expect(p.prefs.value).toMatchObject({ invokesOnly: false, uncoveredOnly: false, surfaceAlways: false })
    p.setInvokesOnly(true)
    p.setUncoveredOnly(true)
    p.setSurfaceAlways(true)
    resetStructurePrefs()
    expect(useStructurePrefs('p').prefs.value).toEqual({ ...DEFAULT_STRUCTURE_PREFS, invokesOnly: true, uncoveredOnly: true, surfaceAlways: true })
    expect(useStructurePrefs('q').prefs.value).toEqual(DEFAULT_STRUCTURE_PREFS)
    // 坏值回落到缺省
    localStorage.setItem('h5p-arch-desk:structure-prefs:r', JSON.stringify({ invokesOnly: 'yes' }))
    expect(useStructurePrefs('r').prefs.value.invokesOnly).toBe(false)
  })
})
