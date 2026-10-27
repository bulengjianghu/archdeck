/**
 * 结构视图（ADR-0031）：依赖事实在一个层次上的投影与指标——结构边的种类与档（K14）、交互覆盖数（K17）、规则叠加（U15）、
 * 影响面（K15）、扇入扇出与不稳定度（K16）、稳定依赖方向（U17）、没有代码事实时的允许依赖图（U16）。
 * 只读代码事实与规则，不读关系来定边（原则 SP2）；投影与 K9、Y4 共用 nodeOf（mapEndpoint）。
 */
import { moduleName } from '../names'
import { moduleFiles, moduleInterfaces, type SourceOwnership } from '../source'
import { RELATION_TYPES, type LevelView, type ModelIndex } from '../types'
import { valueDeps } from './cycles'
import { contractNames, coveringRelations, depKey, implementsInto, within } from './facts'
import { nodeOf } from './level'
import { rulesOf } from './rules'
import { sharedHostOf } from './roles'
import { elementSlots, slotKey, strongerForm, strongerTier, surfaceContext, surfaceWidths, tierOf } from './surface'
import {
  DEP_FORMS,
  STABILITY_BANDS,
  type AllowedDeps,
  type AllowedEdge,
  type Bundle,
  type ChipDep,
  type ElementEdge,
  type EdgeRuling,
  type GovernanceReport,
  type Impact,
  type ImpactEntry,
  type LevelDeps,
  type LevelDepsOptions,
  type MetricsOptions,
  type ModuleDep,
  type ModuleMetrics,
  type ModuleMetricsDetail,
  type RuleBasis,
  type StabilityBand,
  type StructureView,
  type Violation,
  type ViolationStatus,
} from './types'

// ── K14：依赖的档（按元素级边取最强的在 surface.ts） ──

export { tierOf }

// ── U15：规则叠加 ──

const STATUS_ORDER: readonly ViolationStatus[] = ['new', 'open', 'known', 'allowed']

/** U2–U4：约束模块依赖 from → to 的规则（不论是否通过）；访问面只按两端判断「受约束」，经由文件是否合规看违规（U4） */
export function ruleBasis(index: ModelIndex, from: string, to: string): RuleBasis[] {
  const rules = rulesOf(index)
  const out: RuleBasis[] = []
  const pa = index.pathOf.get(from) ?? []
  const pb = index.pathOf.get(to) ?? []
  let i = 0
  while (i < pa.length && i < pb.length && pa[i] === pb[i]) i++
  if (rules.layers !== false && i < pa.length && i < pb.length) {
    const x = index.modules.get(pa[i])
    const y = index.modules.get(pb[i])
    if (x?.kind === 'layer' && y?.kind === 'layer' && x.mayDependOn)
      out.push({ kind: 'layer', at: x.id, text: `层规则：「${x.name}」可依赖 ${x.mayDependOn.map(id => `「${moduleName(index, id)}」`).join('、') || '无'}` })
  }
  for (const m of rules.modules ?? []) {
    const inside = within(index, from, m.module)
    if (m.mayDependOn && inside && !within(index, to, m.module))
      out.push({
        kind: 'deps',
        at: m.module,
        text: `依赖白名单：「${moduleName(index, m.module)}」之外只许依赖 ${m.mayDependOn.map(id => `「${moduleName(index, id)}」`).join('、')}`,
      })
    if (m.exposes && !inside && within(index, to, m.module)) out.push({ kind: 'exposes', at: m.module, text: `访问面：「${moduleName(index, m.module)}」只许经由 ${m.exposes.join('、')} 访问` })
  }
  return out
}

/** U15：投影到一条边的模块依赖与违规给出判定 */
function ruling(index: ModelIndex, deps: readonly ModuleDep[], violations: readonly Violation[]): EdgeRuling {
  if (violations.length) {
    const status = STATUS_ORDER.find(s => violations.some(v => v.status === s))!
    return { verdict: 'violation', status, violations: [...violations], allowedBy: [] }
  }
  const seen = new Set<string>()
  const allowedBy: RuleBasis[] = []
  for (const d of deps)
    for (const b of ruleBasis(index, d.from, d.to)) {
      const k = `${b.kind}:${b.at}`
      if (!seen.has(k)) {
        seen.add(k)
        allowedBy.push(b)
      }
    }
  return { verdict: allowedBy.length ? 'allowed' : 'unconstrained', violations: [], allowedBy }
}

// ── K16：扇入、扇出与不稳定度 ──

/** K16：不稳定度三档（STABILITY_BANDS）；Ca + Ce = 0 时无定义 */
export const stabilityBand = (i: number | null): StabilityBand | null =>
  i === null ? null : i < STABILITY_BANDS[0] ? 'stable' : i > STABILITY_BANDS[1] ? 'unstable' : 'balanced'

const depsOf = (report: Pick<GovernanceReport, 'moduleDeps'>, opts: MetricsOptions = {}): ModuleDep[] =>
  opts.valuesOnly ? valueDeps(report.moduleDeps.values()) : [...report.moduleDeps.values()]

/** K16：每个模块（含父模块，按子树计；不含系统根）的 Ca / Ce / I；按模块计，与层次无关 */
export function structureMetrics(index: ModelIndex, report: Pick<GovernanceReport, 'moduleDeps'>, opts: MetricsOptions = {}): Map<string, ModuleMetrics> {
  const deps = depsOf(report, opts)
  const ins = new Map<string, Set<string>>()
  const outs = new Map<string, Set<string>>()
  const add = (m: Map<string, Set<string>>, k: string, v: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(v)
  for (const d of deps) {
    const pf = index.pathOf.get(d.from) ?? []
    const pt = index.pathOf.get(d.to) ?? []
    // 依赖方 → 被依赖方计入「被依赖方的每个祖先 M、只要依赖方不在 M 子树内」的扇入，反之亦然
    for (const m of pt) if (!pf.includes(m)) add(ins, m, d.from)
    for (const m of pf) if (!pt.includes(m)) add(outs, m, d.to)
  }
  const out = new Map<string, ModuleMetrics>()
  for (const id of index.modules.keys()) {
    if (id === index.rootId) continue
    const ca = ins.get(id)?.size ?? 0
    const ce = outs.get(id)?.size ?? 0
    const instability = ca + ce ? ce / (ca + ce) : null
    out.set(id, { module: id, ca, ce, instability, band: stabilityBand(instability) })
  }
  // K19：给了表面来源时，有入口的模块另带 W / B（同 valuesOnly 口径）
  if (opts.surface)
    for (const [m, wb] of surfaceWidths(index, report, opts.surface, opts)) {
      const hit = out.get(m)
      if (hit) out.set(m, { ...hit, ...wb })
    }
  return out
}

export const TOP_CONTRIBUTORS = 5

export function moduleMetrics(
  index: ModelIndex,
  report: Pick<GovernanceReport, 'moduleDeps'>,
  id: string,
  opts: MetricsOptions & { view?: LevelView } = {},
): ModuleMetricsDetail | null {
  const base = structureMetrics(index, report, opts).get(id)
  if (!base) return null
  const deps = depsOf(report, opts)
  const inc = new Map<string, number>()
  const outg = new Map<string, number>()
  for (const d of deps) {
    const fi = within(index, d.from, id)
    const ti = within(index, d.to, id)
    if (ti && !fi) inc.set(d.from, (inc.get(d.from) ?? 0) + d.files.length)
    else if (fi && !ti) outg.set(d.to, (outg.get(d.to) ?? 0) + d.files.length)
  }
  const top = (m: Map<string, number>) =>
    [...m]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOP_CONTRIBUTORS)
      .map(([module, files]) => ({ module, files }))
  let level: ModuleMetricsDetail['level']
  if (opts.view) {
    const present = new Set(opts.view.nodes.map(n => n.id))
    const self = nodeOf(index, opts.view, present, id)
    const nodes = (ms: Iterable<string>) => new Set([...ms].map(m => nodeOf(index, opts.view!, present, m)).filter(n => n && n !== self)).size
    level = { in: nodes(inc.keys()), out: nodes(outg.keys()) }
  }
  return { ...base, topDependents: top(inc), topDependencies: top(outg), ...(level ? { level } : {}) }
}

// ── U17：稳定依赖方向 ──

/** U17：依赖方的 I 比被依赖方小这么多以上时提示（暂定，h5player 实测后定，ADR-0031 裁决 8） */
export const STABLE_DIRECTION_THRESHOLD = 0.3

/** U17：A → B 违背稳定依赖方向时为两端的 I；被依赖方是共用件、任一端 I 无定义时不提示 */
export function againstStability(
  index: ModelIndex,
  metrics: ReadonlyMap<string, ModuleMetrics>,
  from: string,
  to: string,
  threshold = STABLE_DIRECTION_THRESHOLD,
): { from: number; to: number } | null {
  if (sharedHostOf(index, to)) return null
  const a = metrics.get(from)?.instability
  const b = metrics.get(to)?.instability
  if (a == null || b == null) return null
  return b - a > threshold ? { from: a, to: b } : null
}

// ── K14、K17、U15、U17：依赖边投影 ──

type ReportPart = Pick<GovernanceReport, 'moduleDeps' | 'violations' | 'undescribed' | 'implementers' | 'subclasses' | 'assembly'>

const moduleOfNode = (view: LevelView, nodeId: string) => view.nodes.find(n => n.id === nodeId)?.moduleId ?? nodeId

/**
 * K14、K17、U15、U17：模块依赖（K4，全部种类）按 mapEndpoint 投影到本层，两端为本层两个不同节点的成为结构边；
 * 一对节点同方向一条束（A4，取最强形态与档），束内为元素级边（A1：依赖方 → 被依赖方的表面元素，一条一种形态）；
 * 束带覆盖与未解释标记（K17）、这对节点的规则判定（U15）与逆稳定提示（U17，全部束，A7）。顺序：按依赖方、被依赖方节点的视图顺序。
 */
export function levelDeps(index: ModelIndex, view: LevelView, report: ReportPart, opts: LevelDepsOptions = {}): LevelDeps {
  const present = new Set(view.nodes.map(n => n.id))
  const project = (d: { from: string; to: string }) => {
    const a = nodeOf(index, view, present, d.from)
    const b = nodeOf(index, view, present, d.to)
    return a && b && a !== b ? ([a, b] as const) : null
  }
  interface Pair {
    from: string
    to: string
    deps: ModuleDep[]
    violations: Violation[]
  }
  const pairs = new Map<string, Pair>()
  const portsOf = new Map<string, Set<string>>()
  for (const d of report.moduleDeps.values()) {
    const p = project(d)
    if (!p) continue
    const k = depKey(p[0], p[1])
    const pair = pairs.get(k) ?? pairs.set(k, { from: p[0], to: p[1], deps: [], violations: [] }).get(k)!
    pair.deps.push(d)
    if (!portsOf.has(d.to)) portsOf.set(d.to, contractNames(index, d.to))
  }
  for (const v of report.violations) {
    const p = project(v)
    if (p) pairs.get(depKey(p[0], p[1]))?.violations.push(v)
  }
  const undescribed = new Set(report.undescribed.map(d => d.key))
  const subclass = new Set(report.subclasses.map(f => f.key))
  const assembly = new Set(report.assembly.map(f => f.key))
  const metrics = opts.metrics ?? structureMetrics(index, report)
  const order = new Map(view.nodes.map((n, i) => [n.id, i]))
  const byOrder = (a: Pair, b: Pair) => (order.get(a.from) ?? 0) - (order.get(b.from) ?? 0) || (order.get(a.to) ?? 0) - (order.get(b.to) ?? 0)

  const rulings = new Map<Pair, EdgeRuling>()
  for (const p of pairs.values()) rulings.set(p, ruling(index, p.deps, p.violations))

  // K14、A1–A4、A7：束与元素级边
  const ctx = opts.surface ? surfaceContext(index, opts.surface, report) : null
  const bundles: Bundle[] = []
  const elementEdges: ElementEdge[] = []
  for (const p of [...pairs.values()].sort(byOrder)) {
    const fromModule = moduleOfNode(view, p.from)
    const toModule = moduleOfNode(view, p.to)
    const bundleId = `bundle:${depKey(p.from, p.to)}`
    const list = elementSlots(
      index,
      ctx ? { src: opts.surface!, ctx } : null,
      toModule,
      p.deps.flatMap(d => d.files.map(f => ({ f, ports: portsOf.get(d.to)! }))),
    )
    const files = p.deps.reduce((n, d) => n + d.files.length, 0)
    const own: ElementEdge[] = list.map(x => ({
      id: `el:${depKey(p.from, p.to)}:${x.form}:${slotKey(x)}`,
      bundle: bundleId,
      from: p.from,
      to: p.to,
      fromModule,
      toModule,
      element: x.element,
      ...(x.bypass ? { bypass: true as const } : {}),
      form: x.form,
      tier: x.tier,
      files: x.files,
    }))
    elementEdges.push(...own)
    const forms = DEP_FORMS.filter(f => own.some(e => e.form === f))
    const bundle: Bundle = {
      id: bundleId,
      from: p.from,
      to: p.to,
      fromModule,
      toModule,
      form: own.map(e => e.form).reduce(strongerForm),
      forms,
      ...(forms.length > 1 ? { mixed: true as const } : {}),
      tier: own.map(e => e.tier).reduce(strongerTier),
      files,
      elements: new Set(own.flatMap(e => (e.element ? [e.element.name] : []))).size,
      bypass: new Set(own.filter(e => e.bypass).flatMap(e => e.files)).size,
      edges: own.map(e => e.id),
      deps: p.deps.map(d => d.key),
      coverage: {
        relations: [...new Set(p.deps.flatMap(d => coveringRelations(index, d.from, d.to)))].sort(),
        implementers: p.deps.filter(d => implementsInto(index, report.implementers, d.from, d.to)).length,
        subclass: p.deps.filter(d => subclass.has(d.key)).length,
        assembly: p.deps.filter(d => assembly.has(d.key)).length,
      },
      ...(p.deps.some(d => undescribed.has(d.key)) ? { unexplained: true as const } : {}),
      ruling: rulings.get(p)!,
    }
    const against = againstStability(index, metrics, fromModule, toModule, opts.threshold)
    if (against) bundle.againstStability = against
    bundles.push(bundle)
  }
  return { bundles, elementEdges }
}

const VIOLATION_ORDER: readonly ViolationStatus[] = ['new', 'open', 'known', 'allowed']

/**
 * O13③、L21：分层总览中核心模块（与架上共用件）的跨层依赖——模块依赖的一端落在给出的块（chips）的子树内时，
 * 这一端投到块、另一端投到它所在的块（没有时为带或边界节点，mapEndpoint）；两端同带的不画（带内）。
 * 一对节点同方向一条束（同 K14 的束：最强形态与档；跨层依赖不接到元素，形态按文件依赖判）；违规取最严的状态。顺序：按节点对首次出现。
 */
export function chipDeps(
  index: ModelIndex,
  view: LevelView,
  report: Pick<GovernanceReport, 'moduleDeps' | 'violations'>,
  chips: ReadonlySet<string>,
): ChipDep[] {
  if (!chips.size) return []
  const present = new Set(view.nodes.map(n => n.id))
  const chipIds = new Set(view.nodes.filter(n => n.role === 'core' || n.role === 'shared').map(n => n.id))
  const layerOf = new Map(view.nodes.map(n => [n.id, n.layerId ?? n.id]))
  const chipOf = (m: string): string | null => {
    const p = index.pathOf.get(m) ?? []
    for (let i = p.length - 1; i >= 0; i--) if (chipIds.has(p[i])) return p[i]
    return null
  }
  const project = (d: { from: string; to: string }): [string, string] | null => {
    const ca = chipOf(d.from)
    const cb = chipOf(d.to)
    if (!(ca && chips.has(ca)) && !(cb && chips.has(cb))) return null
    const a = ca ?? nodeOf(index, view, present, d.from)
    const b = cb ?? nodeOf(index, view, present, d.to)
    if (!a || !b || a === b || layerOf.get(a) === layerOf.get(b)) return null
    return [a, b]
  }
  interface Pair {
    from: string
    to: string
    deps: ModuleDep[]
    violations: Violation[]
  }
  const pairs = new Map<string, Pair>()
  for (const d of report.moduleDeps.values()) {
    const p = project(d)
    if (!p) continue
    const k = depKey(p[0], p[1])
    ;(pairs.get(k) ?? pairs.set(k, { from: p[0], to: p[1], deps: [], violations: [] }).get(k)!).deps.push(d)
  }
  for (const v of report.violations) {
    const p = project(v)
    if (p) pairs.get(depKey(p[0], p[1]))?.violations.push(v)
  }
  const out: ChipDep[] = []
  for (const p of pairs.values()) {
    const violation = VIOLATION_ORDER.find(s => p.violations.some(v => v.status === s))
    const files = p.deps.flatMap(d => {
      const ports = contractNames(index, d.to)
      return d.files.map(f => ({ f, ports }))
    })
    const slots = elementSlots(index, null, null, files)
    out.push({
      id: `chip:${depKey(p.from, p.to)}`,
      from: p.from,
      to: p.to,
      fromModule: moduleOfNode(view, p.from),
      toModule: moduleOfNode(view, p.to),
      form: slots.map(x => x.form).reduce(strongerForm),
      forms: DEP_FORMS.filter(f => slots.some(x => x.form === f)),
      tier: slots.map(x => x.tier).reduce(strongerTier),
      files: files.length,
      edges: slots.length,
      deps: p.deps.map(d => d.key),
      ...(violation ? { violation } : {}),
    })
  }
  return out
}

/** K17：交互图互查——涉及模块 M（含子树）、两端之间没有任何依赖的交互关系（K6 报警的未证实），按描述顺序 */
export function isolatedInteractions(index: ModelIndex, report: Pick<GovernanceReport, 'relations'>, id: string): string[] {
  const out: string[] = []
  for (const r of index.relations.values()) {
    if (!within(index, r.from, id) && !within(index, r.to, id)) continue
    const c = report.relations.get(r.id)
    if (c?.status === 'unconfirmed' && c.isolated) out.push(r.id)
  }
  return out
}

/** U17：模块 M 直接依赖的模块（targets）中违背稳定依赖方向的，带两端的 I */
export function againstStabilityOf(
  index: ModelIndex,
  metrics: ReadonlyMap<string, ModuleMetrics>,
  from: string,
  targets: readonly string[],
  threshold = STABLE_DIRECTION_THRESHOLD,
): { module: string; hit: { from: number; to: number } }[] {
  return targets.flatMap(module => {
    const hit = againstStability(index, metrics, from, module, threshold)
    return hit ? [{ module, hit }] : []
  })
}

/** K10、V12：本层这对节点（以两端的模块 ID 指明）之间有没有结构边 */
export function hasStructureEdge(index: ModelIndex, view: LevelView, report: Pick<GovernanceReport, 'moduleDeps'>, fromModule: string, toModule: string): boolean {
  const present = new Set(view.nodes.map(n => n.id))
  const a = nodeOf(index, view, present, fromModule)
  const b = nodeOf(index, view, present, toModule)
  if (!a || !b || a === b) return false
  for (const d of report.moduleDeps.values()) if (nodeOf(index, view, present, d.from) === a && nodeOf(index, view, present, d.to) === b) return true
  return false
}

// ── K15：影响面 ──

/**
 * K15：模块 M（含其子树）的传入 / 传出闭包，各带到 M 子树的最短距离（BFS），按距离、模块 ID 排序；
 * 全部种类的模块依赖（K4），valuesOnly 时去掉只引类型（同 Y1）；环成员按 report.moduleCycles（Y1）标出。共用件照算（O13）。
 */
export function impactOf(
  index: ModelIndex,
  report: Pick<GovernanceReport, 'moduleDeps' | 'moduleCycles'>,
  id: string,
  opts: MetricsOptions & { own?: SourceOwnership } = {},
): Impact | null {
  if (!index.modules.has(id)) return null
  const deps = depsOf(report, opts)
  const fwd = new Map<string, string[]>()
  const back = new Map<string, string[]>()
  // K15d：传入方向另走一遍不经可截断依赖的图，走不到的为「可能波及」
  const firm = new Map<string, string[]>()
  const contracts = new Map<string, ReadonlySet<string>>()
  for (const d of deps) {
    ;(fwd.get(d.from) ?? fwd.set(d.from, []).get(d.from)!).push(d.to)
    ;(back.get(d.to) ?? back.set(d.to, []).get(d.to)!).push(d.from)
    if (!cuttableDep(index, d, contracts)) (firm.get(d.to) ?? firm.set(d.to, []).get(d.to)!).push(d.from)
  }
  const cyclic = new Set(report.moduleCycles.flatMap(c => c.members))
  const inside = (m: string) => within(index, m, id)
  const seeds = [...new Set(deps.flatMap(d => [d.from, d.to]))].filter(inside)
  const reach = (adj: Map<string, string[]>): Map<string, number> => {
    const dist = new Map<string, number>()
    let frontier = seeds
    for (let k = 1; frontier.length; k++) {
      const next: string[] = []
      for (const m of frontier)
        for (const n of adj.get(m) ?? [])
          if (!inside(n) && !dist.has(n)) {
            dist.set(n, k)
            next.push(n)
          }
      frontier = next
    }
    return dist
  }
  const walk = (adj: Map<string, string[]>, certain?: ReadonlyMap<string, number>): ImpactEntry[] =>
    [...reach(adj)]
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      .map(([module, distance]) => ({ module, distance, inCycle: cyclic.has(module), ...(certain && !certain.has(module) ? { possible: true as const } : {}) }))
  const incoming = walk(back, reach(firm))
  const outgoing = walk(fwd)
  const countFiles = (list: ImpactEntry[]) => new Set(list.flatMap(e => moduleFiles(index, opts.own!, e.module))).size
  return {
    module: id,
    valuesOnly: !!opts.valuesOnly,
    incoming,
    outgoing,
    inCycle: [...cyclic].some(inside),
    ...(opts.own ? { files: { incoming: countFiles(incoming), outgoing: countFiles(outgoing) } } : {}),
  }
}

const bareName = (name: string) => name.replace(/[(<].*$/s, '').trim()

/** K15d：模块 M 的具名契约——M 子树声明的接口（G12 口径，含端口）与数据结构的名字 */
export function contractOf(index: ModelIndex, id: string): Set<string> {
  const out = new Set(moduleInterfaces(index, id).map(x => bareName(index.interfaces.get(x)?.name ?? '')))
  for (const m of index.modules.values())
    if (index.pathOf.get(m.id)?.includes(id)) for (const ds of m.dataStructures ?? []) out.add(bareName(index.dataStructures.get(ds)?.name ?? ''))
  out.delete('')
  return out
}

/**
 * K15d（ADR-0037）：可截断的模块依赖——每条文件依赖都只经具名契约：`export … from` 再导出（透传，不使用），或按名字导入、名字全在被依赖方的具名契约里
 * （contractOf）且不是子类；整模块导入、命名空间导入、契约外的名字都不算。改被依赖方的内部实现时变更可以停在这里（「可能波及」）。cache 按被依赖方缓存契约。
 */
export function cuttableDep(index: ModelIndex, d: Pick<ModuleDep, 'to' | 'files'>, cache = new Map<string, ReadonlySet<string>>()): boolean {
  const contract = cache.get(d.to) ?? cache.set(d.to, contractOf(index, d.to)).get(d.to)!
  return (
    d.files.length > 0 &&
    d.files.every(
      f =>
        (f.reexport && !f.uses && !f.invokes) ||
        (!!f.names?.length &&
          f.names.every(n => contract.has(n)) &&
          !(f.inherits ?? []).some(h => h.clause === 'extends' && h.decl !== 'interface' && h.decl !== 'type')),
    )
  )
}

/** K15：影响面在本层的一个节点——方向、最短距离、在环中；K15d：节点下的传入命中全是「可能波及」时 possible（双向的不标） */
export interface LevelImpactHit {
  direction: 'in' | 'out' | 'both'
  distance: number
  inCycle: boolean
  possible?: true
}

/** K15：影响面投影到本层——节点 ID → 方向与最短距离（两个方向都在时为 both，距离取小）；M 所在的节点不在其中 */
export function levelImpact(index: ModelIndex, view: LevelView, impact: Impact): Map<string, LevelImpactHit> {
  const present = new Set(view.nodes.map(n => n.id))
  const self = nodeOf(index, view, present, impact.module)
  const out = new Map<string, LevelImpactHit>()
  const put = (list: ImpactEntry[], dir: 'in' | 'out') => {
    for (const e of list) {
      const n = nodeOf(index, view, present, e.module)
      if (!n || n === self) continue
      const hit = out.get(n)
      const possible = dir === 'in' && !!e.possible && (!hit || (hit.direction === 'in' && !!hit.possible))
      out.set(n, {
        direction: !hit || hit.direction === dir ? dir : 'both',
        distance: Math.min(hit?.distance ?? e.distance, e.distance),
        inCycle: !!hit?.inCycle || e.inCycle,
        ...(possible ? { possible: true as const } : {}),
      })
    }
  }
  put(impact.incoming, 'in')
  put(impact.outgoing, 'out')
  return out
}

// ── U16：没有代码事实时的允许依赖图 ──

/** U16：没有代码事实时的说明（画布角） */
export const ALLOWED_ONLY_NOTE = '没有代码事实，只画允许依赖'
/** U16：没有任何 mayDependOn 时的说明 */
export const NO_ALLOWED_NOTE = '没有代码事实，描述里也没有 mayDependOn：结构视角无边'
/** U16：K15、K16、K17、U15 不适用的原因 */
export const NO_FACTS_REASON = '没有代码事实（设计版本、提交版本或源码读取失败，K8）：影响面、指标、交互覆盖与违规不适用'

/**
 * U16：没有代码事实时，层的 mayDependOn（U2，rules.layers: false 时不画）与 rules.modules[].mayDependOn（U3）按 mapEndpoint 投影为本层的允许边；
 * sketch 为活动草图里层的 mayDependOn（X3，由调用方给出）。同一对节点合并；两端落在同一节点或不在本层的不画。
 */
export function allowedDeps(index: ModelIndex, view: LevelView, sketch: readonly { layer: string; mayDependOn: readonly string[] }[] = []): AllowedDeps {
  const present = new Set(view.nodes.map(n => n.id))
  const rules = rulesOf(index)
  const items: AllowedEdge['rules'] = []
  if (rules.layers !== false)
    for (const m of index.modules.values()) if (m.kind === 'layer') for (const to of m.mayDependOn ?? []) items.push({ kind: 'layer', at: m.id, to })
  for (const r of rules.modules ?? []) for (const to of r.mayDependOn ?? []) items.push({ kind: 'deps', at: r.module, to })
  for (const s of sketch) for (const to of s.mayDependOn) items.push({ kind: 'sketch', at: s.layer, to })
  const pairs = new Map<string, AllowedEdge>()
  for (const it of items) {
    if (!index.modules.has(it.at) || !index.modules.has(it.to)) continue
    const a = nodeOf(index, view, present, it.at)
    const b = nodeOf(index, view, present, it.to)
    if (!a || !b || a === b) continue
    const k = depKey(a, b)
    const e =
      pairs.get(k) ??
      pairs.set(k, { id: `allowed:${k}`, from: a, to: b, fromModule: moduleOfNode(view, a), toModule: moduleOfNode(view, b), rules: [] }).get(k)!
    if (!e.rules.some(x => x.kind === it.kind && x.at === it.at && x.to === it.to)) e.rules.push(it)
  }
  return { edges: [...pairs.values()], note: items.length ? ALLOWED_ONLY_NOTE : NO_ALLOWED_NOTE }
}

export function structureView(
  index: ModelIndex,
  view: LevelView,
  report: ReportPart | null,
  opts: LevelDepsOptions & { sketch?: readonly { layer: string; mayDependOn: readonly string[] }[] } = {},
): StructureView {
  if (report) return { facts: true, ...levelDeps(index, view, report, opts) }
  return { facts: false, reason: NO_FACTS_REASON, ...allowedDeps(index, view, opts.sketch) }
}

/** V12：本层同一对节点同方向的视图边里取关系类型声明顺序中的第一条（同 levelFacts 的 edgeByPair）；没有时为 undefined */
export function interactionEdgeBetween(view: LevelView, fromNode: string, toNode: string): string | undefined {
  return [...view.edges, ...(view.coreEdges ?? [])]
    .filter(e => e.from === fromNode && e.to === toNode)
    .sort((x, y) => RELATION_TYPES.indexOf(x.type) - RELATION_TYPES.indexOf(y.type))[0]?.id
}
