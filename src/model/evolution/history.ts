/**
 * 演化事实（J1–J4、J6、J8，docs/architecture/evolution.md §3）：把接入层读到的 git 历史按源码归属提升为模块的修改热度、缺陷热度与时间耦合。
 * 关于被描述系统的知识：页面、命令行与 MCP 共用同一份结果（Q6）。纯函数，不依赖 Vue 与文件系统。
 */
import { within, type GovernanceReport } from '../governance'
import { moduleFiles, moduleLines, type SourceOwnership } from '../source'
import type { ModelIndex, SystemDef } from '../types'
import {
  DEFAULT_COUPLING,
  DEFAULT_HISTORY_DAYS,
  type Coupling,
  type CouplingThreshold,
  heatCount,
  heatValue,
  type EvolutionStats,
  type HeatKind,
  type HistoryOptions,
  type ModuleHistory,
  type OkHistory,
} from './types'

/** J1：缺省的缺陷修复判定——标题以 fix / hotfix / bugfix 开头（不分大小写），或含「修复」 */
const FIX_DEFAULT = /^(fix|hotfix|bugfix)\b/i

/** J1：标题是否为缺陷修复；extra 为项目补充的正则（不分大小写），坏正则忽略 */
export function isFixSubject(subject: string, extra: readonly string[] = []): boolean {
  if (FIX_DEFAULT.test(subject) || subject.includes('修复')) return true
  return extra.some(p => {
    try {
      return new RegExp(p, 'i').test(subject)
    } catch {
      return false
    }
  })
}

/** J1、J4：`system.source.history` 规整为选项，缺省 180 天、同提交 ≥ 5 且 ≥ 30% */
export function historyOptions(system: Pick<SystemDef, 'source'> | undefined): HistoryOptions {
  const h = system?.source?.history
  const days = h?.days !== undefined && h.days > 0 ? Math.floor(h.days) : DEFAULT_HISTORY_DAYS
  const coupling: CouplingThreshold = {
    min: h?.coupling?.min !== undefined && h.coupling.min > 0 ? h.coupling.min : DEFAULT_COUPLING.min,
    ratio: h?.coupling?.ratio !== undefined && h.coupling.ratio >= 0 && h.coupling.ratio <= 1 ? h.coupling.ratio : DEFAULT_COUPLING.ratio,
  }
  return { days, fixPatterns: [...(h?.fixPatterns ?? [])], coupling }
}

/** J3：热度 = 次数 × √当前行数；没有统计行数时按 1 */
export const heatOf = (count: number, lines: number): number => (count === 0 ? 0 : count * Math.sqrt(Math.max(1, lines)))

/** 耦合对的稳定键：两端模块 ID 按字典序（J7） */
export const coupleId = (a: string, b: string): string => (a < b ? `${a}~${b}` : `${b}~${a}`)
export const coupleEnds = (id: string): [string, string] | null => {
  const i = id.indexOf('~')
  return i > 0 && i < id.length - 1 ? [id.slice(0, i), id.slice(i + 1)] : null
}

/**
 * J2：每条提交的文件按归属取模块（未归属、已忽略、冲突文件不计，与 K4 同口径），加上祖先链去重；
 * 返回每条提交触及的模块集（含祖先），与每个模块触及的提交（新的在前）。
 */
export function touchedModules(index: ModelIndex, own: SourceOwnership, history: OkHistory): { perCommit: Set<string>[]; perModule: Map<string, string[]> } {
  const perCommit: Set<string>[] = []
  const perModule = new Map<string, string[]>()
  const conflicts = new Set(own.conflicts)
  for (const c of history.commits) {
    const touched = new Set<string>()
    for (const f of c.files) {
      if (conflicts.has(f.path) || own.ignored.has(f.path)) continue
      const owners = own.owners.get(f.path)
      if (!owners || owners.length !== 1) continue
      for (const id of index.pathOf.get(owners[0]) ?? []) if (id !== index.rootId) touched.add(id)
    }
    perCommit.push(touched)
    for (const id of touched) {
      const list = perModule.get(id) ?? []
      list.push(c.hash)
      perModule.set(id, list)
    }
  }
  return { perCommit, perModule }
}

/** J2、J3：每个模块的修改次数、缺陷次数、当前行数与热度（没有触及的模块也列出，次数为 0） */
export function moduleHistory(index: ModelIndex, own: SourceOwnership, history: OkHistory, lines: Readonly<Record<string, number>>): Map<string, ModuleHistory> {
  const { perModule } = touchedModules(index, own, history)
  const fixSet = new Set(history.commits.filter(c => c.fix).map(c => c.hash))
  const out = new Map<string, ModuleHistory>()
  for (const m of index.model.modules) {
    const commits = perModule.get(m.id) ?? []
    const fixes = commits.filter(h => fixSet.has(h)).length
    const files = moduleFiles(index, own, m.id)
    const ln = moduleLines(files, lines, Number.MAX_SAFE_INTEGER).lines
    out.set(m.id, {
      id: m.id,
      direct: (own.direct.get(m.id)?.length ?? 0) > 0,
      changes: commits.length,
      fixes,
      lines: ln,
      heat: heatOf(commits.length, ln),
      fixHeat: heatOf(fixes, ln),
      commits,
    })
  }
  return out
}

/** 两端子树之间有没有模块依赖（任一方向，K4） */
function hasDependency(index: ModelIndex, report: GovernanceReport | null | undefined, a: string, b: string): boolean {
  if (!report) return false
  for (const d of report.moduleDeps.values()) {
    if ((within(index, d.from, a) && within(index, d.to, b)) || (within(index, d.from, b) && within(index, d.to, a))) return true
  }
  return false
}

/** 两端子树之间有没有描述关系（任一方向，类型不限） */
function hasRelation(index: ModelIndex, a: string, b: string): boolean {
  for (const r of index.model.relations) {
    if (!index.modules.has(r.from) || !index.modules.has(r.to)) continue
    if ((within(index, r.from, a) && within(index, r.to, b)) || (within(index, r.from, b) && within(index, r.to, a))) return true
  }
  return false
}

/**
 * J4：时间耦合——每条提交触及的模块（含祖先）两两配对，去掉祖先与后代的对；同提交次数 ≥ min 且占两端各自修改次数 ≥ ratio；
 * 标注两端子树之间有没有模块依赖与描述关系。按次数降序、同值按 ID。
 */
export function couplings(
  index: ModelIndex,
  own: SourceOwnership,
  history: OkHistory,
  modules: ReadonlyMap<string, ModuleHistory>,
  report?: GovernanceReport | null,
  threshold: CouplingThreshold = DEFAULT_COUPLING,
): Coupling[] {
  const { perCommit } = touchedModules(index, own, history)
  const shared = new Map<string, string[]>()
  perCommit.forEach((touched, i) => {
    const ids = [...touched].sort()
    for (let x = 0; x < ids.length; x++)
      for (let y = x + 1; y < ids.length; y++) {
        if (within(index, ids[x], ids[y]) || within(index, ids[y], ids[x])) continue
        const key = coupleId(ids[x], ids[y])
        const list = shared.get(key) ?? []
        list.push(history.commits[i].hash)
        shared.set(key, list)
      }
  })
  const out: Coupling[] = []
  for (const [id, commits] of shared) {
    if (commits.length < threshold.min) continue
    const [a, b] = coupleEnds(id)!
    const ca = modules.get(a)?.changes ?? 0
    const cb = modules.get(b)?.changes ?? 0
    const ratioA = ca ? commits.length / ca : 0
    const ratioB = cb ? commits.length / cb : 0
    if (ratioA < threshold.ratio || ratioB < threshold.ratio) continue
    out.push({ id, a, b, shared: commits.length, ratioA, ratioB, dependency: hasDependency(index, report, a, b), relation: hasRelation(index, a, b), commits })
  }
  return out.sort((x, y) => y.shared - x.shared || x.id.localeCompare(y.id))
}

/**
 * J4：最具体的耦合对——若另一对的两端分别落在这对两端的子树内（至少一端更深），这对是同一现象在上级的并集，清单不列。
 * 本层投影仍用全部对（投到本层时合并）。
 */
export function specificCouplings(index: ModelIndex, list: readonly Coupling[]): Set<string> {
  const out = new Set<string>()
  for (const c of list) {
    const covered = list.some(
      d => d !== c && ((within(index, d.a, c.a) && within(index, d.b, c.b)) || (within(index, d.a, c.b) && within(index, d.b, c.a))),
    )
    if (!covered) out.add(c.id)
  }
  return out
}

/** J1–J4：组合统计 */
export function evolutionStats(
  index: ModelIndex,
  own: SourceOwnership,
  history: OkHistory,
  lines: Readonly<Record<string, number>>,
  report?: GovernanceReport | null,
  threshold?: CouplingThreshold,
): EvolutionStats {
  const modules = moduleHistory(index, own, history, lines)
  const { perCommit } = touchedModules(index, own, history)
  const counted = history.commits.filter((_, i) => perCommit[i].size > 0)
  const pairs = couplings(index, own, history, modules, report, threshold)
  return {
    days: history.days,
    since: history.since,
    commits: counted.length,
    fixes: counted.filter(c => c.fix).length,
    modules,
    couplings: pairs,
    specific: specificCouplings(index, pairs),
  }
}

/** J8：热度前 N——只列有直接归属文件的模块，按热度降序、同值按次数再按 ID */
export function hotspots(stats: EvolutionStats, kind: HeatKind, limit = 10): ModuleHistory[] {
  return [...stats.modules.values()]
    .filter(m => m.direct && heatValue(m, kind) > 0)
    .sort((a, b) => heatValue(b, kind) - heatValue(a, kind) || heatCount(b, kind) - heatCount(a, kind) || a.id.localeCompare(b.id))
    .slice(0, limit)
}

/** J4：清单用的耦合对——只列最具体的 */
export const listedCouplings = (stats: EvolutionStats): Coupling[] => stats.couplings.filter(c => stats.specific.has(c.id))

/** J6：无依赖且无描述关系的耦合对（代码事实看不见的耦合），只列最具体的，按次数降序 */
export const isolatedCouplings = (stats: EvolutionStats): Coupling[] => listedCouplings(stats).filter(c => !c.dependency && !c.relation)

/** 一个模块参与的耦合对（任一端，只列最具体的），按次数降序 */
export const couplingsOf = (stats: EvolutionStats, id: string): Coupling[] => listedCouplings(stats).filter(c => c.a === id || c.b === id)

/** 两个模块之间的耦合（J7：关系与聚合边面板的「同提交 ×N」） */
export const couplingBetween = (stats: EvolutionStats, a: string, b: string): Coupling | undefined => stats.couplings.find(c => c.id === coupleId(a, b))
