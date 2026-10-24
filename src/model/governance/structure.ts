/**
 * 结构视图（ADR-0031）：依赖事实在一个层次上的投影与指标——结构边的种类与档（K14）、交互覆盖数（K17）、规则叠加（U15）、
 * 影响面（K15）、扇入扇出与不稳定度（K16）、稳定依赖方向（U17）、没有代码事实时的允许依赖图（U16）。
 * 只读代码事实与规则，不读关系来定边（原则 SP2）；投影与 K9、Y4 共用 nodeOf（mapEndpoint）。
 */
import { moduleName } from '../names'
import { moduleFiles, type SourceOwnership } from '../source'
import { RELATION_TYPES, type LevelView, type ModelIndex, type RuleKind } from '../types'
import { valueDeps } from './cycles'
import { contractNames, coveringRelations, depKey, implementsInto, plainInteraction, within } from './facts'
import { nodeOf } from './level'
import { rulesOf } from './rules'
import { sharedHostOf } from './roles'
import { ASSEMBLY_KINDS, type FileDep, type GovernanceReport, type ModuleDep, type Violation, type ViolationStatus } from './types'

// ── K14：结构边的种类与档 ──

/** K14：结构边的种类——依赖、组装（K13）、子类（K12）、端口实现（K5c） */
export type StructureKind = 'dependency' | 'assembly' | 'subclass' | 'implements'
export const STRUCTURE_KINDS: readonly StructureKind[] = ['dependency', 'assembly', 'subclass', 'implements']

/** K14：依赖边的档——交互使用 > 值使用（只有纯值读取）> 只引类型 */
export type DepTier = 'invokes' | 'value' | 'type'
export const DEP_TIERS: readonly DepTier[] = ['invokes', 'value', 'type']

/** K14：一条文件依赖归入的结构边种类（可多种）；组装、子类、端口实现之外的使用（或什么都不是）归「依赖」 */
export function fileKinds(f: FileDep, ports: ReadonlySet<string>): StructureKind[] {
  const out: StructureKind[] = []
  if (f.invokeKinds?.some(k => ASSEMBLY_KINDS.includes(k))) out.push('assembly')
  const hs = f.inherits ?? []
  // K12 同 heritageFacts：extends 的是类（不是接口、类型别名、命名空间，也不是端口）
  if (hs.some(h => h.clause === 'extends' && h.name !== '*' && !ports.has(h.name) && h.decl !== 'interface' && h.decl !== 'type')) out.push('subclass')
  // K5c：继承子句指向被依赖方声明的端口（接口）
  if (hs.some(h => ports.has(h.name))) out.push('implements')
  if (!out.length || plainInteraction(f)) out.push('dependency')
  return out
}

/** K14：一组文件依赖的档——任一条有交互使用为 invokes，否则有值使用（纯值读取）为 value，其余为 type */
export const tierOf = (files: readonly FileDep[]): DepTier =>
  files.some(f => f.invokes) ? 'invokes' : files.some(f => f.uses || f.kind === 'value') ? 'value' : 'type'

// ── U15：规则叠加 ──

/** U15：结构边的规则判定——违规（新增 / 无基线 / 已知 / 已豁免）、允许、无约束 */
export type EdgeVerdict = 'violation' | 'allowed' | 'unconstrained'

/** U15：约束一条依赖的一条规则：种类、规则所在与可读的说明 */
export interface RuleBasis {
  kind: RuleKind
  at: string
  text: string
}

export interface EdgeRuling {
  verdict: EdgeVerdict
  /** 违规时投影到这条边的违规里最严的状态：new > open（无基线）> known > allowed（已豁免） */
  status?: ViolationStatus
  violations: Violation[]
  /** 约束这条边、且投影到它的模块依赖都通过了的规则（允许它的规则，U15 悬停与面板） */
  allowedBy: RuleBasis[]
}

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

/** K16：不稳定度三档（阈值：议）——稳定 I < 1/3、居中、易变 I > 2/3；Ca + Ce = 0 时无定义 */
export type StabilityBand = 'stable' | 'balanced' | 'unstable'
export const STABILITY_BANDS: readonly [number, number] = [1 / 3, 2 / 3]
export const stabilityBand = (i: number | null): StabilityBand | null =>
  i === null ? null : i < STABILITY_BANDS[0] ? 'stable' : i > STABILITY_BANDS[1] ? 'unstable' : 'balanced'

export interface ModuleMetrics {
  module: string
  /** 扇入：子树外、依赖子树内任一模块的不同模块数 */
  ca: number
  /** 扇出：子树内的模块所依赖的、子树外的不同模块数 */
  ce: number
  /** I = Ce ÷ (Ca + Ce)；Ca + Ce = 0 时为 null（显示「—」） */
  instability: number | null
  band: StabilityBand | null
}

export interface MetricsOptions {
  /** 只看值依赖：去掉只引类型的文件依赖重算（同 Y1） */
  valuesOnly?: boolean
}

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
  return out
}

/** K16：面板「结构」一节——模块的 Ca / Ce / I，贡献最多的 5 个依赖方 / 被依赖方（按文件依赖条数），本层节点数 */
export interface ModuleMetricsDetail extends ModuleMetrics {
  /** 依赖它的模块，按文件依赖条数降序，最多 5 个 */
  topDependents: { module: string; files: number }[]
  /** 它依赖的模块，同上 */
  topDependencies: { module: string; files: number }[]
  /** 投影到本层后不同节点的传入 / 传出数（不含它自己所在的节点）；没给视图时不给 */
  level?: { in: number; out: number }
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

/** K17：一条依赖边的交互覆盖——覆盖它的交互关系，另列由端口实现、子类、组装事实覆盖的模块依赖条数 */
export interface EdgeCoverage {
  relations: string[]
  implementers: number
  subclass: number
  assembly: number
}

/** 一条结构边：本层一对节点同方向、一种事实（L15） */
export interface StructureEdge {
  /** `<种类>:<依赖方节点>-><被依赖方节点>` */
  id: string
  kind: StructureKind
  from: string
  to: string
  /** 两端节点对应的模块 ID；选中落到 K10 的 `sel=d:<fromModule>-><toModule>` */
  fromModule: string
  toModule: string
  /** 依赖边的档（K14）；其余种类不给 */
  tier?: DepTier
  /** 归入这条边的文件依赖条数（悬停与面板） */
  files: number
  /** 聚合的模块依赖键（K4）；线宽 = 条数（L18） */
  deps: string[]
  /** K17：依赖边的交互覆盖；其余种类不给 */
  coverage?: EdgeCoverage
  /** K17：K7 的未解释的交互（覆盖 0、交互使用、没有事实覆盖） */
  unexplained?: true
  /** U15：这对节点之间的规则判定（同一对节点的各种类共用） */
  ruling: EdgeRuling
  /** U17：违背稳定依赖方向时两端的 I（只给依赖边） */
  againstStability?: { from: number; to: number }
}

export interface LevelDeps {
  edges: StructureEdge[]
  /** K14：只引类型的依赖边条数（缺省收起时画布角计数，L15） */
  typeOnly: number
}

export interface LevelDepsOptions {
  /** U17 的阈值，缺省 STABLE_DIRECTION_THRESHOLD */
  threshold?: number
  /** 已算好的指标（K16），省得重算 */
  metrics?: ReadonlyMap<string, ModuleMetrics>
}

type ReportPart = Pick<GovernanceReport, 'moduleDeps' | 'violations' | 'undescribed' | 'implementers' | 'subclasses' | 'assembly'>

const moduleOfNode = (view: LevelView, nodeId: string) => view.nodes.find(n => n.id === nodeId)?.moduleId ?? nodeId

/**
 * K14、K17、U15、U17：模块依赖（K4，全部种类）按 mapEndpoint 投影到本层，两端为本层两个不同节点的成为结构边；
 * 一对节点同方向按事实种类各一条（依赖、组装、子类、端口实现），依赖边带档、覆盖与未解释标记；规则判定按这对节点。
 * 边的顺序：按依赖方、被依赖方节点的视图顺序，同一对按 STRUCTURE_KINDS。
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
    byKind: Map<StructureKind, { files: FileDep[]; deps: Set<string> }>
    violations: Violation[]
  }
  const pairs = new Map<string, Pair>()
  const portsOf = new Map<string, Set<string>>()
  for (const d of report.moduleDeps.values()) {
    const p = project(d)
    if (!p) continue
    const k = depKey(p[0], p[1])
    const pair = pairs.get(k) ?? pairs.set(k, { from: p[0], to: p[1], deps: [], byKind: new Map(), violations: [] }).get(k)!
    pair.deps.push(d)
    const ports = portsOf.get(d.to) ?? portsOf.set(d.to, contractNames(index, d.to)).get(d.to)!
    for (const f of d.files)
      for (const kind of fileKinds(f, ports)) {
        const slot = pair.byKind.get(kind) ?? pair.byKind.set(kind, { files: [], deps: new Set() }).get(kind)!
        slot.files.push(f)
        slot.deps.add(d.key)
      }
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

  const edges: StructureEdge[] = []
  let typeOnly = 0
  for (const p of [...pairs.values()].sort(byOrder)) {
    const fromModule = moduleOfNode(view, p.from)
    const toModule = moduleOfNode(view, p.to)
    const rul = ruling(index, p.deps, p.violations)
    for (const kind of STRUCTURE_KINDS) {
      const slot = p.byKind.get(kind)
      if (!slot) continue
      const keys = [...slot.deps]
      const edge: StructureEdge = {
        id: `${kind}:${depKey(p.from, p.to)}`,
        kind,
        from: p.from,
        to: p.to,
        fromModule,
        toModule,
        files: slot.files.length,
        deps: keys,
        ruling: rul,
      }
      if (kind === 'dependency') {
        edge.tier = tierOf(slot.files)
        if (edge.tier === 'type') typeOnly++
        const ds = p.deps.filter(d => slot.deps.has(d.key))
        edge.coverage = {
          relations: [...new Set(ds.flatMap(d => coveringRelations(index, d.from, d.to)))].sort(),
          implementers: ds.filter(d => implementsInto(index, report.implementers, d.from, d.to)).length,
          subclass: ds.filter(d => subclass.has(d.key)).length,
          assembly: ds.filter(d => assembly.has(d.key)).length,
        }
        if (ds.some(d => undescribed.has(d.key))) edge.unexplained = true
        const against = againstStability(index, metrics, fromModule, toModule, opts.threshold)
        if (against) edge.againstStability = against
      }
      edges.push(edge)
    }
  }
  return { edges, typeOnly }
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

export interface ImpactEntry {
  module: string
  /** 到 M 子树的最短距离（1 = 直接依赖） */
  distance: number
  /** 在模块环中（Y1，只按值依赖） */
  inCycle: boolean
}

export interface Impact {
  module: string
  valuesOnly: boolean
  /** 传入闭包：改它会牵动谁（能到达 M 子树的模块） */
  incoming: ImpactEntry[]
  /** 传出闭包：它要谁才能工作（从 M 子树出发能到达的模块） */
  outgoing: ImpactEntry[]
  /** M 自己（子树内某模块）在模块环中 */
  inCycle: boolean
  /** 闭包内模块归属的源码文件数（给了归属时） */
  files?: { incoming: number; outgoing: number }
}

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
  for (const d of deps) {
    ;(fwd.get(d.from) ?? fwd.set(d.from, []).get(d.from)!).push(d.to)
    ;(back.get(d.to) ?? back.set(d.to, []).get(d.to)!).push(d.from)
  }
  const cyclic = new Set(report.moduleCycles.flatMap(c => c.members))
  const inside = (m: string) => within(index, m, id)
  const seeds = [...new Set(deps.flatMap(d => [d.from, d.to]))].filter(inside)
  const walk = (adj: Map<string, string[]>): ImpactEntry[] => {
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
    return [...dist]
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      .map(([module, distance]) => ({ module, distance, inCycle: cyclic.has(module) }))
  }
  const incoming = walk(back)
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

/** K15：影响面投影到本层——节点 ID → 方向与最短距离（两个方向都在时为 both，距离取小）；M 所在的节点不在其中 */
export function levelImpact(
  index: ModelIndex,
  view: LevelView,
  impact: Impact,
): Map<string, { direction: 'in' | 'out' | 'both'; distance: number; inCycle: boolean }> {
  const present = new Set(view.nodes.map(n => n.id))
  const self = nodeOf(index, view, present, impact.module)
  const out = new Map<string, { direction: 'in' | 'out' | 'both'; distance: number; inCycle: boolean }>()
  const put = (list: ImpactEntry[], dir: 'in' | 'out') => {
    for (const e of list) {
      const n = nodeOf(index, view, present, e.module)
      if (!n || n === self) continue
      const hit = out.get(n)
      if (!hit) out.set(n, { direction: dir, distance: e.distance, inCycle: e.inCycle })
      else
        out.set(n, {
          direction: hit.direction === dir ? dir : 'both',
          distance: Math.min(hit.distance, e.distance),
          inCycle: hit.inCycle || e.inCycle,
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

/** U16：一条允许边——本层一对节点之间、由 mayDependOn 投影来 */
export interface AllowedEdge {
  /** `allowed:<依赖方节点>-><被依赖方节点>` */
  id: string
  from: string
  to: string
  fromModule: string
  toModule: string
  /** 投影到它的规则：层规则（at 为层）、白名单（at 为写规则的模块）、草图（at 为草图里的层） */
  rules: { kind: 'layer' | 'deps' | 'sketch'; at: string; to: string }[]
}

export interface AllowedDeps {
  edges: AllowedEdge[]
  /** 画布角的说明（ALLOWED_ONLY_NOTE；一条 mayDependOn 都没有时为 NO_ALLOWED_NOTE） */
  note: string
}

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

/** 结构视图在本层：有代码事实时为结构边，否则为允许依赖图（U16） */
export type StructureView = ({ facts: true } & LevelDeps) | ({ facts: false; reason: string } & AllowedDeps)

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
