/**
 * agent 查询（Q1、Q2）：定位文件、说明模块、写前判定。输出为可直接序列化的普通对象，命令行与 MCP 共用（Q6）。
 */
import { moduleName } from '../names'
import { moduleFiles, moduleInterfaces, type SourceOwnership } from '../source'
import type { ModelIndex, RuleKind } from '../types'
import { stronglyConnected, valueDeps } from './cycles'
import { coveringRelations, related } from './facts'
import { judge, rulesFor, type EntryOf } from './rules'
import type { GovernanceReport, RuleHit, Verdict } from './types'

export interface ModuleBrief {
  id: string
  name: string
  kind?: string
  status?: string
  /** 从顶层到它的路径与各级职责 */
  path: { id: string; name: string; responsibility?: string }[]
  responsibility?: string
  principle?: string
  entry: string | null
  interfaces: { id: string; name: string; signature?: string }[]
  /** 对它生效的规则（U2–U4），模块以「ID（名称）」给出 */
  rules: {
    layers: { layer: string; mayDependOn: string[] }[]
    deps: { module: string; mayDependOn: string[]; reason?: string }[]
    exposes: { module: string; exposes: string[]; entry: string | null; reason?: string }[]
  }
}

export interface ModuleDetail extends ModuleBrief {
  files: number
  relations: { out: RelationBrief[]; in: RelationBrief[] }
  violations: { out: ViolationBrief[]; in: ViolationBrief[] }
  undescribed: { out: string[]; in: string[] }
  cycles: string[][]
}

interface RelationBrief {
  id: string
  type: string
  other: string
  interface?: string
  confirmed?: string
}

interface ViolationBrief {
  key: string
  kind: RuleKind
  other: string
  reason: string
  status: string
  example: string
}

const label = (index: ModelIndex, id: string) => `${id}（${moduleName(index, id)}）`

export function moduleBrief(index: ModelIndex, entryOf: EntryOf, id: string): ModuleBrief | null {
  const m = index.modules.get(id)
  if (!m) return null
  const r = rulesFor(index, id, entryOf)
  return {
    id,
    name: m.name,
    ...(m.kind ? { kind: m.kind } : {}),
    ...(m.status ? { status: m.status } : {}),
    path: (index.pathOf.get(id) ?? []).slice(1).map(p => ({ id: p, name: moduleName(index, p), responsibility: index.modules.get(p)?.responsibility?.trim() })),
    responsibility: m.responsibility?.trim(),
    ...(m.principle ? { principle: m.principle.trim() } : {}),
    entry: entryOf(id),
    interfaces: moduleInterfaces(index, id).map(x => {
      const def = index.interfaces.get(x)
      return { id: x, name: def?.name ?? x, ...(def?.signature ? { signature: def.signature.trim() } : {}) }
    }),
    rules: {
      layers: r.layers.map(l => ({ layer: label(index, l.layer), mayDependOn: l.mayDependOn.map(x => label(index, x)) })),
      deps: r.deps.map(d => ({ ...d, module: label(index, d.module), mayDependOn: d.mayDependOn.map(x => label(index, x)) })),
      exposes: r.exposes.map(e => ({ ...e, module: label(index, e.module) })),
    },
  }
}

/** Q1：模块说明 */
export function describeModule(index: ModelIndex, own: SourceOwnership, report: GovernanceReport | null, entryOf: EntryOf, id: string): ModuleDetail | null {
  const brief = moduleBrief(index, entryOf, id)
  if (!brief) return null
  const inside = (x: string) => !!index.pathOf.get(x)?.includes(id)
  const rel = (rid: string, other: string): RelationBrief => {
    const r = index.relations.get(rid)!
    const c = report?.relations.get(rid)?.status
    return { id: rid, type: r.type, other, ...(r.interface ? { interface: r.interface } : {}), ...(c ? { confirmed: c } : {}) }
  }
  const relations = { out: [] as RelationBrief[], in: [] as RelationBrief[] }
  for (const r of index.relations.values()) {
    const f = index.modules.has(r.from) ? inside(r.from) : false
    const t = index.modules.has(r.to) ? inside(r.to) : false
    if (f && !t) relations.out.push(rel(r.id, r.to))
    else if (t && !f) relations.in.push(rel(r.id, r.from))
  }
  const vb = (v: GovernanceReport['violations'][number], other: string): ViolationBrief => ({
    key: v.key,
    kind: v.kind,
    other,
    reason: v.reason,
    status: v.status,
    example: `${v.files[0].from}:${v.files[0].line} → ${v.files[0].via}`,
  })
  const violations = { out: [] as ViolationBrief[], in: [] as ViolationBrief[] }
  const undescribed = { out: [] as string[], in: [] as string[] }
  for (const v of report?.violations ?? []) {
    if (inside(v.from) && !inside(v.to)) violations.out.push(vb(v, v.to))
    else if (inside(v.to) && !inside(v.from)) violations.in.push(vb(v, v.from))
  }
  for (const d of report?.undescribed ?? []) {
    if (inside(d.from) && !inside(d.to)) undescribed.out.push(d.to)
    else if (inside(d.to) && !inside(d.from)) undescribed.in.push(d.from)
  }
  return {
    ...brief,
    files: moduleFiles(index, own, id).length,
    relations,
    violations,
    undescribed: { out: [...new Set(undescribed.out)], in: [...new Set(undescribed.in)] },
    cycles: (report?.moduleCycles ?? []).filter(c => c.members.some(inside)).map(c => c.members),
  }
}

export type FileStatus = 'owned' | 'conflict' | 'unowned' | 'ignored' | 'missing'

/** Q1：定位文件 */
export function locateFile(
  index: ModelIndex,
  own: SourceOwnership,
  files: ReadonlySet<string>,
  report: GovernanceReport | null,
  entryOf: EntryOf,
  file: string,
): { file: string; status: FileStatus; owners: string[]; module: ModuleDetail | null } {
  const owners = own.owners.get(file) ?? []
  const status: FileStatus = !files.has(file)
    ? 'missing'
    : owners.length > 1
      ? 'conflict'
      : owners.length
        ? 'owned'
        : own.ignored.has(file)
          ? 'ignored'
          : 'unowned'
  return { file, status, owners, module: owners[0] ? describeModule(index, own, report, entryOf, owners[0]) : null }
}

/** 写前判定的一个目标 */
export interface CheckTarget {
  /** 目标文件（声明文件，K3）或模块 ID */
  to: string
  /** 经由文件（直接导入的文件） */
  via?: string
}

export interface CycleImpact {
  /** 加入后两端所在的模块环规模；不成环为 0 */
  after: number
  /** 加入前包含依赖方的模块环规模 */
  before: number
  createsOrGrows: boolean
}

export interface PairCheck {
  from: string
  to: string
  via?: string
  verdict: Verdict
  hits: (RuleHit & { to: string })[]
  cycle: CycleImpact
  /** 覆盖它的关系（K7）；为空表示新增依赖，描述需要补关系 */
  describedBy: string[]
}

export interface CheckResult {
  verdict: Verdict
  /** 不能判定的原因（如文件未归属） */
  notes: string[]
  checks: PairCheck[]
  /** 目标模块的语义：职责、访问面、接口签名（Q2） */
  targets: ModuleBrief[]
}

const severity: Record<Verdict, number> = { unconstrained: 0, allowed: 1, denied: 2 }

/** Q2：写前判定。from 为文件或模块 ID；targets 由调用方按 K2、K3 解析好 */
export function checkDependency(
  index: ModelIndex,
  own: SourceOwnership,
  report: GovernanceReport | null,
  entryOf: EntryOf,
  from: string,
  targets: readonly CheckTarget[],
): CheckResult {
  const notes: string[] = []
  const ownersOf = (x: string, what: string): string[] => {
    if (index.modules.has(x)) return [x]
    const o = own.owners.get(x)
    if (o?.length) return o
    notes.push(`${what}「${x}」不是模块，也没有归属任何模块，无法判定`)
    return []
  }
  const froms = ownersOf(from, '依赖方')
  const graph = valueDeps(report?.moduleDeps.values() ?? []).map(d => [d.from, d.to] as [string, string])
  const sizeWith = (edges: [string, string][], a: string, b: string) => stronglyConnected(edges).find(c => c.includes(a) && c.includes(b))?.length ?? 0
  const sizeOf = (a: string) => stronglyConnected(graph).find(c => c.includes(a))?.length ?? 0

  const checks: PairCheck[] = []
  for (const t of targets) {
    const tos = ownersOf(t.to, '目标')
    const viaOwners = t.via ? (own.owners.get(t.via) ?? []) : []
    for (const a of froms)
      for (const b of tos) {
        if (related(index, a, b)) {
          notes.push(`${label(index, a)} → ${label(index, b)} 在同一模块内或为祖先后代，不受规则约束`)
          checks.push({ from: a, to: b, ...(t.via ? { via: t.via } : {}), verdict: 'unconstrained', hits: [], cycle: { after: 0, before: 0, createsOrGrows: false }, describedBy: [] })
          continue
        }
        const j = judge(index, entryOf, { from: a, to: b, ...(t.via ? { via: t.via, viaOwners } : {}) })
        const verdict: Verdict = j.hits.some(h => !h.allowed) ? 'denied' : j.constrained ? 'allowed' : 'unconstrained'
        const before = sizeOf(a)
        const after = sizeWith([...graph, [a, b]], a, b)
        checks.push({
          from: a,
          to: b,
          ...(t.via ? { via: t.via } : {}),
          verdict,
          hits: j.hits,
          cycle: { after, before, createsOrGrows: after > 0 && after > before },
          describedBy: coveringRelations(index, a, b),
        })
      }
  }
  const verdict = checks.reduce<Verdict>((v, c) => (severity[c.verdict] > severity[v] ? c.verdict : v), 'unconstrained')
  const targetIds = [...new Set(checks.map(c => c.to))]
  return { verdict, notes, checks, targets: targetIds.map(id => moduleBrief(index, entryOf, id)).filter((b): b is ModuleBrief => !!b) }
}
