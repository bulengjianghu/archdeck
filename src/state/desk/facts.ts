/**
 * DeskState 的架构治理派生（desk.facts，ADR-0015）：代码事实由源码同步取得，治理报告、本层投影与门禁问题调用模型层（K、U、Y）。
 * 只对当前版本（K8）；画布叠加只在交互视角、「代码事实」开启时（K9）。
 * 结构视图（ADR-0031）：本层结构边、指标与影响面；没有代码事实时只有允许依赖图（U16）。
 */
import { computed, type ComputedRef, type ShallowRef } from 'vue'
import {
  hasStructureEdge,
  impactOf,
  levelImpact,
  moduleMetrics,
  structureMetrics,
  structureView,
  depsBetween,
  describeModule,
  entryResolver,
  gateIssues as gateOf,
  governanceReport,
  levelAssembly,
  levelFacts,
  portEntry,
  portIssues,
  portPanel,
  summarizeLedger,
  unclassifiedRelations,
  type AssemblyFact,
  type PortPanel,
  type SubclassFact,
  type Confirmation,
  type GovernanceReport,
  type Issue,
  type LedgerSummary,
  type LevelAssembly,
  type LevelCycle,
  type LevelFacts,
  type LevelView,
  type ModelIndex,
  type ModuleDep,
  type ModuleDetail,
  type ModuleMetrics,
  type ModuleMetricsDetail,
  type Impact,
  type StructureView,
  flattenSketch,
  parseDesignSketches,
  sketchLifetime,
  type RawFile,
} from '@/model'
import type { ViewState } from '../transition'
import type { createSourceSync } from '../sync/source'
import type { FileDerivations } from './files'

export interface FactsInputs {
  state: ShallowRef<ViewState>
  index: ShallowRef<ModelIndex | null>
  view: ComputedRef<LevelView | null>
  files: FileDerivations
  sync: ReturnType<typeof createSourceSync>
  /** 设计版本没有代码事实（K8） */
  design: boolean
  /** X4：载荷附带的设计草图（U16：活动草图里层的 mayDependOn 一并画进允许依赖图） */
  sketches?: ShallowRef<{ design: string; file: RawFile }[]>
}

/** 为什么没有代码事实，或正在取；源码清单读取失败也是 error（源码在本地是前提，G1） */
export type FactsStatus = 'ready' | 'loading' | 'design' | 'error'

export function createFacts({ state, index, view, files, sync, design, sketches }: FactsInputs) {
  const resource = sync.facts
  const status = computed<FactsStatus>(() => {
    if (design) return 'design'
    const r = resource.value
    if (!r) return files.payload.value === null ? 'loading' : 'error'
    return r.status === 'ok' ? 'ready' : r.status === 'loading' ? 'loading' : 'error'
  })
  const error = computed(() => {
    const p = files.payload.value
    if (p?.status === 'error') return p.reason
    return resource.value?.status === 'error' ? resource.value.message : null
  })

  const report = computed<GovernanceReport | null>(() => {
    const r = resource.value
    const p = files.payload.value
    if (design || r?.status !== 'ok' || !index.value || !files.ownership.value || p?.status !== 'local') return null
    return governanceReport(index.value, files.ownership.value, p, r.value.deps, r.value.baseline)
  })

  /** K9、Y4：交互视角、开关开启时的本层投影；结构视角常有（本层的环常显，T0 裁决 3） */
  const level = computed<LevelFacts | null>(() =>
    report.value && index.value && view.value && !state.value.playback && (state.value.toggles.showFacts || state.value.mode === 'structure')
      ? levelFacts(index.value, view.value, report.value)
      : null,
  )

  /** O12：交互视角、「组装」开关开启时组装事实与组装根在本层的投影（不参与布局） */
  const assembly = computed<LevelAssembly | null>(() =>
    report.value && index.value && view.value && !state.value.playback && state.value.toggles.assembly
      ? levelAssembly(index.value, view.value, report.value)
      : null,
  )

  /** U9：进问题提示的只有门禁错误 */
  const gateIssues = computed<Issue[]>(() => (report.value ? gateOf(report.value) : []))

  /** Q4：拦截记录摘要 */
  const ledger = computed<LedgerSummary | null>(() => (resource.value?.status === 'ok' ? summarizeLedger(resource.value.value.ledger) : null))

  /** U4、Q1：入口文件（访问面用） */
  const entryOf = computed(() =>
    index.value && files.ownership.value && files.payload.value?.status === 'local'
      ? entryResolver(index.value, files.ownership.value, files.payload.value)
      : null,
  )

  /** K10：选中的代码依赖叠加线 */
  const selectedDep = computed(() => {
    const s = state.value.selection
    if (s?.kind !== 'dep' || !report.value || !index.value || !view.value) return null
    const [from, to] = s.id.split('->')
    return { from, to, detail: depsBetween(index.value, view.value, report.value, from, to) }
  })

  /** Y5：选中的节点（模块或边界节点）所在的本层环；本层投影不可用时为 null（同 K9） */
  const selectedCycle = computed<LevelCycle | null>(() => {
    const s = state.value.selection
    const lv = level.value
    if (s?.kind !== 'module' || !lv || !view.value) return null
    const node = view.value.nodes.some(n => n.id === s.id) ? s.id : `boundary:${s.id}`
    const id = lv.cycles.get(node)
    return id === undefined ? null : (lv.levelCycles.find(c => c.id === id) ?? null)
  })

  /** Q1：模块的治理信息（生效的规则、出入的违规与未解释的交互、所在的环） */
  const moduleDetail = (id: string): ModuleDetail | null =>
    report.value && index.value && files.ownership.value && entryOf.value
      ? describeModule(index.value, files.ownership.value, report.value, entryOf.value, id)
      : null

  /** K5：关系的证实与依据的模块依赖 */
  const relationFact = (id: string): (Omit<Confirmation, 'deps'> & { deps: ModuleDep[] }) | null => {
    const c = report.value?.relations.get(id)
    return c ? { ...c, deps: c.deps.map(k => report.value!.moduleDeps.get(k)!).filter(Boolean) } : null
  }

  // ── 端口（ADR-0029）：端口面板（K11）与画布的端口记号（L13）；有代码事实时实现者带证据档、并上「仅代码事实」的实现者，否则只按描述（设计版本） ──

  /** K11：一个端口（接口）的端口面板；不是接口为 null */
  const portOf = (id: string): PortPanel | null => (index.value ? portEntry(index.value, report.value, id) : null)
  /** K11：模块的端口一节——它声明的接口中算端口的（裁决 4） */
  const portsOf = (id: string): PortPanel[] => (index.value ? portPanel(index.value, report.value, id).filter(p => p.isPort) : [])

  /**
   * L13：本层要画端口记号的节点（模块 ID → 端口），结构视角才有（运行视角不画）：普通层次的子模块与边界节点，分层总览只画核心模块。
   * 一个节点的端口为它声明的、算端口的接口（portsOf）。
   */
  const portMarks = computed<Map<string, PortPanel[]> | null>(() => {
    const v = view.value
    if (!index.value || !v || state.value.playback) return null
    const out = new Map<string, PortPanel[]>()
    for (const n of v.nodes) {
      const drawn = v.mode === 'layered' ? n.role === 'core' : n.role === 'module' || n.role === 'core' || n.role === 'boundary'
      if (!drawn || out.has(n.moduleId)) continue
      const ports = portsOf(n.moduleId)
      if (ports.length) out.set(n.moduleId, ports)
    }
    return out
  })

  /** M17：未分类关系的条数与其中核心之间的（描述查询，设计版本也有） */
  const unclassified = computed(() => {
    if (!index.value) return { all: 0, core: 0 }
    const u = unclassifiedRelations(index.value)
    return { all: u.all.length, core: u.core.length }
  })

  /** U14：当前版本的端口孤立（治理面板；设计版本只在 lint:model 按描述报，T1 裁决 8） */
  const portProblems = computed<Issue[]>(() => (report.value && index.value ? portIssues(index.value, report.value) : []))

  /** K12、K13：模块的子类 / 基类、组装 / 被组装（模块自身或子树内的事实）；组装根标出 */
  const structureOf = (id: string) => {
    const r = report.value
    const inside = (m: string) => !!index.value?.pathOf.get(m)?.includes(id)
    const pick = <T extends SubclassFact | AssemblyFact>(list: readonly T[]) => ({
      out: list.filter(f => inside(f.from) && !inside(f.to)),
      in: list.filter(f => inside(f.to) && !inside(f.from)),
    })
    if (!r) return null
    const sub = pick(r.subclasses)
    const asm = pick(r.assembly)
    return { bases: sub.out, subclasses: sub.in, assembles: asm.out, assembledBy: asm.in, root: r.assemblyRoots.includes(id) }
  }

  /** K12、K13：两端之间（自身或子树，任一方向）的子类与组装事实——关系与代码依赖面板「知识」行旁 */
  const structureBetween = (a: string, b: string): { subclass: SubclassFact[]; assembly: AssemblyFact[] } => {
    const r = report.value
    if (!r || !index.value) return { subclass: [], assembly: [] }
    const under = (m: string, anc: string) => !!index.value!.pathOf.get(m)?.includes(anc)
    const pair = (f: { from: string; to: string }) => (under(f.from, a) && under(f.to, b)) || (under(f.from, b) && under(f.to, a))
    return { subclass: r.subclasses.filter(pair), assembly: r.assembly.filter(pair) }
  }

  // ── 结构视图（ADR-0031）：本层结构边（K14、K17、U15、U17）或允许依赖图（U16）、指标（K16）与影响面（K15） ──

  /** K16：全系统各模块的 Ca / Ce / I（只看值依赖时另算）；没有代码事实时为 null（U16 不适用） */
  const metrics = computed<Map<string, ModuleMetrics> | null>(() => (report.value && index.value ? structureMetrics(index.value, report.value) : null))
  const valueMetrics = computed<Map<string, ModuleMetrics> | null>(() =>
    report.value && index.value ? structureMetrics(index.value, report.value, { valuesOnly: true }) : null,
  )

  /**
   * U16：活动草图（X3）里层的 mayDependOn——版本自带的草图与载荷附带的设计草图（与意图核验同一组，desk.intent）。
   * 只在没有代码事实时用到。
   */
  const sketchLayers = computed(() => {
    if (!index.value) return []
    const own = index.value.model.sketches.filter(s => sketchLifetime(s) === 'persistent' || design)
    const all = [...own, ...parseDesignSketches(sketches?.value ?? [])]
    return all.flatMap(s =>
      flattenSketch(s).flatMap(m => (m.def.kind === 'layer' && m.def.mayDependOn?.length ? [{ layer: m.id, mayDependOn: m.def.mayDependOn }] : [])),
    )
  })

  /** L15、U16：结构视角下本层的结构视图；其余视角为 null（不参与布局，节点位置取交互视角的布局，V12） */
  const structure = computed<StructureView | null>(() => {
    if (!index.value || !view.value || state.value.playback || state.value.mode !== 'structure') return null
    if (report.value) return structureView(index.value, view.value, report.value, metrics.value ? { metrics: metrics.value } : {})
    return structureView(index.value, view.value, null, { sketch: sketchLayers.value })
  })

  /** K16：面板「结构」一节——模块的 Ca / Ce / I、贡献最多的依赖方 / 被依赖方、本层节点数；没有代码事实时为 null */
  const metricsOf = (id: string, valuesOnly = false): ModuleMetricsDetail | null =>
    report.value && index.value ? moduleMetrics(index.value, report.value, id, { valuesOnly, ...(view.value ? { view: view.value } : {}) }) : null

  /** K15：模块的影响面（全系统）与它在本层的投影；没有代码事实时为 null */
  const impactOfModule = (id: string, valuesOnly = false): { impact: Impact; level: ReturnType<typeof levelImpact> | null } | null => {
    if (!report.value || !index.value) return null
    const impact = impactOf(index.value, report.value, id, { valuesOnly, ...(files.ownership.value ? { own: files.ownership.value } : {}) })
    if (!impact) return null
    return { impact, level: view.value ? levelImpact(index.value, view.value, impact) : null }
  }

  /** V12：本层这对节点之间有没有结构边——模式切换时把关系 / 视图边的选中映射成依赖边；没有代码事实时不给 */
  const structurePair = (fromModule: string, toModule: string): boolean =>
    !!report.value && !!index.value && !!view.value && hasStructureEdge(index.value, view.value, report.value, fromModule, toModule)

  return {
    status,
    error,
    report,
    structure,
    metrics,
    valueMetrics,
    metricsOf,
    impactOf: impactOfModule,
    structurePair,
    level,
    assembly,
    gateIssues,
    ledger,
    entryOf,
    selectedDep,
    selectedCycle,
    moduleDetail,
    relationFact,
    portOf,
    portsOf,
    portMarks,
    portProblems,
    unclassified,
    structureOf,
    structureBetween,
  }
}

export type FactsDerivations = ReturnType<typeof createFacts>
