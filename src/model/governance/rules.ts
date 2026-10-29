/**
 * 架构规则的判定（U2–U6）：一条依赖违不违规、哪条规则、为什么；按种类、规则所在与两端模块合并为违规。
 */
import { moduleName } from '../names'
import { matchRef, normalizeRef, type SourceOwnership } from '../source'
import type { ModelIndex, ModuleRuleDef, RuleKind, RulesDef, StratumEntity } from '../types'
import { within } from './facts'
import { mayDependOnOf, stratumKey, stratumNames } from '../names'
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

const names = (index: ModelIndex, ids: readonly string[]) => namesOrNone(ids.map(id => moduleName(index, id)))
const namesOrNone = (list: readonly string[]) => (list.length ? list.join('、') : '无')

/**
 * U2（ADR-0052）：依赖 a → b 的层判定——取最近公共祖先 P 下两端所在的子模块；P 声明了分层时取它们的层 sa、sb。
 * 两端有一方是另一方的祖先、P 没有分层、或 sa 不约束时为 null；allowed 为 sa = sb 或 sb ∈ sa.mayDependOn。任意层级生效。
 */
export function layerJudgement(index: ModelIndex, a: string, b: string): { from: StratumEntity; to: StratumEntity; allowed: boolean } | null {
  const pa = index.pathOf.get(a) ?? []
  const pb = index.pathOf.get(b) ?? []
  let i = 0
  while (i < pa.length && i < pb.length && pa[i] === pb[i]) i++
  if (i >= pa.length || i >= pb.length) return null
  const sa = index.stratumOf.get(pa[i])
  const sb = index.stratumOf.get(pb[i])
  if (!sa || !sb) return null
  const may = mayDependOnOf(sa)
  if (!may) return null
  return { from: sa, to: sb, allowed: sa === sb || may.includes(sb.id) }
}

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

  // U2：层规则（ADR-0052：最近公共祖先声明了分层即生效，任意层级）
  const layer = rules.layers === false ? null : layerJudgement(index, dep.from, dep.to)
  if (layer) {
    constrained = true
    const { from: x, to: y } = layer
    if (!layer.allowed) hit('layer', stratumKey(index, x), dep.to, `「${x.name}」不可依赖「${y.name}」（可依赖：${namesOrNone(stratumNames(index, x.parent, mayDependOnOf(x) ?? []))}）`)
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
  /** 所在各级层的可依赖层（U2；层与可依赖的层都是全局键，stratumKey） */
  layers: { layer: string; mayDependOn: string[] }[]
  /** 祖先链（含自身）上的白名单（U3） */
  deps: { module: string; mayDependOn: string[]; reason?: string }[]
  /** 祖先链（含自身）上的访问面：外部访问它时须经由的文件（U4） */
  exposes: { module: string; exposes: string[]; entry: string | null; reason?: string }[]
}

export function rulesFor(index: ModelIndex, moduleId: string, entryOf: EntryOf): ModuleRules {
  const rules = rulesOf(index)
  const path = index.pathOf.get(moduleId) ?? []
  // ST：路径上每一级所在的层（父模块声明了分层且约束的），可依赖的层写成全局键
  const layers =
    rules.layers === false
      ? []
      : path.flatMap(id => {
          const s = index.stratumOf.get(id)
          const may = s && mayDependOnOf(s)
          return s && may ? [{ layer: stratumKey(index, s), mayDependOn: may.map(x => stratumKey(index, { parent: s.parent, id: x })) }] : []
        })
  const mine = (rules.modules ?? []).filter(r => path.includes(r.module))
  return {
    layers,
    deps: mine.filter(r => r.mayDependOn).map(r => ({ module: r.module, mayDependOn: r.mayDependOn!, ...(r.reason ? { reason: r.reason } : {}) })),
    exposes: mine
      .filter(r => r.exposes)
      .map(r => ({ module: r.module, exposes: r.exposes!, entry: entryOf(r.module), ...(r.reason ? { reason: r.reason } : {}) })),
  }
}
