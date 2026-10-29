/**
 * 声明的分层的校验与查询（ADR-0052，ST-3–ST-5、ST-2）：层由人声明（原则），代码事实校验声明（证据）。
 * - ST-3 稳定性单调：各层的不稳定度 I（只数同一父模块下兄弟之间的依赖）沿可依赖方向应递减，逆序超过 0.15 给 info（互不可依赖的并列层不比）；
 * - ST-4 单成员层没写 singular：info；
 * - ST-5 底层（mayDependOn: []）的成员只引类型的向上 import：info（U2 的口径不计只引类型的依赖时，底层的「不依赖任何层」会失真）。
 * 迁移来的旧层（M26）不提示 ST-4（它们由 kind: layer 读来，等作者改写为 strata）。关于被描述系统的知识，lint:model、页面与 agent 接口共用。
 */
import { mayDependOnOf, moduleName, stratumKey } from '../names'
import type { Issue, ModelIndex, StratumEntity } from '../types'
import { within } from './facts'
import type { GovernanceReport, ModuleDep } from './types'

/** ST-3：逆序容差（议） */
export const STRATA_ORDER_TOLERANCE = 0.15

/** 一层的结构指标与向上的依赖 */
export interface StratumMetrics {
  /** 层的全局键 */
  key: string
  parent: string
  id: string
  name: string
  order?: number
  asks?: string
  admits?: string
  abstraction?: string
  /** 生效的可依赖的层（局部 ID）；迁移来的旧层没写时为 null（不约束） */
  mayDependOn: string[] | null
  singular?: string
  members: string[]
  /** 同一父模块下、本层之外的兄弟子树依赖进来的模块数 / 依赖出去的模块数（把整层看作一个子树；只数兄弟之间的依赖） */
  ca: number
  ce: number
  instability: number | null
  /** 本层成员依赖同一父模块下、不在 mayDependOn 里的层（U2 的层违规之外，含只引类型的） */
  upward: { from: string; to: string; layer: string; typeOnly: boolean; files: number }[]
}

const memberOf = (index: ModelIndex, members: readonly string[], id: string) => members.find(m => within(index, id, m))

/** ST：一个父模块的各层指标（按层序）；没有代码事实时 Ca / Ce 为 0、I 为 null */
export function strataMetrics(index: ModelIndex, parent: string, report?: Pick<GovernanceReport, 'moduleDeps'>): StratumMetrics[] {
  const list = index.strata.get(parent) ?? []
  const kids = index.childrenOf.get(parent) ?? []
  const deps: ModuleDep[] = report ? [...report.moduleDeps.values()] : []
  return list.map(s => {
    // 口径：只数这个父模块的子模块之间（同一组兄弟）的依赖——分层说的是兄弟之间谁依赖谁；外面的依赖（对其他层次、对父模块的入口）各层都有，不参与比较
    const inside = (id: string) => !!memberOf(index, s.members, id)
    const sibling = (id: string) => !!memberOf(index, kids, id)
    const ins = new Set<string>()
    const outs = new Set<string>()
    for (const d of deps) {
      if (!sibling(d.from) || !sibling(d.to)) continue
      if (inside(d.to) && !inside(d.from)) ins.add(d.from)
      if (inside(d.from) && !inside(d.to)) outs.add(d.to)
    }
    const may = mayDependOnOf(s)
    const upward: StratumMetrics['upward'] = []
    for (const d of deps) {
      const from = memberOf(index, s.members, d.from)
      if (!from) continue
      const target = list.find(t => t !== s && memberOf(index, t.members, d.to))
      if (!target || !may || may.includes(target.id)) continue
      upward.push({ from: d.from, to: d.to, layer: target.id, typeOnly: d.files.every(f => f.kind === 'type'), files: d.files.length })
    }
    const ca = ins.size
    const ce = outs.size
    return {
      key: stratumKey(index, s),
      parent,
      id: s.id,
      name: s.name,
      ...(s.order !== undefined ? { order: s.order } : {}),
      ...(s.asks ? { asks: s.asks } : {}),
      ...(s.admits ? { admits: s.admits } : {}),
      ...(s.abstraction ? { abstraction: s.abstraction } : {}),
      mayDependOn: may ? [...may] : null,
      ...(s.singular ? { singular: s.singular } : {}),
      members: [...s.members],
      ca,
      ce,
      instability: ca + ce ? ce / (ca + ce) : null,
      upward,
    }
  })
}

/** ST-3–ST-5 的一条发现，连同指向的对象（返工清单定位用） */
export interface StrataFinding {
  issue: Issue
  modules: string[]
}

/** ST-3–ST-5：全部声明了分层的父模块；report 缺省（没有代码事实）时只查 ST-4 */
export function strataFindings(index: ModelIndex, report?: Pick<GovernanceReport, 'moduleDeps'>): StrataFinding[] {
  const out: StrataFinding[] = []
  const name = (id: string) => moduleName(index, id)
  for (const [parent, list] of index.strata) {
    // ST-4：单成员层要写理由
    for (const s of list)
      if (s.members.length === 1 && !s.migrated && !s.singular?.trim())
        out.push({
          issue: {
            severity: 'info',
            code: 'stratum.singular',
            message: `「${name(parent)}」的层「${s.name}」只有一个成员「${name(s.members[0])}」：层名能否概括、是否该与相邻层合并？确属单独的写 singular 说明理由（ST-4）`,
            ...s.src,
          },
          modules: [parent, ...s.members],
        })
    if (!report) continue
    const metrics = strataMetrics(index, parent, report)
    // ST-3：上层可（经 mayDependOn 传递）依赖的下层应更稳定；下层比上层易变超过容差即逆序。互不可依赖的并列层不比（它们的上下只是摆放）
    const reach = reachable(list)
    for (let i = 0; i < metrics.length; i++)
      for (let j = i + 1; j < metrics.length; j++) {
        const up = metrics[i]
        const low = metrics[j]
        if (!reach.get(up.id)?.has(low.id)) continue
        if (up.instability === null || low.instability === null || low.instability - up.instability <= STRATA_ORDER_TOLERANCE) continue
        const top = topContributor(index, report, low)
        out.push({
          issue: {
            severity: 'info',
            code: 'stratum.instability-order',
            message: `「${name(parent)}」的层「${low.name}」（I ${low.instability.toFixed(2)}）在「${up.name}」（I ${up.instability.toFixed(2)}）之下却更易变：层序与稳定性不一致${top ? `，贡献最大的成员「${name(top)}」` : ''}（ST-3）`,
            ...stratumSrc(list, low.id),
          },
          modules: [parent, ...(top ? [top] : [])],
        })
      }
    // ST-5：底层只引类型的向上 import
    for (const m of metrics) {
      if (!m.mayDependOn || m.mayDependOn.length) continue
      for (const u of m.upward.filter(x => x.typeOnly))
        out.push({
          issue: {
            severity: 'info',
            code: 'stratum.type-upward',
            message: `底层「${m.name}」的「${name(u.from)}」只引类型地依赖「${name(u.to)}」（层「${list.find(s => s.id === u.layer)?.name ?? u.layer}」）：类型也该放在底层，或改为从底层取（ST-5）`,
            ...stratumSrc(list, m.id),
          },
          modules: [u.from, u.to],
        })
    }
  }
  return out
}

export const strataIssues = (index: ModelIndex, report?: Pick<GovernanceReport, 'moduleDeps'>): Issue[] => strataFindings(index, report).map(f => f.issue)

/** 每层经 mayDependOn 传递可依赖的层（迁移来的旧层没写时按层序：可依赖下面的全部层） */
function reachable(list: readonly StratumEntity[]): Map<string, Set<string>> {
  const direct = new Map(list.map((s, i) => [s.id, mayDependOnOf(s) ?? list.slice(i + 1).map(x => x.id)] as const))
  const out = new Map<string, Set<string>>()
  for (const s of list) {
    const seen = new Set<string>()
    const walk = (id: string) => {
      for (const d of direct.get(id) ?? [])
        if (!seen.has(d)) {
          seen.add(d)
          walk(d)
        }
    }
    walk(s.id)
    out.set(s.id, seen)
  }
  return out
}

const stratumSrc = (list: readonly StratumEntity[], id: string) => list.find(s => s.id === id)?.src ?? {}

/** ST-3：层里自身最易变（Ce 最大）的成员 */
function topContributor(index: ModelIndex, report: Pick<GovernanceReport, 'moduleDeps'>, m: StratumMetrics): string | undefined {
  let best: { id: string; ce: number } | undefined
  for (const id of m.members) {
    const ce = new Set([...report.moduleDeps.values()].filter(d => within(index, d.from, id) && !within(index, d.to, id)).map(d => d.to)).size
    if (!best || ce > best.ce) best = { id, ce }
  }
  return best?.id
}

/** ST-2：新模块归属的建议——列出各层的问题与判定问，按职责文本与层的原则文字的字面重合度排序（只是起点，归属由人或 AI 按 admits 判定） */
export interface PlaceSuggestion {
  parent: string
  candidates: { layer: string; key: string; name: string; asks?: string; admits?: string; score: number; members: string[] }[]
  note: string
}

export function placeSuggestion(index: ModelIndex, parent: string, responsibility: string): PlaceSuggestion | null {
  const list = index.strata.get(parent)
  if (!list?.length) return null
  const grams = (t: string) => {
    const s = t.replace(/\s+/g, '')
    const g = new Set<string>()
    for (let i = 0; i + 1 < s.length; i++) g.add(s.slice(i, i + 2))
    return g
  }
  const want = grams(responsibility)
  const score = (s: StratumEntity) => {
    const text = [s.name, s.asks, s.admits, s.abstraction, ...s.members.map(m => `${index.modules.get(m)?.name ?? ''}${index.modules.get(m)?.responsibility ?? ''}`)].join('')
    const have = grams(text)
    let n = 0
    for (const g of want) if (have.has(g)) n++
    return want.size ? n / want.size : 0
  }
  return {
    parent,
    candidates: list
      .map(s => ({
        layer: s.id,
        key: stratumKey(index, s),
        name: s.name,
        ...(s.asks ? { asks: s.asks } : {}),
        ...(s.admits ? { admits: s.admits } : {}),
        score: Math.round(score(s) * 100) / 100,
        members: [...s.members],
      }))
      .sort((a, b) => b.score - a.score),
    note: '按各层的判定问 admits 逐个回答是 / 否来选层，designNote 写一句理由（ST-2）；分数只是职责文字与层的原则、现有成员的字面重合度',
  }
}
