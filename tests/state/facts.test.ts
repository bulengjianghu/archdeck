/**
 * 视图状态层的架构治理（K8–K10、U9、Y4）：事实同步、desk.facts 派生、代码依赖叠加线的选中，以及画布场景的叠加。
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
  it('清单在本地时随后取事实；取不到为 no-source；设计版本为 design', async () => {
    expect((await setup()).desk.facts.status.value).toBe('ready')
    expect((await setup('/', fetcher(null, false))).desk.facts.status.value).toBe('no-source')
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
  it('开关关闭为 null；开启后有本层的环；运行视角下为 null', async () => {
    const { desk } = await setup()
    expect(desk.facts.level.value).toBeNull()
    desk.setToggles({ showFacts: true })
    expect([...desk.facts.level.value!.cycles.keys()].sort()).toEqual(['app', 'infra'])
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
