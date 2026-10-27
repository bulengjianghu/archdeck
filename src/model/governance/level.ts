/**
 * 代码事实在当前层次的投影（K9、K10、Y4、Y5）：视图边的证实与违规、代码依赖叠加线、本层的环及其构成。
 * 投影与结构图、帧共用 mapEndpoint（P1、G14）。
 */
import { mapEndpoint, viewNodeOf } from '../project'
import { RELATION_TYPES } from '../types'
import type { LevelView, ModelIndex } from '../types'
import { stronglyConnected, valueDeps } from './cycles'
import { depKey } from './facts'
import type { GovernanceReport, LevelCycle, ModuleDep, Violation } from './types'

export type EdgeFact = 'confirmed' | 'partial' | 'unconfirmed'

/** 一条代码依赖叠加线：本层两个节点之间的未解释的交互与基线外的违规（K9） */
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
  /** L26：未证实的关系 ID → 两端之间是否没有任何模块依赖（K6）；标签位按它计条数、悬停逐条列出（没有时退回 edgeFacts） */
  unconfirmed?: Map<string, { isolated: boolean }>
  /** 含违规的视图边 ID */
  violatedEdges: Set<string>
  overlays: DepOverlay[]
  /** Y4：本层的环，节点 ID → 环编号（从 1 起） */
  cycles: Map<string, number>
  /** Y5：每个本层环的节点与构成它的本层依赖，按环编号 */
  levelCycles: LevelCycle[]
}

/** 模块投影到本层的节点 ID；本层没有对应节点（如未显示的边界节点）时为 null */
export function nodeOf(index: ModelIndex, view: LevelView, present: ReadonlySet<string>, moduleId: string): string | null {
  const e = mapEndpoint(index, view.parentId, moduleId)
  // O8：折叠进「+N」的模块落在占位上
  if (e.kind === 'local' && present.has(viewNodeOf(view, e.node))) return viewNodeOf(view, e.node)
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
  const unconfirmed = new Map<string, { isolated: boolean }>()
  const allEdges = [...view.edges, ...(view.coreEdges ?? [])]
  for (const e of allEdges) {
    for (const id of e.relationIds) {
      const c = report.relations.get(id)
      if (c?.status === 'unconfirmed') unconfirmed.set(id, { isolated: !!c.isolated })
    }
    const st = e.relationIds.map(id => report.relations.get(id)?.status).filter(s => s && s !== 'skipped')
    if (!st.length) continue
    const ok = st.filter(s => s === 'confirmed').length
    edgeFacts.set(e.id, ok === st.length ? 'confirmed' : ok === 0 ? 'unconfirmed' : 'partial')
  }

  // 违规与未解释的交互按节点对汇总
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
  // 画布只画基线外的违规（新增，或没有基线时的全部）；已知与已豁免的只在面板列出（K9）
  for (const v of report.violations) {
    if (v.status === 'allowed' || v.status === 'known') continue
    const p = project(v)
    if (p) bump(p[0], p[1], 'violations')
  }
  // 同方向有多条视图边（L5 按类型分边）时取关系类型声明顺序中的第一条（calls 优先），违规红晕与 Y5 都只标它
  const edgeByPair = new Map<string, string>()
  for (const e of [...view.edges].sort((x, y) => RELATION_TYPES.indexOf(x.type) - RELATION_TYPES.indexOf(y.type)))
    if (!edgeByPair.has(depKey(e.from, e.to))) edgeByPair.set(depKey(e.from, e.to), e.id)
  const violatedEdges = new Set<string>()
  const overlays: DepOverlay[] = []
  for (const [k, p] of pairs) {
    const edge = edgeByPair.get(k)
    if (p.violations && edge) violatedEdges.add(edge)
    if (p.undescribed || (p.violations && !edge))
      overlays.push({ id: `dep:${k}`, ...p, fromModule: moduleOfNode(view, p.from), toModule: moduleOfNode(view, p.to) })
  }

  // Y4：本层的环（值依赖，Y1）；Y5：按节点对记下投影来的模块依赖，环的构成由此给出
  const levelDeps = new Map<string, { from: string; to: string; deps: ModuleDep[] }>()
  for (const d of valueDeps(report.moduleDeps.values())) {
    const p = project(d)
    if (!p) continue
    const k = depKey(p[0], p[1])
    const e = levelDeps.get(k) ?? { from: p[0], to: p[1], deps: [] }
    e.deps.push(d)
    levelDeps.set(k, e)
  }
  const cycles = new Map<string, number>()
  const order = new Map(view.nodes.map((n, i) => [n.id, i]))
  const byOrder = (a: string, b: string) => (order.get(a) ?? 0) - (order.get(b) ?? 0)
  const levelCycles = stronglyConnected([...levelDeps.values()].map(e => [e.from, e.to] as [string, string])).map((members, i) => {
    const id = i + 1
    members.forEach(m => cycles.set(m, id))
    const inCycle = new Set(members)
    const edges = [...levelDeps.values()]
      .filter(e => inCycle.has(e.from) && inCycle.has(e.to))
      .sort((a, b) => byOrder(a.from, b.from) || byOrder(a.to, b.to))
      .map(e => {
        const edgeId = edgeByPair.get(depKey(e.from, e.to))
        return { ...e, fromModule: moduleOfNode(view, e.from), toModule: moduleOfNode(view, e.to), ...(edgeId ? { edgeId } : {}) }
      })
    return { id, nodes: [...members].sort(byOrder).map(m => ({ id: m, module: moduleOfNode(view, m) })), edges }
  })
  return { edgeFacts, unconfirmed, violatedEdges, overlays, cycles, levelCycles }
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

/** 一条组装叠加线：本层两个节点之间的组装事实（O12，K13），同一对节点合并 */
export interface AssemblyOverlay {
  /** `asm:<组装方节点>-><被组装方节点>` */
  id: string
  from: string
  to: string
  /** 两端节点对应的模块 ID（单击落到代码依赖选中，K10） */
  fromModule: string
  toModule: string
  /** 合并的模块级组装事实条数（×N） */
  count: number
}

export interface LevelAssembly {
  overlays: AssemblyOverlay[]
  /** 本层节点 ID → 落在它上面的组装根个数（组装根按最深模块算，聚合到本层节点，T1 裁决 9） */
  roots: Map<string, number>
}

/**
 * O12：组装事实按 mapEndpoint 投影到本层（同 K9 的代码依赖叠加线：分层总览落到带，普通层次落到子模块，折叠的落在「+N」，外部的落在边界节点）；
 * 两端为本层两个不同节点的成为组装叠加线，同一对节点合并——单击落到这对节点的代码依赖（K10，depsBetween 同一投影）。
 * 组装根按最深模块算，聚合到本层最深的可见节点（分层总览为它所在的核心模块 / 边界角色块，否则为带，T1 裁决 9）。
 */
export function levelAssembly(index: ModelIndex, view: LevelView, report: Pick<GovernanceReport, 'assembly' | 'assemblyRoots'>): LevelAssembly {
  const present = new Set(view.nodes.map(n => n.id))
  const nodeFor = (moduleId: string): string | null => {
    const path = index.pathOf.get(moduleId) ?? []
    for (let i = path.length - 1; i >= 0; i--) if (present.has(path[i]) && path[i] !== view.parentId) return path[i]
    return nodeOf(index, view, present, moduleId)
  }
  const pairs = new Map<string, AssemblyOverlay>()
  for (const f of report.assembly) {
    const a = nodeOf(index, view, present, f.from)
    const b = nodeOf(index, view, present, f.to)
    if (!a || !b || a === b) continue
    const k = depKey(a, b)
    const hit = pairs.get(k)
    if (hit) hit.count++
    else pairs.set(k, { id: `asm:${k}`, from: a, to: b, fromModule: moduleOfNode(view, a), toModule: moduleOfNode(view, b), count: 1 })
  }
  const roots = new Map<string, number>()
  for (const r of report.assemblyRoots) {
    const n = nodeFor(r)
    if (n) roots.set(n, (roots.get(n) ?? 0) + 1)
  }
  return { overlays: [...pairs.values()], roots }
}
