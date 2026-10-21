/**
 * 代码事实在当前层次的投影（K9、K10、Y4）：视图边的证实与违规、代码依赖叠加线、本层的环。
 * 投影与结构图、帧共用 mapEndpoint（P1、G14）。
 */
import { mapEndpoint } from '../project'
import type { LevelView, ModelIndex } from '../types'
import { stronglyConnected } from './cycles'
import { depKey } from './facts'
import type { GovernanceReport, ModuleDep, Violation } from './types'

export type EdgeFact = 'confirmed' | 'partial' | 'unconfirmed'

/** 一条代码依赖叠加线：本层两个节点之间的未描述依赖与违规（K9） */
export interface DepOverlay {
  /** `dep:<依赖方节点>-><被依赖方节点>` */
  id: string
  from: string
  to: string
  /** 两端节点对应的模块 ID（选中用，K10） */
  fromModule: string
  toModule: string
  undescribed: number
  violations: number
}

export interface LevelFacts {
  /** 视图边 ID → 证实标记（含核心跨层边）；没有可判定的关系时不在其中 */
  edgeFacts: Map<string, EdgeFact>
  /** 含违规的视图边 ID */
  violatedEdges: Set<string>
  overlays: DepOverlay[]
  /** Y4：本层的环，节点 ID → 环编号（从 1 起） */
  cycles: Map<string, number>
}

/** 模块投影到本层的节点 ID；本层没有对应节点（如未显示的边界节点）时为 null */
export function nodeOf(index: ModelIndex, view: LevelView, present: ReadonlySet<string>, moduleId: string): string | null {
  const e = mapEndpoint(index, view.parentId, moduleId)
  if (e.kind === 'local' && present.has(e.node)) return e.node
  if (e.kind === 'external' && present.has(`boundary:${e.node}`)) return `boundary:${e.node}`
  return null
}

const moduleOfNode = (view: LevelView, nodeId: string) => view.nodes.find(n => n.id === nodeId)?.moduleId ?? nodeId

export function levelFacts(index: ModelIndex, view: LevelView, report: GovernanceReport): LevelFacts {
  const present = new Set(view.nodes.map(n => n.id))
  const project = (d: { from: string; to: string }) => {
    const a = nodeOf(index, view, present, d.from)
    const b = nodeOf(index, view, present, d.to)
    return a && b && a !== b ? ([a, b] as const) : null
  }

  // 视图边的证实（K9）
  const edgeFacts = new Map<string, EdgeFact>()
  const allEdges = [...view.edges, ...(view.coreEdges ?? [])]
  for (const e of allEdges) {
    const st = e.relationIds.map(id => report.relations.get(id)?.status).filter(s => s && s !== 'skipped')
    if (!st.length) continue
    const ok = st.filter(s => s === 'confirmed').length
    edgeFacts.set(e.id, ok === st.length ? 'confirmed' : ok === 0 ? 'unconfirmed' : 'partial')
  }

  // 违规与未描述依赖按节点对汇总
  const pairs = new Map<string, { from: string; to: string; undescribed: number; violations: number }>()
  const bump = (a: string, b: string, field: 'undescribed' | 'violations') => {
    const k = depKey(a, b)
    const p = pairs.get(k) ?? { from: a, to: b, undescribed: 0, violations: 0 }
    p[field]++
    pairs.set(k, p)
  }
  for (const d of report.undescribed) {
    const p = project(d)
    if (p) bump(p[0], p[1], 'undescribed')
  }
  for (const v of report.violations) {
    if (v.status === 'allowed') continue
    const p = project(v)
    if (p) bump(p[0], p[1], 'violations')
  }
  const edgeByPair = new Map(view.edges.map(e => [depKey(e.from, e.to), e.id]))
  const violatedEdges = new Set<string>()
  const overlays: DepOverlay[] = []
  for (const [k, p] of pairs) {
    const edge = edgeByPair.get(k)
    if (p.violations && edge) violatedEdges.add(edge)
    if (p.undescribed || (p.violations && !edge))
      overlays.push({ id: `dep:${k}`, ...p, fromModule: moduleOfNode(view, p.from), toModule: moduleOfNode(view, p.to) })
  }

  // Y4：本层的环
  const edges: [string, string][] = []
  for (const d of report.moduleDeps.values()) {
    const p = project(d)
    if (p) edges.push([p[0], p[1]])
  }
  const cycles = new Map<string, number>()
  stronglyConnected(edges).forEach((members, i) => members.forEach(m => cycles.set(m, i + 1)))
  return { edgeFacts, violatedEdges, overlays, cycles }
}

/** K10：投影到本层这对节点（以两端的模块 ID 指明）的模块依赖与违规 */
export function depsBetween(
  index: ModelIndex,
  view: LevelView,
  report: GovernanceReport,
  fromModule: string,
  toModule: string,
): { deps: (ModuleDep & { described: boolean })[]; violations: Violation[] } | null {
  const present = new Set(view.nodes.map(n => n.id))
  const a = nodeOf(index, view, present, fromModule)
  const b = nodeOf(index, view, present, toModule)
  if (!a || !b || a === b) return null
  const same = (d: { from: string; to: string }) => nodeOf(index, view, present, d.from) === a && nodeOf(index, view, present, d.to) === b
  const undescribed = new Set(report.undescribed.map(d => d.key))
  return {
    deps: [...report.moduleDeps.values()].filter(same).map(d => ({ ...d, described: !undescribed.has(d.key) })),
    violations: report.violations.filter(same),
  }
}
