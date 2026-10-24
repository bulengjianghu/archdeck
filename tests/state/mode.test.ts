/** 画布模式（ADR-0031）：三视角 V11、切换不变式与选中映射 V12、URL `v=s`；纯函数与 DeskState */
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { loadModel, projectLevel, RELATION_TYPES } from '../../src/model'
import { DEFAULT_TOGGLES, encodeView, perspectiveOf, transition, type TransitionContext, type ViewAction, type ViewState } from '../../src/state/transition'
import { createDeskState, type SourceFetcher } from '../../src/state/useDeskState'
import type { FileDep, SourcePayload } from '../../src/model'
import { sampleFiles, scenarioFiles } from '../fixtures/sample'

const { index } = loadModel(sampleFiles())
const base: ViewState = { levelId: 'infra', selection: null, hover: null, toggles: DEFAULT_TOGGLES(RELATION_TYPES), playback: null }
const view = projectLevel(index, 'infra')
/** infra 层：Framework → Player 之间有依赖（结构边），Framework → MUs 之间没有 */
const pairs = new Set(['infra.framework->infra.player'])
const ctx: TransitionContext = { index, levelView: view, structurePair: (a, b) => pairs.has(`${a}->${b}`) }
const run = (s: ViewState, a: ViewAction, c: TransitionContext = ctx) => transition(s, a, c)
const toStructure: ViewAction = { type: 'setMode', mode: 'structure' }
const toInteraction: ViewAction = { type: 'setMode', mode: 'interaction' }

describe('V11 三视角', () => {
  it('缺省为交互视角；单击切到结构视角进历史，再切回去；同一模式无动作', () => {
    expect(perspectiveOf(base)).toBe('interaction')
    const r = run(base, toStructure)
    expect(r.history).toBe('push')
    expect(r.state.mode).toBe('structure')
    expect(perspectiveOf(r.state)).toBe('structure')
    expect(run(r.state, toStructure).state).toBe(r.state)
    const back = run(r.state, toInteraction)
    expect(perspectiveOf(back.state)).toBe('interaction')
    // 交互视角不存字段：与缺省状态相同
    expect('mode' in back.state).toBe(false)
  })

  it('打开场景进入运行视角，退出回到进入前的模式', () => {
    const { index: idx } = loadModel(scenarioFiles())
    const c: TransitionContext = { index: idx }
    const s = transition({ ...base, levelId: 'sys' }, toStructure, c).state
    const opened = transition(s, { type: 'openScenario', id: 'sc.play' }, c).state
    expect(perspectiveOf(opened)).toBe('run')
    const closed = transition(opened, { type: 'closeScenario' }, c).state
    expect(perspectiveOf(closed)).toBe('structure')
    // 运行视角下单击「交互」即退出场景并回到交互视角
    const switched = transition(opened, toInteraction, c)
    expect([switched.state.playback, perspectiveOf(switched.state), switched.history]).toEqual([null, 'interaction', 'push'])
    // 运行视角下单击进入前的模式：只退出场景
    expect(perspectiveOf(transition(opened, toStructure, c).state)).toBe('structure')
  })

  it('URL：结构视角写 v=s，交互视角不写；按 v 恢复；运行视角下照写进入前的模式', () => {
    const s = run(base, toStructure).state
    expect(encodeView(s, index).v).toBe('s')
    expect(encodeView(base, index).v).toBeUndefined()
    expect(run(base, { type: 'restore', query: { level: 'infra', v: 's' } }).state.mode).toBe('structure')
    expect('mode' in run(s, { type: 'restore', query: { level: 'infra' } }).state).toBe(false)
    expect(encodeView({ ...s, playback: { scenarioId: 'x', frameId: null, choices: new Map() } }, index)).toMatchObject({ v: 's', sc: 'x' })
  })

  it('草图画布（X7a）下切换无效，画的是交互图', () => {
    const editing: ViewState = { ...base, editing: { kind: 'persistent', file: 'intent/skeleton.yaml' } as never }
    expect(run(editing, toStructure).state).toBe(editing)
    expect(perspectiveOf({ ...editing, mode: 'structure' })).toBe('interaction')
  })
})

describe('V12 切换不变式与选中映射', () => {
  it('层次、显示开关、悬停不变；模块、参与者、文件选中照原样', () => {
    const s: ViewState = { ...base, hover: 'infra.mus', toggles: { ...base.toggles, assembly: true, currentOnly: true } }
    for (const selection of [
      { kind: 'module', id: 'infra.mus' },
      { kind: 'actor', id: 'user' },
      { kind: 'file', id: 'src/a.ts' },
    ] as const) {
      const r = run({ ...s, selection }, toStructure)
      expect(r.state).toMatchObject({ levelId: 'infra', hover: 'infra.mus', toggles: s.toggles, selection })
      expect(run(r.state, toInteraction).state.selection).toEqual(selection)
    }
  })

  it('关系与视图边切到结构视角换成同一对节点同方向的依赖边；没有结构边时清空并给出被清空的选中', () => {
    // r3：Player → Solution（外部）；Framework 内的 r6 投影为 Framework → Framework（同一节点）
    const edge = view.edges.find(e => e.from === 'infra.framework' && e.to === 'infra.mus')!
    const dropped = run({ ...base, selection: { kind: 'edge', id: edge.id } }, toStructure)
    expect(dropped.state.selection).toBeNull()
    expect(dropped.dropped).toEqual({ kind: 'edge', id: edge.id })
    const withDep: TransitionContext = { ...ctx, structurePair: (a, b) => a === 'infra.framework' && b === 'infra.mus' }
    expect(run({ ...base, selection: { kind: 'edge', id: edge.id } }, toStructure, withDep).state.selection).toEqual({
      kind: 'dep',
      id: 'infra.framework->infra.mus',
    })
    // 关系按两端投影到本层：r4 Pipeline → MUs 落在 Framework → MUs
    const r = run({ ...base, selection: { kind: 'relation', id: 'r4' } }, toStructure, withDep)
    expect(r.state.selection).toEqual({ kind: 'dep', id: 'infra.framework->infra.mus' })
    expect(r.dropped).toBeUndefined()
    // 没有代码事实（不给 structurePair）：清空
    expect(run({ ...base, selection: { kind: 'relation', id: 'r4' } }, toStructure, { index, levelView: view }).state.selection).toBeNull()
  })

  it('端口切到结构视角换成其定义模块', () => {
    expect(run({ ...base, selection: { kind: 'port', id: 'if.sm' } }, toStructure).state.selection).toEqual({ kind: 'module', id: 'infra.framework.sm' })
  })

  it('依赖边切到交互视角：同一对节点有交互边时换成它，没有时仍是 K10 的选中', () => {
    const s = run(base, toStructure).state
    const edge = view.edges.find(e => e.from === 'infra.framework' && e.to === 'infra.mus')!
    expect(run({ ...s, selection: { kind: 'dep', id: 'infra.framework->infra.mus' } }, toInteraction).state.selection).toEqual({ kind: 'edge', id: edge.id })
    const kept = run({ ...s, selection: { kind: 'dep', id: 'infra.mus->infra.player' } }, toInteraction)
    expect(kept.state.selection).toEqual({ kind: 'dep', id: 'infra.mus->infra.player' })
    expect(kept.dropped).toBeUndefined()
  })
})

// ── DeskState：模式、结构视图派生与选中映射接到代码事实 ──

const REFS = `
modules:
  - { id: app.solution.core, parent: app.solution, name: Core, responsibility: x, codeRefs: [src/app/**] }
  - { id: domain.models.core, parent: domain.models, name: Core, responsibility: x, codeRefs: [src/domain/**] }
  - { id: infra.framework.extra, parent: infra.framework, name: Extra, responsibility: x, codeRefs: [src/framework/**] }
`
const LOCAL: SourcePayload = { status: 'local', root: '/repo', files: ['src/app/s.ts', 'src/domain/m.ts', 'src/framework/extra.ts'], packages: {} }
const dep = (from: string, to: string): FileDep => ({ from, to, via: to, kind: 'value', line: 1, uses: true, invokes: true })
const DEPS = [dep('src/framework/extra.ts', 'src/app/s.ts'), dep('src/app/s.ts', 'src/domain/m.ts')]
const fetcher: SourceFetcher = {
  tree: async () => LOCAL,
  file: async () => null,
  exports: async () => [],
  facts: async () => ({ deps: { deps: DEPS, external: {}, parsed: 3 }, baseline: null, ledger: [] }),
}
const flush = () => new Promise(r => setTimeout(r, 0))

async function open(url: string, version?: { design: string; revision: string }) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(async () => ({ dir: 'model/test', files: [...scenarioFiles(), { path: 'modules/zz-refs.yaml', text: REFS }] }), {
    source: fetcher,
    version,
  })
  desk.attachRouter(router)
  await desk.init()
  await flush()
  await nextTick()
  return { desk, router }
}

describe('DeskState 的画布模式', () => {
  it('v=s 直达结构视角；结构视图派生只在结构视角有；切换写进 URL', async () => {
    const { desk, router } = await open('/?v=s')
    expect(desk.mode.value).toBe('structure')
    expect(desk.perspective.value).toBe('structure')
    const sv = desk.facts.structure.value!
    expect(sv.facts).toBe(true)
    if (sv.facts) expect(sv.edges.map(e => e.id)).toContain('dependency:infra->app')
    desk.setMode('interaction')
    await flush()
    expect(desk.facts.structure.value).toBeNull()
    expect(router.currentRoute.value.query.v).toBeUndefined()
    desk.setMode('structure')
    await flush()
    expect(router.currentRoute.value.query.v).toBe('s')
  })

  it('选中映射用本层的结构边：根层 r3（Player → Solution）落到「基础设施 → 应用」的依赖边；r7（MUs → Models）两带之间没有依赖，清空并记下；指标与影响面可查', async () => {
    const { desk } = await open('/')
    desk.select({ kind: 'relation', id: 'r3' })
    desk.setMode('structure')
    expect(desk.selection.value).toEqual({ kind: 'dep', id: 'infra->app' })
    desk.setMode('interaction')
    desk.select({ kind: 'relation', id: 'r7' })
    desk.setMode('structure')
    expect(desk.selection.value).toBeNull()
    expect(desk.droppedSelection.value).toEqual({ kind: 'relation', id: 'r7' })
    desk.select({ kind: 'module', id: 'app' })
    expect(desk.droppedSelection.value).toBeNull()
    expect(desk.facts.metricsOf('app.solution.core')).toMatchObject({ ca: 1, ce: 1, instability: 0.5 })
    const imp = desk.facts.impactOf('app.solution.core')!
    expect(imp.impact.incoming.map(e => e.module)).toEqual(['infra.framework.extra'])
    expect(Object.fromEntries(imp.level!)).toMatchObject({ infra: { direction: 'in', distance: 1 }, domain: { direction: 'out', distance: 1 } })
  })

  it('U16：设计版本没有代码事实，结构视角只有允许依赖图；指标与影响面不适用', async () => {
    const { desk } = await open('/?v=s', { design: 'd', revision: 'r1' })
    const sv = desk.facts.structure.value!
    expect(sv.facts).toBe(false)
    if (!sv.facts) expect(sv.edges.map(e => e.id).sort()).toEqual(['allowed:app->domain', 'allowed:infra->app', 'allowed:infra->domain'])
    expect(desk.facts.metricsOf('app.solution')).toBeNull()
    expect(desk.facts.impactOf('app.solution')).toBeNull()
  })
})
