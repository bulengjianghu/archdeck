/**
 * O12 组装叠加（ADR-0030）：「组装」开关（缺省关、不进 URL、草图画布下无效）、组装事实按 mapEndpoint 投影到本层（levelAssembly）、
 * 组装根按最深模块聚合到本层节点、画布的叠加虚线（依赖方一端实心菱形，ADR-0035）与「组装根」角标（运行视角不画）。
 */
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createDeskState, type SourceFetcher } from '../../src/state/useDeskState'
import { DEFAULT_TOGGLES } from '../../src/state/transition'
import { blocked } from '../../src/state/transition/edit'
import { layoutView } from '../../src/layout/layout'
import { canvasScene, type CanvasInput } from '../../src/layout/canvas'
import { strokeStyle, DASHED } from '../../src/components/edges/edgeStyle'
import { levelAssembly, loadModel, projectLevel, RELATION_TYPES, type AssemblyFact, type FactsPayload, type FileDep, type SourcePayload } from '../../src/model'
import { sampleFiles, scenarioFiles } from '../fixtures/sample'

const flush = () => new Promise(r => setTimeout(r, 0))
const REFS = `
modules:
  - { id: domain.models.core, parent: domain.models, name: Core, responsibility: x, codeRefs: [src/domain/**] }
  - { id: infra.framework.extra, parent: infra.framework, name: Extra, responsibility: x, codeRefs: [src/framework/**] }
`
const LOCAL: SourcePayload = { status: 'local', root: '/repo', files: ['src/domain/m.ts', 'src/framework/extra.ts'], packages: {} }
const dep = (from: string, to: string, extra: Partial<FileDep> = {}): FileDep => ({ from, to, via: to, kind: 'value', line: 1, ...extra })
// K13：domain.models.core new 了 infra.framework.extra 的类
const facts: FactsPayload = {
  deps: { deps: [dep('src/domain/m.ts', 'src/framework/extra.ts', { invokes: true, invokeKinds: ['new'] })], external: {}, parsed: 2 },
  baseline: null,
  ledger: [],
}
const fetcher: SourceFetcher = { tree: async () => LOCAL, file: async () => null, exports: async () => [], facts: async () => facts }

async function setup(url = '/') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => ({ dir: 'model/test', files: [...scenarioFiles(), { path: 'modules/zz-refs.yaml', text: REFS }] }), {
    source: fetcher,
  })
  desk.attachRouter(router)
  await desk.init()
  await flush()
  await nextTick()
  return { desk, router }
}

const fact = (from: string, to: string): AssemblyFact => ({ key: `${from}->${to}`, from, to, kinds: ['new'], files: [] })

describe('O12 组装事实投影到本层（levelAssembly）', () => {
  const { index } = loadModel(sampleFiles())

  it('分层总览：组装事实落到带，同一对节点合并为一条（×N）；同一节点内的不画；组装根按最深模块聚合到本层可见的最深节点（核心模块，否则带）', () => {
    const view = projectLevel(index, 'sys')
    const a = levelAssembly(index, view, {
      assembly: [
        fact('app.solution', 'domain.services'),
        fact('app.fragments', 'domain.models'),
        fact('infra.framework.sm', 'infra.mus'),
        fact('infra.player', 'app.fragments'),
      ],
      assemblyRoots: ['infra.framework.sm', 'infra.player', 'app.fragments'],
    })
    expect(a.overlays.map(o => [o.id, o.count])).toEqual([
      ['asm:app->domain', 2],
      ['asm:infra->app', 1],
    ])
    expect(a.overlays[0]).toMatchObject({ from: 'app', to: 'domain', fromModule: 'app', toModule: 'domain' })
    // infra.framework 与 infra.player 是核心模块（带内常显）：根落在它们上面；app.fragments 不是核心，落在带上
    expect(Object.fromEntries(a.roots)).toEqual({ 'infra.framework': 1, 'infra.player': 1, app: 1 })
  })

  it('普通层次：落到子模块；外部的一端在显示边界节点时落到边界节点', () => {
    const view = projectLevel(index, 'infra.framework')
    const a = levelAssembly(index, view, {
      assembly: [fact('infra.framework.sm', 'infra.framework.pipeline'), fact('infra.framework.sm', 'app.solution')],
      assemblyRoots: [],
    })
    expect(a.overlays.map(o => o.id)).toEqual(['asm:infra.framework.sm->infra.framework.pipeline', 'asm:infra.framework.sm->boundary:app'])
    expect(a.roots.size).toBe(0)
  })
})

describe('O12 「组装」开关与画布', () => {
  it('缺省关闭；关闭时没有投影，打开后有；开关不进 URL；草图画布下打开无效', async () => {
    expect(DEFAULT_TOGGLES(RELATION_TYPES).assembly).toBe(false)
    const { desk, router } = await setup('/')
    expect(desk.facts.assembly.value).toBeNull()
    desk.setToggles({ assembly: true })
    await flush()
    const a = desk.facts.assembly.value!
    expect(a.overlays.map(o => o.id)).toEqual(['asm:domain->infra'])
    expect(Object.fromEntries(a.roots)).toEqual({ domain: 1 })
    expect(Object.values(router.currentRoute.value.query).join(' ')).not.toContain('assembly')
    expect(blocked({ ...desk.state.value, editing: { design: 'd', mount: 'root' } } as never, { type: 'toggle', patch: { assembly: true } })).toBe(true)
    // 运行视角不叠加
    desk.openScenario('sc.play')
    await flush()
    expect(desk.facts.assembly.value).toBeNull()
  })

  it('画布：叠加虚线（组装专用色，标 ×N）与「组装根」角标；运行视角不画', async () => {
    const { desk } = await setup('/')
    desk.setToggles({ assembly: true })
    await flush()
    const a = desk.facts.assembly.value!
    const input: CanvasInput = {
      positioned: await layoutView(desk.view.value!),
      index: desk.index.value,
      selection: null,
      hover: null,
      stage: null,
      scenarioView: null,
      emphasis: null,
      participants: new Map(),
      mode: 'hide',
      reveal: [],
      diff: null,
      fileHits: null,
      branchPointId: null,
      assembly: [...a.overlays, { ...a.overlays[0], id: 'asm:app->infra', from: 'app', to: 'infra', fromModule: 'app', toModule: 'infra', count: 3 }],
      assemblyRoots: a.roots,
    }
    const scene = canvasScene(input)
    const e = scene.edges.find(x => x.id === 'asm:domain->infra')!
    expect(e.data).toMatchObject({ temp: 'assembly', label: '', assembly: { fromModule: 'domain', toModule: 'infra' } })
    expect(scene.edges.find(x => x.id === 'asm:app->infra')!.data).toMatchObject({ label: '×3', pill: true })
    // O12、L18（ADR-0035）：组装是依赖——虚线（菱形端点见 RouteEdge）
    expect(strokeStyle({ temp: 'assembly' })).toMatchObject({ stroke: 'var(--assembly)', strokeDasharray: DASHED })
    expect(scene.nodes.find(n => n.id === 'domain')!.data.assemblyRoot).toBe(1)
    expect(scene.nodes.find(n => n.id === 'app')!.data.assemblyRoot).toBeUndefined()
    // 选中代码依赖时，组装叠加线随之选中（K10）
    expect(canvasScene({ ...input, selection: { kind: 'dep', id: 'domain->infra' } }).edges.find(x => x.id === 'asm:domain->infra')!.data.selected).toBe(true)
  })
})
