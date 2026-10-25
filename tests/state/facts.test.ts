/**
 * 视图状态层的架构治理（K8–K10、U9、Y4、Y5）：事实同步、desk.facts 派生、代码依赖叠加线的选中，以及画布场景的叠加。
 */
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createDeskState, decodeSelection, encodeSelection, type SourceFetcher } from '../../src/state/useDeskState'
import { createSourceSync } from '../../src/state/sync/source'
import { layoutView } from '../../src/layout/layout'
import { canvasScene } from '../../src/layout/canvas'
import type { Baseline, FactsPayload, FileDep, SourcePayload } from '../../src/model'
import { scenarioFiles } from '../fixtures/sample'

const flush = () => new Promise(r => setTimeout(r, 0))

const REFS = `
modules:
  - { id: app.solution.core, parent: app.solution, name: Core, responsibility: x, codeRefs: [src/app/**] }
  - { id: domain.models.core, parent: domain.models, name: Core, responsibility: x, codeRefs: [src/domain/**] }
  - { id: infra.framework.extra, parent: infra.framework, name: Extra, responsibility: x, codeRefs: [src/framework/**] }
`
const LOCAL: SourcePayload = { status: 'local', root: '/repo', files: ['src/app/s.ts', 'src/domain/m.ts', 'src/framework/extra.ts'], packages: {} }
const dep = (from: string, to: string): FileDep => ({ from, to, via: to, kind: 'value', line: 1 })
const DEPS = [dep('src/app/s.ts', 'src/framework/extra.ts'), dep('src/framework/extra.ts', 'src/app/s.ts'), dep('src/domain/m.ts', 'src/framework/extra.ts')]
const facts = (baseline: Baseline | null = null): FactsPayload => ({ deps: { deps: DEPS, external: {}, parsed: 3 }, baseline, ledger: [] })
const fetcher = (f: FactsPayload | null = facts(), withFacts = true): SourceFetcher => ({
  tree: async () => LOCAL,
  file: async () => null,
  exports: async () => [],
  ...(withFacts ? { facts: async () => f } : {}),
})

async function setup(url = '/', source: SourceFetcher = fetcher(), version?: { design: string; revision: string }) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => ({ dir: 'model/test', files: [...scenarioFiles(), { path: 'modules/zz-refs.yaml', text: REFS }] }), {
    source,
    version,
  })
  desk.attachRouter(router)
  await desk.init()
  await flush()
  await nextTick()
  return { desk, router }
}

describe('K8 事实同步', () => {
  it('清单取到后随后取事实；清单读取失败为 error 并带原因（G1）；设计版本为 design', async () => {
    expect((await setup()).desk.facts.status.value).toBe('ready')
    const broken = await setup('/', { ...fetcher(), tree: async () => ({ status: 'error', reason: '源码根目录不存在：/x' }) })
    expect(broken.desk.facts.status.value).toBe('error')
    expect(broken.desk.facts.error.value).toBe('源码根目录不存在：/x')
    const design = await setup('/', fetcher(), { design: 'd', revision: 'r1' })
    expect(design.desk.facts.status.value).toBe('design')
    expect(design.desk.facts.report.value).toBeNull()
  })

  it('取事实失败为 error，带原因', async () => {
    const sync = createSourceSync({ ...fetcher(), facts: async () => Promise.reject(new Error('boom')) })
    await sync.refresh()
    expect(sync.facts.value).toEqual({ status: 'error', message: 'boom' })
  })
})

describe('U9 门禁错误进问题提示', () => {
  it('没有基线时不进；有基线时新增违规进 allIssues', async () => {
    const plain = await setup()
    expect(plain.desk.facts.report.value!.violations.map(v => v.key)).toEqual(['layer:app:app.solution.core->infra.framework.extra'])
    expect(plain.desk.allIssues.value.some(i => i.code.startsWith('rule.'))).toBe(false)
    const gated = await setup('/', fetcher(facts({ createdAt: 't', violations: [], cyclicity: { modules: 4, files: 4 } })))
    expect(gated.desk.allIssues.value.filter(i => i.code === 'rule.new')).toHaveLength(1)
  })
})

describe('K9、Y4 本层投影只在结构视角、开关开启时', () => {
  it('GV-6：开关缺省开启，有本层的环；关闭为 null；运行视角下为 null', async () => {
    const { desk } = await setup()
    expect(desk.toggles.showFacts).toBe(true)
    expect([...desk.facts.level.value!.cycles.keys()].sort()).toEqual(['app', 'infra'])
    desk.setToggles({ showFacts: false })
    expect(desk.facts.level.value).toBeNull()
    desk.setToggles({ showFacts: true })
    desk.openScenario('sc.play')
    expect(desk.facts.level.value).toBeNull()
  })

  it('画布场景：本层环的节点带编号，违规的叠加线标红并可按模块对选中', async () => {
    const { desk } = await setup()
    desk.setToggles({ showFacts: true })
    const level = desk.facts.level.value!
    const positioned = await layoutView(desk.view.value!)
    const base = {
      positioned,
      index: desk.index.value,
      selection: { kind: 'dep', id: 'app->infra' },
      hover: null,
      stage: null,
      scenarioView: null,
      emphasis: null,
      participants: new Map(),
      mode: 'hide' as const,
      reveal: [],
      diff: null,
      fileHits: null,
      branchPointId: null,
    }
    const s = canvasScene({ ...base, facts: level })
    expect(s.nodes.find(n => n.id === 'app')!.data.cycle).toBe(1)
    const overlay = s.edges.find(e => e.data.temp === 'code' && e.source === 'app' && e.target === 'infra')!
    expect(overlay.data.violated).toBe(true)
    expect(overlay.data.selected).toBe(true)
    expect(overlay.data.label).toContain('违规 1')
    // 开关关闭（facts 为 null）时没有叠加
    expect(canvasScene({ ...base, facts: null }).edges.some(e => e.data.temp === 'code')).toBe(false)
  })
})

describe('Y5 选中节点所在的本层环', () => {
  it('选中带环编号的模块给出环的节点与本层依赖；不在环中、开关关闭、运行视角为 null', async () => {
    const { desk } = await setup('/?sel=m:app')
    desk.setToggles({ showFacts: false })
    expect(desk.facts.selectedCycle.value).toBeNull()
    desk.setToggles({ showFacts: true })
    const c = desk.facts.selectedCycle.value!
    expect(c.id).toBe(desk.facts.level.value!.cycles.get('app'))
    expect(c.nodes.map(n => n.id).sort()).toEqual(['app', 'infra'])
    expect(c.edges.map(e => `${e.fromModule}->${e.toModule}`).sort()).toEqual(['app->infra', 'infra->app'])
    expect(c.edges.find(e => e.from === 'infra')!.deps.map(d => d.key)).toEqual(['infra.framework.extra->app.solution.core'])
    desk.select({ kind: 'module', id: 'domain' })
    expect(desk.facts.selectedCycle.value).toBeNull()
    desk.select({ kind: 'module', id: 'app' })
    desk.openScenario('sc.play')
    expect(desk.facts.selectedCycle.value).toBeNull()
  })
})

describe('K10 代码依赖叠加线的选中', () => {
  it('sel=d:<依赖方>-><被依赖方> 往返编码；从 URL 恢复并给出模块依赖与违规', async () => {
    expect(encodeSelection({ kind: 'dep', id: 'app->infra' })).toBe('d:app->infra')
    expect(decodeSelection('d:app->infra')).toEqual({ kind: 'dep', id: 'app->infra' })
    const { desk } = await setup('/?sel=d:app->infra')
    const sel = desk.facts.selectedDep.value!
    expect(sel.detail!.deps.map(d => d.key)).toEqual(['app.solution.core->infra.framework.extra'])
    expect(sel.detail!.violations).toHaveLength(1)
  })

  it('两端不存在的选中被丢弃', async () => {
    const { desk } = await setup('/?sel=d:app->ghost')
    expect(desk.selection.value).toBeNull()
  })
})

describe('S16、S17 步骤的代码证据（desk.evidence）', () => {
  it('打开场景按计划逐帧求证据与汇总；选中步骤即进度所在的一帧；时序图消息带等级；设计版本没有', async () => {
    const { desk } = await setup('/?sc=sc.play')
    const plan = desk.run.plan.value!
    const sc = desk.evidence.scenario.value!
    expect(sc.frames.size).toBe(plan.frames.size)
    expect(Object.values(sc.counts).reduce((a, b) => a + b, 0)).toBe(plan.frames.size)
    expect(desk.evidence.step.value).toBeNull()
    desk.next()
    const id = desk.state.value.playback!.frameId!
    expect(desk.evidence.step.value).toBe(sc.frames.get(id))
    const ps = desk.run.positionedSequence.value!
    expect(ps.messages.some(m => m.evidence)).toBe(true)
    // S18b：场景列表的无证据帧数与场景面板的计数同一口径（按承载对齐，desk.evidence.counts）
    const counts = desk.evidence.counts.value!
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(plan.frames.size)
    expect(desk.evidence.unevidenced.value.get('sc.play') ?? 0).toBe(counts.none)
    expect([...desk.evidence.levels.value!.values()].filter(l => l === 'none').length).toBe(counts.none)
    const design = await setup('/?sc=sc.play', fetcher(), { design: 'd', revision: 'r1' })
    expect(design.desk.evidence.scenario.value).toBeNull()
    expect(design.desk.evidence.unevidenced.value.size).toBe(0)
  })
})
