/**
 * 画布场景结构视角第八轮单测的共用 fixture（ADR-0032）：两层模型、文件依赖与入口导出，经 DeskState 得到 desk.facts 的束与显示派生，
 * 再按画布组件同样的方式（GraphCanvas）组装 canvasScene 的输入——束、过滤、跨界折叠、聚焦、表面展开、承载叠加都走真实的派生。
 */
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createDeskState, type SourceFetcher } from '../../src/state/useDeskState'
import { layoutView, surfaceExpansion, type PositionedView } from '../../src/layout/layout'
import { canvasScene, type CanvasInput } from '../../src/layout/canvas'
import type { ExportedSymbol, FactsPayload, FileDep, InteractionBundle, SourcePayload } from '../../src/model'

export const MODEL = `
modules:
  - id: ui
    name: UI
    kind: layer
    order: 1
    responsibility: 界面层
    mayDependOn: [core]
    children:
      - { id: ui.view, name: View, responsibility: 视图, codeRefs: [src/ui/view/**] }
      - { id: ui.store, name: Store, responsibility: 状态, codeRefs: [src/ui/store/**] }
  - id: core
    name: Core
    kind: layer
    order: 2
    responsibility: 内核层
    mayDependOn: []
    children:
      - { id: core.api, name: Api, responsibility: 对外接口, codeRefs: [src/core/api/**], entry: src/core/api/index.ts, provides: [if.get] }
      - { id: core.impl, name: Impl, responsibility: 实现, codeRefs: [src/core/impl/**] }
      - { id: core.util, name: Util, responsibility: 工具, codeRefs: [src/core/util/**] }
      - { id: core.log, name: Log, responsibility: 日志, codeRefs: [src/core/log/**] }
interfaces:
  - { id: if.get, name: get, owner: core.api, signature: 'get(id: string): Item' }
relations:
  - { id: rel.q, from: core.util, to: core.api, type: queries, interface: if.get }
  - { id: rel.q2, from: core.util, to: core.api, type: queries, mode: async }
  - { id: rel.i, from: core.impl, to: core.util, type: commands }
  - { id: rel.2, from: ui.store, to: core.api, type: queries }
  - { id: rel.gap, from: core.log, to: core.util, type: commands }
`
export const SRC = [
  'src/ui/view/a.ts',
  'src/ui/store/s.ts',
  'src/core/api/index.ts',
  'src/core/api/client.ts',
  'src/core/impl/i.ts',
  'src/core/util/u.ts',
  'src/core/log/l.ts',
]
const call = (from: string, to: string, via: string, names: string[], line = 1): FileDep => ({
  from,
  to,
  via,
  kind: 'value',
  line,
  names,
  uses: true,
  invokes: true,
})
const API = 'src/core/api/client.ts'
const ENTRY = 'src/core/api/index.ts'
/**
 * core 层：impl → api 组装 Client + 端口实现 get（形态混合）；impl → util 调用 + 子类 Base（形态混合）；util → api 调 get（rel.q 覆盖）；
 * api → log 调用、没有关系（未解释）；util → log 只引类型；impl → log 值使用；ui.store → api 调 get（跨界，边界节点 ui）
 */
export const DEPS: FileDep[] = [
  { ...call('src/core/impl/i.ts', API, ENTRY, ['Client']), invokeKinds: ['new'] },
  {
    from: 'src/core/impl/i.ts',
    to: API,
    via: ENTRY,
    kind: 'type',
    line: 2,
    names: ['get'],
    inherits: [{ name: 'get', clause: 'implements', decl: 'interface' }],
  },
  call('src/core/impl/i.ts', 'src/core/util/u.ts', 'src/core/util/u.ts', ['run'], 3),
  {
    ...call('src/core/impl/i.ts', 'src/core/util/u.ts', 'src/core/util/u.ts', ['Base'], 4),
    invokeKinds: ['extends'],
    inherits: [{ name: 'Base', clause: 'extends', decl: 'class' }],
  },
  call('src/core/util/u.ts', API, ENTRY, ['get']),
  call('src/core/api/client.ts', 'src/core/log/l.ts', 'src/core/log/l.ts', ['log']),
  { from: 'src/core/util/u.ts', to: 'src/core/log/l.ts', via: 'src/core/log/l.ts', kind: 'type', line: 5, names: ['Level'] },
  { from: 'src/core/impl/i.ts', to: 'src/core/log/l.ts', via: 'src/core/log/l.ts', kind: 'value', line: 6, names: ['LEVELS'], uses: true },
  call('src/ui/store/s.ts', API, ENTRY, ['get']),
]
export const EXPORTS: Record<string, ExportedSymbol[]> = {
  [ENTRY]: [
    { name: 'get', kind: 'function', line: 1, from: API },
    { name: 'Client', kind: 'class', line: 2, from: API },
    { name: 'Item', kind: 'type', line: 3, from: API },
  ],
}

const LOCAL: SourcePayload = { status: 'local', root: '/repo', files: SRC, packages: {} }
const flush = () => new Promise(r => setTimeout(r, 2))

export interface Prefs {
  typeOnly: boolean
  invokesOnly: boolean
  uncoveredOnly: boolean
  surfaceAlways: boolean
}
export const OFF: Prefs = { typeOnly: false, invokesOnly: false, uncoveredOnly: false, surfaceAlways: false }

export async function openDesk(url = '/?level=core&v=s', deps: FileDep[] = DEPS, model = MODEL) {
  const facts: FactsPayload = { deps: { deps, external: {}, parsed: SRC.length }, baseline: null, ledger: [] }
  const fetcher: SourceFetcher = { tree: async () => LOCAL, file: async () => null, exports: async p => EXPORTS[p] ?? [], facts: async () => facts }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push(url)
  const desk = createDeskState(
    async () => ({
      dir: 'model/test',
      files: [
        { path: 'system.yaml', text: 'system: { id: sys, name: Sys }' },
        { path: 'modules.yaml', text: model },
      ],
    }),
    { source: fetcher },
  )
  desk.attachRouter(router)
  await desk.init()
  await settle(desk)
  return desk
}

export type Desk = Awaited<ReturnType<typeof createDeskState>>

/** 等代码事实、入口导出与布局都到齐 */
export async function settle(desk: Desk) {
  for (let i = 0; i < 200; i++) {
    await flush()
    await nextTick()
    desk.facts.surfaceOf('core.api')
    const links = desk.facts.layoutLinks.value
    const pv = desk.positioned.value
    if (
      desk.facts.status.value === 'ready' &&
      links &&
      pv &&
      links.edges.every(e => pv.edges.has(e.id) || !pv.nodes.has(e.from) || !pv.nodes.has(e.to) || e.from.startsWith('boundary:'))
    ) {
      if (i > 3) return
    }
  }
}

/** 与 GraphCanvas 同样地组装画布输入：结构视角的束与显示派生、表面展开的布局、交互束散开与承载 */
export async function sceneOf(desk: Desk, prefs: Partial<Prefs> = {}, extra: Partial<CanvasInput> = {}) {
  const p = { ...OFF, ...prefs }
  const f = desk.facts
  const v = desk.view.value!
  const spreads = new Map<string, InteractionBundle>()
  for (const e of v.edges) {
    const b = f.interactionSpread(e.id)
    if (b) spreads.set(e.id, b)
  }
  const links = f.layoutLinks.value
  const x = links ? surfaceExpansion({ view: v, selection: desk.selection.value, always: p.surfaceAlways, links, spreads }) : null
  const positioned: PositionedView | null =
    x && links ? await layoutView(v, {}, { ...links, expand: x.expand, interactions: x.interactions }) : desk.positioned.value
  const structureMode = desk.viewpoint.value === 'structure'
  const interaction = desk.viewpoint.value === 'interaction' && !desk.playing.value
  const sel = desk.selection.value
  const surfaceInfo = new Map(
    (x?.expand ?? []).map(e => {
      const m = v.nodes.find(n => n.id === e.node)!.moduleId
      const fan = new Map((f.surfaceMetricsOf(m)?.uses ?? []).map(u => [u.element.name, u.modules.length]))
      return [m, new Map((f.surfaceOf(m)?.elements ?? []).map(el => [el.name, { kind: el.kind, fanIn: fan.get(el.name) ?? 0 }]))]
    }),
  )
  const input: CanvasInput = {
    positioned,
    index: desk.index.value,
    selection: sel,
    hover: desk.hoverId.value,
    stage: null,
    scenarioView: null,
    emphasis: null,
    participants: new Map(),
    mode: 'hide',
    reveal: [],
    diff: null,
    fileHits: null,
    branchPointId: null,
    facts: null,
    evolution: null,
    ports: f.portMarks.value,
    structure: structureMode
      ? {
          view: f.structure.value,
          display: f.structureDisplay(p),
          typeOnly: p.typeOnly,
          invokesOnly: p.invokesOnly,
          uncoveredOnly: p.uncoveredOnly,
          metrics: f.metrics.value,
          impact: f.queried.value?.impact ?? null,
          impactMode: f.queried.value?.mode ?? 'in',
          cycles: f.level.value?.cycles ?? null,
          report: f.report.value,
        }
      : null,
    spreads: interaction ? spreads : null,
    carrier: interaction && sel?.kind === 'relation' ? f.carrierOf(sel.id) : null,
    surfaceInfo,
    ...extra,
  }
  return { scene: canvasScene(input), positioned, expansion: x }
}
