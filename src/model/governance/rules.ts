/**
 * 架构规则的判定（U2–U6）：一条依赖违不违规、哪条规则、为什么；按种类、规则所在与两端模块合并为违规。
 */
import { moduleName } from '../indexer'
import { matchRef, normalizeRef, type SourceOwnership } from '../source'
import type { ModelIndex, ModuleRuleDef, RuleKind, RulesDef } from '../types'
import { within } from './facts'
import type { FileDep, ModuleDep, RuleHit, Violation } from './types'

/** 模块入口文件（G10）；由调用方按源码清单给出 */
export type EntryOf = (moduleId: string) => string | null

/** 待判定的一条依赖：依赖方模块、被依赖方模块，以及经由文件与它的归属（U4） */
export interface DepProbe {
  from: string
  to: string
  via?: string
  viaOwners?: readonly string[]
}

/** 一次判定：命中的规则（含已豁免的），以及有没有任何规则约束这条依赖 */
export interface Judgement {
  hits: (RuleHit & { to: string })[]
  constrained: boolean
}

const EMPTY_RULES: RulesDef = {}

export const rulesOf = (index: ModelIndex): RulesDef => index.model.rules ?? EMPTY_RULES

/** U2：两端在最近公共祖先下分叉处的两个模块（同一父模块的两个子模块）；有一端是另一端的祖先时为 null */
function divergence(index: ModelIndex, a: string, b: string): [string, string] | null {
  const pa = index.pathOf.get(a) ?? []
  const pb = index.pathOf.get(b) ?? []
  let i = 0
  while (i < pa.length && i < pb.length && pa[i] === pb[i]) i++
  return i < pa.length && i < pb.length ? [pa[i], pb[i]] : null
}

const names = (index: ModelIndex, ids: readonly string[]) => (ids.length ? ids.map(id => moduleName(index, id)).join('、') : '无')

/** U4：经由文件是否在访问面内；`entry` 为模块入口 */
export function exposesMatch(patterns: readonly string[], file: string, entry: string | null): boolean {
  return patterns.some(p => (p === 'entry' ? entry === file : matchRef(normalizeRef(p), file)))
}

/** U5：命中例外的理由 */
function allowedBy(index: ModelIndex, rules: RulesDef, kind: RuleKind, from: string, to: string): string | undefined {
  return rules.allow?.find(a => (!a.rule || a.rule === kind) && within(index, from, a.from) && within(index, to, a.to))?.reason
}

/** U2–U5：一条依赖对全部规则的判定 */
export function judge(index: ModelIndex, entryOf: EntryOf, dep: DepProbe): Judgement {
  const rules = rulesOf(index)
  const hits: Judgement['hits'] = []
  let constrained = false
  const hit = (kind: RuleKind, at: string, to: string, reason: string) => {
    const allowed = allowedBy(index, rules, kind, dep.from, to)
    hits.push({ kind, at, to, reason, ...(allowed ? { allowed } : {}) })
  }

  // U2：层规则
  const pair = rules.layers === false ? null : divergence(index, dep.from, dep.to)
  if (pair) {
    const [x, y] = pair.map(id => index.modules.get(id))
    if (x?.kind === 'layer' && y?.kind === 'layer' && x.mayDependOn) {
      constrained = true
      if (!x.mayDependOn.includes(y.id)) hit('layer', x.id, dep.to, `「${x.name}」不可依赖「${y.name}」（可依赖：${names(index, x.mayDependOn)}）`)
    }
  }

  for (const m of rules.modules ?? []) {
    const inside = within(index, dep.from, m.module)
    // U3：依赖白名单
    if (m.mayDependOn && inside && !within(index, dep.to, m.module)) {
      constrained = true
      if (!m.mayDependOn.some(x => within(index, dep.to, x)))
        hit('deps', m.module, dep.to, `「${moduleName(index, m.module)}」之外只许依赖：${names(index, m.mayDependOn)}`)
    }
    // U4：访问面——经由文件在 M 子树内、依赖方在 M 子树外
    if (m.exposes && !inside && dep.via) {
      const target = dep.viaOwners?.find(o => within(index, o, m.module))
      if (target) {
        constrained = true
        if (!exposesMatch(m.exposes, dep.via, entryOf(m.module)))
          hit('exposes', m.module, target, `「${moduleName(index, m.module)}」只许经由 ${exposesText(m, entryOf)} 访问，这里经由 ${dep.via}`)
      }
    }
  }
  return { hits, constrained }
}

export const exposesText = (m: ModuleRuleDef, entryOf: EntryOf) =>
  (m.exposes ?? []).map(p => (p === 'entry' ? `入口 ${entryOf(m.module) ?? '（无入口）'}` : p)).join('、')

export const violationKey = (kind: RuleKind, at: string, from: string, to: string) => `${kind}:${at}:${from}->${to}`

/** U6：对每条模块依赖的每条文件证据判定，合并为违规；status 先记 open / allowed，基线状态由 gate 填 */
export function evaluateRules(index: ModelIndex, own: SourceOwnership, moduleDeps: Iterable<ModuleDep>, entryOf: EntryOf): Violation[] {
  const out = new Map<string, Violation>()
  const seen = new Map<string, Set<string>>()
  const add = (h: RuleHit & { to: string }, from: string, f: FileDep) => {
    const key = violationKey(h.kind, h.at, from, h.to)
    let v = out.get(key)
    if (!v) {
      v = { key, kind: h.kind, at: h.at, from, to: h.to, reason: h.reason, files: [], status: h.allowed ? 'allowed' : 'open', ...(h.allowed ? { allowReason: h.allowed } : {}) }
      out.set(key, v)
      seen.set(key, new Set())
    }
    const id = `${f.from}:${f.line}->${f.to}`
    if (!seen.get(key)!.has(id)) {
      seen.get(key)!.add(id)
      v.files.push(f)
    }
  }
  const hasExposes = !!index.model.rules?.modules?.some(m => m.exposes)
  for (const d of moduleDeps) {
    // 层规则与白名单只看两端模块，判定一次；访问面看每条证据的经由文件
    const base = judge(index, entryOf, { from: d.from, to: d.to }).hits
    for (const f of d.files) {
      for (const h of base) add(h, d.from, f)
      if (!hasExposes) continue
      const viaOwners = own.owners.get(f.via) ?? []
      for (const h of judge(index, entryOf, { from: d.from, to: d.to, via: f.via, viaOwners }).hits) if (h.kind === 'exposes') add(h, d.from, f)
    }
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** Q1：对一个模块生效的规则 */
export interface ModuleRules {
  /** 所在各级层的可依赖层（U2） */
  layers: { layer: string; mayDependOn: string[] }[]
  /** 祖先链（含自身）上的白名单（U3） */
  deps: { module: string; mayDependOn: string[]; reason?: string }[]
  /** 祖先链（含自身）上的访问面：外部访问它时须经由的文件（U4） */
  exposes: { module: string; exposes: string[]; entry: string | null; reason?: string }[]
}

export function rulesFor(index: ModelIndex, moduleId: string, entryOf: EntryOf): ModuleRules {
  const rules = rulesOf(index)
  const path = index.pathOf.get(moduleId) ?? []
  const layers =
    rules.layers === false
      ? []
      : path
          .map(id => index.modules.get(id))
          .filter(m => m?.kind === 'layer' && m.mayDependOn)
          .map(m => ({ layer: m!.id, mayDependOn: m!.mayDependOn! }))
  const mine = (rules.modules ?? []).filter(r => path.includes(r.module))
  return {
    layers,
    deps: mine.filter(r => r.mayDependOn).map(r => ({ module: r.module, mayDependOn: r.mayDependOn!, ...(r.reason ? { reason: r.reason } : {}) })),
    exposes: mine
      .filter(r => r.exposes)
      .map(r => ({ module: r.module, exposes: r.exposes!, entry: entryOf(r.module), ...(r.reason ? { reason: r.reason } : {}) })),
  }
}
