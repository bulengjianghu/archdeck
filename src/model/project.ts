/**
 * Projector：给定当前父模块 P，算出这一层次要画的节点和边（规则 L、O 见 docs/02-domain.md，机制见 docs/architecture/projection.md）。
 *
 * 关系 a → b 的端点先映射到「P 下的直接子模块」：
 * - 两端映射到不同子模块：端点恰好就是子模块 → 直接边；否则 → 聚合边；
 * - 两端映射到同一子模块：属于更深层次，不画；
 * - 一端在 P 外部：外部端点提升为「最近公共祖先下、它那一侧的子模块」作为边界节点。
 * 同一 (from, to, type) 的关系合并成一条边。
 */
import { RELATION_TYPES } from './types'
import type {
  Band,
  RelationType,
  ModelIndex,
  ProjectOptions,
  RelationEntity,
  ViewEdge,
  ViewNode,
  LevelView,
} from './types'

/**
 * 端点映射：把一个端点映射到「父模块 P 下的直接子模块」（结构投影与场景投影共用，规则 L1–L4、P1）。
 * - local：落在 P 的子树内，node 为对应的子模块，exact 表示端点恰好就是该子模块；
 * - external：在 P 外，提升为「最近公共祖先下、它那一侧的子模块」作为边界节点；
 * - actor：外部参与者，在任何层次都映射为它自己（L6）；
 * - skip：端点就是 P 本身或其祖先，或不存在。
 */
export type Endpoint =
  | { kind: 'local'; node: string; exact: boolean }
  | { kind: 'external'; node: string; exact: boolean }
  | { kind: 'actor'; node: string; exact: true }
  | { kind: 'skip' }

export function mapEndpoint(index: ModelIndex, parentId: string, id: string): Endpoint {
  if (index.actors.has(id)) return { kind: 'actor', node: id, exact: true }
  const parentPath = index.pathOf.get(parentId)
  const path = index.pathOf.get(id)
  if (!parentPath || !path) return { kind: 'skip' }
  const depth = parentPath.length - 1
  if (path[depth] === parentId) {
    if (path.length === depth + 1) return { kind: 'skip' } // 端点就是 P 自身，属于上一层次
    return { kind: 'local', node: path[depth + 1], exact: path.length === depth + 2 }
  }
  let i = 0
  while (i < path.length && i < parentPath.length && path[i] === parentPath[i]) i++
  if (i >= path.length) return { kind: 'skip' } // 端点是 P 的祖先（校验已禁止，防御）
  return { kind: 'external', node: path[i], exact: path.length === i + 1 }
}

export const DEFAULT_PROJECT_OPTIONS: ProjectOptions = { showBoundaries: true }

/** 一个层次的投影输入：父模块、可见性与其可见子模块 */
interface LevelScope {
  index: ModelIndex
  parentId: string
  opts: ProjectOptions
  visible: (id: string) => boolean
  children: string[]
}

/** 关系投影到本层的结果：视图边、出现的参与者与边界节点 */
interface Projected {
  edges: EdgeCollector
  actorIds: Set<string>
  boundaryOrder: string[]
}

export function projectLevel(index: ModelIndex, parentId: string, opts: ProjectOptions = DEFAULT_PROJECT_OPTIONS): LevelView {
  const visible = makeVisibility(index, opts)
  if (!index.pathOf.has(parentId) || !visible(parentId)) throw new Error(`未知或已隐藏的层次：${parentId}`)
  const children = (index.childrenOf.get(parentId) ?? []).filter(visible)
  const scope: LevelScope = { index, parentId, opts, visible, children }
  const layered = children.length > 0 && children.every(id => index.modules.get(id)!.kind === 'layer')

  const relations = index.model.relations.filter(r => {
    if (opts.relationTypes && opts.relationTypes.length > 0 && !opts.relationTypes.includes(r.type)) return false
    return (index.actors.has(r.from) || visible(r.from)) && (index.actors.has(r.to) || visible(r.to))
  })
  const proj: Projected = { edges: new EdgeCollector(!layered && !!opts.mergeTypes), actorIds: new Set(), boundaryOrder: [] }
  for (const r of relations) projectRelation(scope, proj, r)
  addScenarioEnds(scope, proj)

  const tail = [...boundaryNodes(scope, proj.boundaryOrder), ...actorNodes(index, proj.actorIds)]
  if (!layered) {
    const nodes = children.map(id => childNode(scope, id, 'module'))
    return { mode: 'graph', parentId, nodes: [...nodes, ...tail], edges: proj.edges.result() }
  }
  return layeredOverview(scope, relations, proj, tail)
}

/** 关系 a → b 投影到本层：参与者与本层子树之间的边、本层子模块之间的边、与外部的边界边 */
function projectRelation({ index, parentId, opts }: LevelScope, proj: Projected, r: RelationEntity) {
  const a = mapEndpoint(index, parentId, r.from)
  const b = mapEndpoint(index, parentId, r.to)
  if (a.kind === 'skip' || b.kind === 'skip') return
  if (a.kind === 'external' && b.kind === 'external') return

  // L6、A2：参与者与本层子树之间的关系；与本层子树无关的参与者不出现
  if (a.kind === 'actor' || b.kind === 'actor') {
    const local = a.kind === 'local' ? a : b.kind === 'local' ? b : null
    if (!local) return
    proj.actorIds.add(a.kind === 'actor' ? a.node : b.node)
    proj.edges.add(a.node, b.node, r, local.exact)
    return
  }
  if (a.kind === 'local' && b.kind === 'local') {
    if (a.node !== b.node) proj.edges.add(a.node, b.node, r, a.exact && b.exact)
    return
  }
  if (opts.showBoundaries) addBoundaryEdge(proj, a, b, r)
}

/** 一端在本层外：外部端点画成边界节点 */
function addBoundaryEdge(proj: Projected, a: Exclude<Endpoint, { kind: 'skip' }>, b: Exclude<Endpoint, { kind: 'skip' }>, r: RelationEntity) {
  const ext = a.kind === 'external' ? a : b
  const boundaryId = `boundary:${ext.node}`
  if (!proj.boundaryOrder.includes(ext.node)) proj.boundaryOrder.push(ext.node)
  const exact = a.exact && b.exact
  if (a.kind === 'external') proj.edges.add(boundaryId, b.node, r, exact)
  else proj.edges.add(a.node, boundaryId, r, exact)
}

/** 舞台：场景中的帧走到本层外或来自参与者时，即使结构上没有关系也补上对应的边界节点 / 参与者（P2、P11） */
function addScenarioEnds({ index, parentId, opts }: LevelScope, proj: Projected) {
  for (const { from, to } of opts.scenarioEnds ?? []) {
    const a = mapEndpoint(index, parentId, from)
    const b = mapEndpoint(index, parentId, to)
    if (a.kind !== 'local' && b.kind !== 'local') continue
    for (const ep of [a, b]) {
      if (ep.kind === 'actor') proj.actorIds.add(ep.node)
      else if (ep.kind === 'external' && opts.showBoundaries && !proj.boundaryOrder.includes(ep.node)) proj.boundaryOrder.push(ep.node)
    }
  }
}

const visibleChildren = ({ index, visible }: LevelScope, id: string) => (index.childrenOf.get(id) ?? []).filter(visible)

function childNode(scope: LevelScope, id: string, role: 'module' | 'layer'): ViewNode {
  return { id, moduleId: id, role, hasChildren: visibleChildren(scope, id).length > 0 }
}

/** L4：边界节点按层次顺序排列，与时序图泳道一致（P9） */
function boundaryNodes(scope: LevelScope, boundaryOrder: string[]): ViewNode[] {
  const { index } = scope
  boundaryOrder.sort((x, y) => compareKeys(hierarchyKey(index, x), hierarchyKey(index, y)))
  return boundaryOrder.map(b => ({ id: `boundary:${b}`, moduleId: b, role: 'boundary', hasChildren: visibleChildren(scope, b).length > 0 }))
}

function actorNodes(index: ModelIndex, actorIds: ReadonlySet<string>): ViewNode[] {
  return index.model.actors.filter(a => actorIds.has(a.id)).map(a => ({ id: a.id, moduleId: a.id, role: 'actor', hasChildren: false, actorKind: a.kind }))
}

/** 分层总览（O）：层画成带，带内只画核心模块，另算核心模块之间的核心跨层边 */
function layeredOverview(scope: LevelScope, relations: readonly RelationEntity[], proj: Projected, tail: ViewNode[]): LevelView {
  const { index, parentId, children } = scope
  const coreOf = new Map<string, Set<string>>()
  for (const l of children) coreOf.set(l, new Set(visibleChildren(scope, l).filter(c => index.modules.get(c)!.core)))
  const nodes = children.map(id => childNode(scope, id, 'layer'))
  const bands: Band[] = children.map(l => {
    const m = index.modules.get(l)!
    const kids = visibleChildren(scope, l)
    const core = kids.filter(c => coreOf.get(l)!.has(c))
    for (const c of core) nodes.push({ id: c, moduleId: c, role: 'core', hasChildren: visibleChildren(scope, c).length > 0, layerId: l })
    return { layerId: l, order: m.order ?? Infinity, coreModuleIds: core, hiddenCount: kids.length - core.length }
  })
  const coreEdges = new EdgeCollector(false)
  for (const r of relations) projectCoreRelation(scope, coreOf, coreEdges, r)
  return { mode: 'layered', parentId, nodes: [...nodes, ...tail], edges: proj.edges.result(), bands, coreEdges: coreEdges.result() }
}

/** 核心跨层边：关系端点在层内落到核心模块时用核心模块；两端都没落到核心模块时与层间边重复，不记录 */
function projectCoreRelation({ index, parentId }: LevelScope, coreOf: Map<string, Set<string>>, coreEdges: EdgeCollector, r: RelationEntity) {
  const depth = index.pathOf.get(parentId)!.length - 1
  const a = mapEndpoint(index, parentId, r.from)
  const b = mapEndpoint(index, parentId, r.to)
  if (a.kind === 'skip' || b.kind === 'skip') return
  if (a.kind === 'actor' || b.kind === 'actor') {
    const local = a.kind === 'local' ? a : b.kind === 'local' ? b : null
    if (!local) return
    const c = coreRep(index.pathOf.get(local === a ? r.from : r.to)!, depth, coreOf)
    if (c.core) coreEdges.add(a.kind === 'actor' ? a.node : c.node, b.kind === 'actor' ? b.node : c.node, r, c.exact)
    return
  }
  if (a.kind !== 'local' || b.kind !== 'local' || a.node === b.node) return
  const ca = coreRep(index.pathOf.get(r.from)!, depth, coreOf)
  const cb = coreRep(index.pathOf.get(r.to)!, depth, coreOf)
  if (ca.core || cb.core) coreEdges.add(ca.node, cb.node, r, ca.exact && cb.exact)
}

/** 端点在层内落到核心模块时用核心模块，否则用层本身 */
function coreRep(path: string[], depth: number, coreOf: Map<string, Set<string>>): { node: string; core: boolean; exact: boolean } {
  const layer = path[depth + 1]
  const second = path[depth + 2]
  if (second !== undefined && coreOf.get(layer)?.has(second)) return { node: second, core: true, exact: path.length === depth + 3 }
  return { node: layer, core: false, exact: path.length === depth + 2 }
}

class EdgeCollector {
  private map = new Map<string, ViewEdge & { allExact: boolean; modes: Set<string>; counts: Map<RelationType, number> }>()

  constructor(private readonly mergeTypes: boolean) {}

  add(from: string, to: string, r: RelationEntity, exact: boolean) {
    const id = edgeId(from, to, this.mergeTypes ? undefined : r.type)
    let e = this.map.get(id)
    if (!e) {
      e = { id, kind: 'direct', from, to, type: r.type, types: [], relationIds: [], mode: 'sync', allExact: true, modes: new Set(), counts: new Map() }
      this.map.set(id, e)
    }
    e.relationIds.push(r.id)
    e.allExact &&= exact
    e.modes.add(r.mode ?? 'sync')
    e.counts.set(r.type, (e.counts.get(r.type) ?? 0) + 1)
  }

  result(): ViewEdge[] {
    return [...this.map.values()].map(({ allExact, modes, counts, ...e }) => {
      const types = [...counts]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count || RELATION_TYPES.indexOf(a.type) - RELATION_TYPES.indexOf(b.type))
      return {
        ...e,
        type: types[0].type,
        types,
        kind: allExact && e.relationIds.length === 1 ? 'direct' : 'aggregate',
        mode: modes.size > 1 ? 'mixed' : ([...modes][0] as 'sync' | 'async'),
      }
    })
  }
}

/**
 * 层次顺序（P9、L4）：模块在层次中的排序键。从根下到该模块的路径上每一级两项：
 * 层为 [0, order]，其他模块为 [1, 在父模块子模块中的描述顺序]。逐项比较即得层次顺序（compareKeys）：
 * 同一父模块的模块相邻，上层在前，祖先在后代之前。参与者与未知 ID 的键为空。
 */
export function hierarchyKey(index: ModelIndex, id: string): number[] {
  const path = index.pathOf.get(id)
  if (!path || index.actors.has(id)) return []
  const key: number[] = []
  for (let i = 1; i < path.length; i++) {
    const m = index.modules.get(path[i])!
    if (m.kind === 'layer') key.push(0, m.order ?? Infinity)
    else key.push(1, (index.childrenOf.get(path[i - 1]) ?? []).indexOf(path[i]))
  }
  return key
}

/** 排序键逐项比较；一方是另一方的前缀时较短者在前 */
export function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return a.length - b.length
}

/** 视图边 ID；不给 type 表示合并了类型 */
export function edgeId(from: string, to: string, type?: string): string {
  return type ? `${from}->${to}:${type}` : `${from}->${to}`
}

/** N12：给定可见性下最近的可见层次（层次自身或最近的可见祖先，否则根） */
export function nearestVisibleLevel(index: ModelIndex, levelId: string, opts: Pick<ProjectOptions, 'currentOnly'>): string {
  const visible = makeVisibility(index, { showBoundaries: true, ...opts })
  const path = index.pathOf.get(levelId) ?? [index.rootId]
  return [...path].reverse().find(visible) ?? index.rootId
}

/** currentOnly 时，status: target 的模块及其后代不可见 */
function makeVisibility(index: ModelIndex, opts: ProjectOptions): (id: string) => boolean {
  if (!opts.currentOnly) return id => index.pathOf.has(id)
  return id => {
    const path = index.pathOf.get(id)
    return !!path && path.every(p => index.modules.get(p)?.status !== 'target')
  }
}
