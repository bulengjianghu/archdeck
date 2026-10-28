/**
 * DeskState 的架构治理派生（desk.facts，ADR-0015）：代码事实由源码同步取得，治理报告、本层投影与门禁问题调用模型层（K、U、Y）。
 * 只对当前版本（K8）；画布叠加只在交互视角、「代码事实」开启时（K9）。
 * 结构视图（ADR-0031）：本层结构边、指标与影响面；没有代码事实时只有允许依赖图（U16）。
 * 模块表面与承载链（ADR-0032）：束与元素级边、表面、越过入口、承载，以及结构视角画布按显示偏好过滤、聚焦、跨界折叠与表面展开的派生（structureDisplay）。
 */
import { computed, ref, type ComputedRef, type Ref, type ShallowRef } from 'vue'
import {
  carriersOf,
  elementSub,
  interactionBundle,
  isTarget,
  surfaceMetrics,
  surfaceOf,
  type Bundle,
  type Carrier,
  type ElementEdge,
  type ElementKind,
  type ExportedSymbol,
  type Frame,
  type InteractionBundle,
  type ModuleSurface,
  type SurfaceElement,
  type SurfaceMetrics,
  type SurfaceSource,
  againstStabilityOf,
  hasStructureEdge,
  isolatedInteractions,
  impactOf,
  levelImpact,
  levelTiers,
  layerUpward,
  type UpwardEdge,
  splitSignals,
  tierNoteText,
  tierView,
  type LevelTiers,
  type SplitSignals,
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
  type FileDep,
  flattenSketch,
  parseDesignSketches,
  sketchLifetime,
  type RawFile,
} from '@/model'
import { surfaceExpansion, type Expansion, type LayoutTiers, type StructureLinks } from '@/layout/layout'
import { baseLayoutLinks, toLayoutTiers } from './layoutLinks'
import { perspectiveOf, type ViewState } from '../transition'
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
  /** C6：显示偏好「总是展开表面」（呈现层的本地偏好经 desk.setSurfaceAlways 交来，表面展开并进布局同步） */
  surfaceAlways?: Readonly<Ref<boolean>>
}

/** C6、L20b：展开节点上一个元素的种类、扇入与所属子模块（本体为 null） */
export interface SurfaceInfo {
  kind: ElementKind
  fanIn: number
  sub: string | null
  /** L20④：使用它的模块（端口点悬停提示「扇入 N（使用它的模块）」） */
  users: string[]
}

/** 为什么没有代码事实，或正在取；源码清单读取失败也是 error（源码在本地是前提，G1） */
export type FactsStatus = 'ready' | 'loading' | 'design' | 'error'

/** B1、B4：结构视角画布的显示偏好（呈现层从 useStructurePrefs 读出后传入，不进视图状态；「总是展开表面」经 setSurfaceAlways 进布局同步） */
export interface StructureFilter {
  /** B1：只引类型的束画出 */
  typeOnly: boolean
  /** B1：只画交互使用档 */
  invokesOnly: boolean
  /** B4：只画未解释的束（Bundle.unexplained，T0 裁决 6） */
  uncoveredOnly: boolean
}

/** L21：束与边界节点的关系——两端都是本层兄弟 / 一端是边界节点（L14 边界、外部、目标态）/ 两端都是边界节点 */
export type BundleReach = 'sibling' | 'cross' | 'outer'

/** B1–B4、C6：结构视角画布要画的束与元素级边，及收起的计数、聚焦与表面展开（structureDisplay） */
export interface StructureDisplay {
  /** 画出的束，同 bundles 的顺序 */
  shown: Bundle[]
  /** 画出的元素级边：属于画出的束、被依赖方的表面展开且元素在展开集合里的（越过入口与整模块的边随展开一并给出） */
  elementEdges: ElementEdge[]
  /** 收起的束的条数：只引类型（B1）、只看交互使用时收起的值使用（B1）、只看未解释时收起的已解释（B4）、跨界折叠（B2） */
  hidden: { type: number; value: number; covered: number; cross: number }
  /** B2：本层节点 → 折叠进角标的跨界束的入 / 出条数 */
  cross: Map<string, { in: number; out: number }>
  /** 每条束与边界节点的关系 */
  reach: Map<string, BundleReach>
  /** 不论档位、过滤与折叠照画的束：基线外违规、环上、逆稳定（L15a①、B1、B2） */
  anomalies: Set<string>
  /** B3：选中束（K10 的 dep 选中）时与它两端相连的束；没有选中束时为 null */
  focus: { bundle: string; nodes: [string, string]; bundles: Set<string> } | null
  /** C6：表面展开——模块 ID → 展开的元素名（null 为全部元素）；同 desk.facts.expansion */
  expanded: Map<string, Set<string> | null>
}

export function createFacts({ state, index, view, files, sync, design, sketches, surfaceAlways = ref(false) }: FactsInputs) {
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

  // ── 模块表面（ADR-0032）：入口导出按需从源码同步取（读到前元素种类按用法推断），只对当前版本 ──

  /** K18：表面的来源——入口、归属与入口导出（读取中或读不到为 null）；没有代码事实时为 null（C8） */
  const surfaceSource = computed<SurfaceSource | null>(() => {
    const own = files.ownership.value
    if (!report.value || !entryOf.value || !own) return null
    const exportsOf = (file: string): readonly ExportedSymbol[] | null => {
      const r = sync.exports(file).value
      return r.status === 'ok' ? r.value : null
    }
    return { entryOf: entryOf.value, own, exportsOf }
  })

  /** K18：模块的表面；没有代码事实时只有声明接口（C8）；不是模块为 null */
  const surfaceOfModule = (id: string): ModuleSurface | null => (index.value ? surfaceOf(index.value, surfaceSource.value, id, report.value) : null)

  /** L20b：模块 m 的表面元素所属的子模块（元素 owner 在 m 之下的那一级）；本体为 null */
  const surfaceSubOf = (m: string, el: SurfaceElement): string | null => (index.value ? elementSub(index.value, files.ownership.value, m, el) : null)

  /** K19、C7：模块的表面指标（W / B、元素扇入、越过入口清单）；没有代码事实时为 null */
  const surfaceMetricsOf = (id: string, valuesOnly = false): SurfaceMetrics | null =>
    report.value && index.value && surfaceSource.value && index.value.modules.has(id)
      ? surfaceMetrics(index.value, report.value, surfaceSource.value, id, { valuesOnly })
      : null

  /** C3、C7：模块的越过入口清单（依赖方文件:行 → 符号）；没有代码事实时为空 */
  const bypassesOf = (id: string): FileDep[] => surfaceMetricsOf(id)?.bypasses ?? []

  /** K5d、K20：全部交互的承载（不判定的不在其中）；没有代码事实时为 null */
  const carriers = computed<Map<string, Carrier> | null>(() =>
    report.value && index.value && surfaceSource.value ? carriersOf(index.value, report.value, surfaceSource.value) : null,
  )
  /** K5d：一条交互的承载；不判定或没有代码事实时为 null */
  const carrierOf = (relationId: string): Carrier | null => carriers.value?.get(relationId) ?? null
  /** S18b：步骤 → 绑定的交互 → 承载段（帧没有绑定交互时 relation 为 null） */
  const stepCarrierOf = (frame: Pick<Frame, 'relation'>): { relation: string | null; carrier: Carrier | null } => ({
    relation: frame.relation ?? null,
    carrier: frame.relation ? carrierOf(frame.relation) : null,
  })

  /** K16：全系统各模块的 Ca / Ce / I（只看值依赖时另算），有入口的另带 W / B（K19）；没有代码事实时为 null（U16 不适用） */
  const metrics = computed<Map<string, ModuleMetrics> | null>(() =>
    report.value && index.value ? structureMetrics(index.value, report.value, surfaceSource.value ? { surface: surfaceSource.value } : {}) : null,
  )
  const valueMetrics = computed<Map<string, ModuleMetrics> | null>(() =>
    report.value && index.value
      ? structureMetrics(index.value, report.value, { valuesOnly: true, ...(surfaceSource.value ? { surface: surfaceSource.value } : {}) })
      : null,
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

  /** L15、U16：本层的结构视图，不论视角都算（结构边与交互边并集布局）；代码事实还在读取时为 null */
  const levelStructure = computed<StructureView | null>(() => {
    if (!index.value || !view.value || status.value === 'loading') return null
    if (report.value)
      return structureView(index.value, view.value, report.value, {
        ...(metrics.value ? { metrics: metrics.value } : {}),
        ...(surfaceSource.value ? { surface: surfaceSource.value } : {}),
      })
    return structureView(index.value, view.value, null, { sketch: sketchLayers.value })
  })

  /** L15、U16：结构视角下本层的结构视图；其余视角为 null */
  const structure = computed<StructureView | null>(() => (state.value.playback || state.value.mode !== 'structure' ? null : levelStructure.value))

  /** L28、K21③、K22：本层按值依赖的分层（普通层次、有代码事实时；不论视角，两个视角同一份布局 V12） */
  const tiers = computed<LevelTiers | null>(() => {
    const v = view.value
    return v && index.value && report.value ? levelTiers(index.value, v, report.value) : null
  })

  /** L29、K21③：画布角的分层提示（大环照样分层、本层没有依赖）；运行视角不给 */
  const tierHints = computed<string[]>(() => (perspectiveOf(state.value) === 'run' ? [] : (tiers.value?.notes ?? []).map(tierNoteText)))

  /** K22：本层向上的交互边——普通层次按算出的层（L28），分层总览按声明的层（第十四轮 F8）；没有代码事实时普通层次不给 */
  const upward = computed<UpwardEdge[]>(() => {
    const v = view.value
    if (!v || !index.value) return []
    return v.mode === 'layered' ? layerUpward(index.value, v) : (tiers.value?.upward ?? [])
  })

  /** L36：算出的层整组同一状态——画布角写一次「层 · 算出」与层数（只在画层带时；运行视角不给） */
  const layerNote = computed<{ status: 'computed'; count: number } | null>(() =>
    perspectiveOf(state.value) !== 'run' && tiers.value?.banded ? { status: 'computed', count: tiers.value.count } : null,
  )

  /** K21①②：本层（当前父模块）的子模块的拆分信号；没有代码事实时为 null */
  const split = computed<SplitSignals | null>(() => {
    const v = view.value
    const own = files.ownership.value
    return v && index.value && own && report.value ? splitSignals(index.value, own, v.parentId) : null
  })

  /**
   * K21：模块面板「拆分信号」——它自己不占文件、与兄弟共用文件（在父模块一层看），它的子模块不占文件、共用文件、有交互却没有值依赖（在它这一层看）；
   * 没有代码事实时为 null
   */
  const splitOf = (id: string) => {
    const idx = index.value
    const own = files.ownership.value
    const r = report.value
    if (!idx || !own || !r || !idx.modules.has(id)) return null
    const parent = idx.modules.get(id)!.parentId
    const up = parent ? splitSignals(idx, own, parent) : null
    const down = splitSignals(idx, own, id)
    const lv = (idx.childrenOf.get(id) ?? []).length >= 2 ? levelTiers(idx, tierView(idx, id), r) : null
    return {
      noFiles: !!up?.noFiles.includes(id),
      shared: up?.shared.filter(x => x.modules.includes(id)) ?? [],
      children: { noFiles: down.noFiles, shared: down.shared },
      noDeps: !!lv?.notes.some(n => n.kind === 'no-deps'),
      undepended: lv?.undepended.map(p => ({ from: p.from, to: p.to })) ?? [],
    }
  }

  /** L28：交给布局的分层（纯数据，进缓存键） */
  const layoutTiers = computed<LayoutTiers | null>(() => toLayoutTiers(tiers.value))

  /** L15、L21：并集布局的基础输入——本层全部束与元素级边（不含表面展开）；没有代码事实时为允许边（U16），读取中为 null */
  const baseLinks = computed<StructureLinks | null>(() => {
    const sv = levelStructure.value
    const v = view.value
    if (!sv || !v || !index.value) return null
    return baseLayoutLinks(index.value, v, sv, report.value, layoutTiers.value)
  })

  /** D7、D8：本层交互视图边按接收方表面散开的数据（结构 / 交互视角都给：布局取并集；运行视角与代码事实未就绪时为 null） */
  const spreads = computed<Map<string, InteractionBundle> | null>(() => {
    const v = view.value
    if (perspectiveOf(state.value) === 'run' || !v || status.value !== 'ready') return null
    const out = new Map<string, InteractionBundle>()
    for (const e of v.edges) {
      const b = interactionSpread(e.id)
      if (b) out.set(e.id, b)
    }
    return out
  })

  /**
   * C6、L20、L23：表面展开（两个视角同一套规则，V12）——选中模块、选中交互（接收方）或「总是展开表面」时展开的节点、元素端口与散开范围；
   * 选中束不展开（T2-7）。运行视角、分层总览、没有元素级边时为 null。布局同步与画布、structureDisplay 同读这一份。
   */
  const expansion = computed<Expansion | null>(() => {
    const v = view.value
    const links = baseLinks.value
    if (perspectiveOf(state.value) === 'run' || !v || !links?.elements?.length) return null
    // 没有展开的触发（选中模块 / 交互 / 视图边或总是展开）时不取散开数据（它要读接收方的入口导出）
    const sel = state.value.selection
    if (!surfaceAlways.value && sel?.kind !== 'module' && sel?.kind !== 'relation' && sel?.kind !== 'edge') return null
    return surfaceExpansion({ view: v, selection: sel, always: surfaceAlways.value, links, spreads: spreads.value, groupOf: elementGroupOf(v) })
  })

  /** L20b：本层展开节点的元素所属子模块（元素 owner 在节点模块之下的那一级，rank 为声明顺序）；本体为 null。按节点记忆一次计算 */
  const elementGroupOf = (v: LevelView) => {
    const memo = new Map<string, Map<string, { sub: string; rank: number } | null>>()
    return (node: string, name: string) => {
      if (!memo.has(node)) {
        const m = v.nodes.find(n => n.id === node)?.moduleId
        const idx = index.value
        const out = new Map<string, { sub: string; rank: number } | null>()
        if (m && idx) {
          const order = idx.childrenOf.get(m) ?? []
          for (const el of surfaceOfModule(m)?.elements ?? []) {
            const sub = surfaceSubOf(m, el)
            out.set(el.name, sub ? { sub, rank: order.indexOf(sub) < 0 ? order.length : order.indexOf(sub) } : null)
          }
        }
        memo.set(node, out)
      }
      return memo.get(node)!.get(name) ?? null
    }
  }

  /**
   * L15、L21、V12：交给布局的结构边——本层全部束（一对节点同方向一条，含只引类型、聚焦才画的）与元素级边，
   * 分层总览另加全部块的跨层依赖（chipDeps，按对合成一条）；没有代码事实时为允许边（U16），读取中为 null（只按交互边布局，读到后重算一次）。
   * C6：有表面展开时带上展开的节点与交互束的散开（本层重排，等同下钻）。不论视角都给，两个视角共用同一份布局（布局同步适配器只读这里）。
   */
  const layoutLinks = computed<StructureLinks | null>(() => {
    const base = baseLinks.value
    const x = expansion.value
    return base && x ? { ...base, expand: x.expand, interactions: x.interactions } : base
  })

  /** C6、L20、L20b：展开节点（模块）的元素种类、扇入与所属子模块（元素记号的悬停与分组）；没有展开时为 null */
  const surfaceInfo = computed<Map<string, Map<string, SurfaceInfo>> | null>(() => {
    const x = expansion.value
    const v = view.value
    if (!x || !v) return null
    const out = new Map<string, Map<string, SurfaceInfo>>()
    for (const e of x.expand) {
      const m = v.nodes.find(n => n.id === e.node)?.moduleId
      if (!m || out.has(m)) continue
      const uses = new Map((surfaceMetricsOf(m)?.uses ?? []).map(u => [u.element.name, u.modules]))
      out.set(
        m,
        new Map(
          (surfaceOfModule(m)?.elements ?? []).map(el => {
            const users = [...(uses.get(el.name) ?? [])]
            return [el.name, { kind: el.kind, fanIn: users.length, sub: surfaceSubOf(m, el), users }]
          }),
        ),
      )
    }
    return out
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

  /** K15b、K15d（ADR-0037）：影响面查询的结果——视图状态的 impactQuery 与选中的模块；缺省只看值依赖，「含只引类型」时按全部种类；不看、没选中模块或没有代码事实时为 null */
  const queried = computed(() => {
    const q = state.value.impactQuery
    const sel = state.value.selection
    if (!q || sel?.kind !== 'module') return null
    const hit = impactOfModule(sel.id, !q.types)
    return hit ? { ...hit, mode: q.mode } : null
  })

  /** U17：模块直接依赖的模块中违背稳定依赖方向的（面板「逆稳定」提示行，只看值依赖时按值依赖的指标） */
  const againstOf = (id: string, valuesOnly = false): { module: string; hit: { from: number; to: number } }[] => {
    const all = valuesOnly ? valueMetrics.value : metrics.value
    const i = impactOfModule(id, valuesOnly)
    if (!all || !i || !index.value) return []
    return againstStabilityOf(
      index.value,
      all,
      id,
      i.impact.outgoing.filter(e => e.distance === 1).map(e => e.module),
    )
  }

  /** K17：交互图互查——涉及模块（含子树）、两端之间没有任何依赖的交互关系；没有代码事实时为空 */
  const isolatedOf = (id: string): string[] => (report.value && index.value ? isolatedInteractions(index.value, report.value, id) : [])

  // ── 结构视角画布的派生（ADR-0032 B、C6）：束的过滤、跨界折叠、聚焦与表面展开；呈现层只读这里（工程原则 4） ──

  /** L14、B2：本层的边界节点——外部（boundary:）、边界角色（port / adapter）与目标态模块 */
  const boundaryNodes = computed<Set<string>>(() => {
    const v = view.value
    const idx = index.value
    if (!v || !idx) return new Set()
    return new Set(v.nodes.filter(n => n.role === 'boundary' || n.rim || (idx.modules.has(n.moduleId) && isTarget(idx, n.moduleId))).map(n => n.id))
  })

  /** L15a①：照画的束——基线外违规（新增 / 无基线）、环上（Y5 的本层环边）、逆稳定（U17） */
  const anomalies = computed<Set<string>>(() => {
    const sv = structure.value
    if (!sv?.facts) return new Set()
    const cyc = new Set((level.value?.levelCycles ?? []).flatMap(c => c.edges.map(e => `${e.from}->${e.to}`)))
    return new Set(
      sv.bundles.filter(b => b.ruling.status === 'new' || b.ruling.status === 'open' || cyc.has(`${b.from}->${b.to}`) || b.againstStability).map(b => b.id),
    )
  })

  /**
   * B1–B4、C6：结构视角画布按显示偏好要画的束与元素级边。B1：只引类型档收起（typeOnly 时画），invokesOnly 时值使用也收起；B4：uncoveredOnly 时只画未解释的（Bundle.unexplained）；
   * B2：一端是边界节点的束缺省折叠、计入本层另一端节点的「入 · 出」，两端都是边界节点的只在聚焦时画；悬停或选中一端时画出。
   * 基线外违规、环上、逆稳定的束不论档位与折叠照画（B4 只看覆盖）。B3：选中束时与两端相连的束为聚焦集合。
   * C6：表面展开取 expansion（选中模块 → 它的全部元素；surfaceAlways → 本层全部模块；选中束不展开，T2-7）。
   * 没有代码事实（允许依赖图）或不在结构视角时为 null。
   */
  const structureDisplay = (filter: StructureFilter): StructureDisplay | null => {
    const sv = structure.value
    const v = view.value
    if (!sv?.facts || !v) return null
    const s = state.value
    const bnd = boundaryNodes.value
    const odd = anomalies.value
    const touch = (id: string | null | undefined, node: string) => !!id && (node === id || node === `boundary:${id}`)
    const near = (b: Bundle) => [s.hover, s.selection?.kind === 'module' ? s.selection.id : null].some(id => touch(id, b.from) || touch(id, b.to))
    const reach = new Map<string, BundleReach>()
    const cross = new Map<string, { in: number; out: number }>()
    const hidden = { type: 0, value: 0, covered: 0, cross: 0 }
    const shown: Bundle[] = []
    for (const b of sv.bundles) {
      const fb = bnd.has(b.from)
      const tb = bnd.has(b.to)
      const r: BundleReach = fb && tb ? 'outer' : fb || tb ? 'cross' : 'sibling'
      reach.set(b.id, r)
      const keep = odd.has(b.id)
      // B4（T0 裁决 6）：只看未解释——既无交互覆盖、形态也不是端口实现 / 子类 / 组装的束（Bundle.unexplained，K7 口径）
      if (filter.uncoveredOnly && !b.unexplained) {
        hidden.covered++
        continue
      }
      if (!keep && b.tier === 'type' && !filter.typeOnly) {
        hidden.type++
        continue
      }
      if (!keep && b.tier === 'value' && filter.invokesOnly) {
        hidden.value++
        continue
      }
      if (r === 'cross' && !keep) {
        const inner = fb ? b.to : b.from
        const c = cross.get(inner) ?? cross.set(inner, { in: 0, out: 0 }).get(inner)!
        if (fb) c.in++
        else c.out++
      }
      if (r !== 'sibling' && !keep && !near(b)) {
        if (r === 'cross') hidden.cross++
        continue
      }
      shown.push(b)
    }
    // B3：选中束
    let focus: StructureDisplay['focus'] = null
    const sel = s.selection
    const picked = sel?.kind === 'dep' ? sv.bundles.find(b => `${b.fromModule}->${b.toModule}` === sel.id) : undefined
    if (picked)
      focus = {
        bundle: picked.id,
        nodes: [picked.from, picked.to],
        bundles: new Set(sv.bundles.filter(b => [b.from, b.to].some(n => n === picked.from || n === picked.to)).map(b => b.id)),
      }
    // C6：表面展开（同布局同步的 expansion，两个视角一份）——模块 ID → 展开的元素名（null 为全部依赖方都散开）
    const expanded = new Map<string, Set<string> | null>()
    for (const x of expansion.value?.expand ?? []) {
      const m = v.nodes.find(n => n.id === x.node)?.moduleId
      if (m) expanded.set(m, x.from === null ? null : new Set(x.elements))
    }
    const drawn = new Set(shown.map(b => b.id))
    const elementEdges = sv.elementEdges.filter(e => {
      if (!drawn.has(e.bundle) || !expanded.has(e.toModule)) return false
      const names = expanded.get(e.toModule)
      return names === null || !e.element || names!.has(e.element.name)
    })
    return { shown, elementEdges, hidden, cross, reach, anomalies: odd, focus, expanded }
  }

  /** D7、D8：交互视图边（本层一对节点、一种类型）按接收方表面散开的数据与束内混合；不是本层的视图边为 null */
  const interactionSpread = (edgeId: string): InteractionBundle | null => {
    const v = view.value
    if (!v || !index.value) return null
    const e = [...v.edges, ...(v.coreEdges ?? []), ...(v.shelfEdges ?? [])].find(x => x.id === edgeId)
    if (!e) return null
    const receiver = v.nodes.find(n => n.id === e.to)?.moduleId
    return interactionBundle(index.value, receiver ? surfaceOfModule(receiver) : null, e.relationIds)
  }

  /** V12：本层这对节点之间有没有结构边——模式切换时把关系 / 视图边的选中映射成依赖边；没有代码事实时不给 */
  const structurePair = (fromModule: string, toModule: string): boolean =>
    !!report.value && !!index.value && !!view.value && hasStructureEdge(index.value, view.value, report.value, fromModule, toModule)

  return {
    status,
    error,
    report,
    structure,
    layoutLinks,
    tiers,
    tierHints,
    layerNote,
    upward,
    split,
    splitOf,
    metrics,
    valueMetrics,
    metricsOf,
    impactOf: impactOfModule,
    queried,
    structurePair,
    structureDisplay,
    expansion,
    spreads,
    surfaceInfo,
    surfaceSource,
    surfaceOf: surfaceOfModule,
    surfaceSubOf,
    surfaceMetricsOf,
    bypassesOf,
    carriers,
    carrierOf,
    stepCarrierOf,
    interactionSpread,
    againstOf,
    isolatedOf,
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
