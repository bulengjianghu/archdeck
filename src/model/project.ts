/**
 * Projector：给定当前父模块 P，算出这一层次要画的节点和边（规则 L、O 见 docs/02-domain.md，机制见 docs/architecture/projection.md）。
 *
 * 关系 a → b 的端点先映射到「P 下的直接子模块」：
 * - 两端映射到不同子模块：端点恰好就是子模块 → 直接边；否则 → 聚合边；
 * - 两端映射到同一子模块：属于更深层次，不画；
 * - 一端在 P 外部：外部端点提升为「最近公共祖先下、它那一侧的子模块」作为边界节点。
 * 同一 (from, to, type) 的关系合并成一条边（L5：同一对节点之间不同类型的关系各成一条）。
 */
import { isBoundaryRole, isSharedRole, relationMode } from './types'
import type {
  Band,
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

/** O8：本层普通模块超过这个数（且有核心模块）时折叠为「+N」；与草图的软限同一个数（X13） */
export const FOLD_LIMIT = 7

/** O6、O8：「+N 个其他模块」占位的视图节点 ID（分层总览为层 ID，普通层次为父模块 ID） */
export const moreNodeId = (id: string): string => `more:${id}`

/** O8：本层子模块端点（mapEndpoint 的 local / external 结果）在视图里对应的节点：折叠进「+N」的换成占位 */
export const viewNodeOf = (view: Pick<LevelView, 'alias'>, node: string): string => view.alias?.[node] ?? node

/** O9、P18：本层共用件架上的视图节点（普通层次的 shelf 与分层总览各带的 shelf） */
export function shelfOf(view: Pick<LevelView, 'shelf' | 'bands'>): Set<string> {
  return new Set([...(view.shelf ?? []), ...(view.bands ?? []).flatMap(b => b.shelf)])
}

/** 一个层次的投影输入：父模块、可见性与其可见子模块 */
interface LevelScope {
  index: ModelIndex
  parentId: string
  opts: ProjectOptions
  visible: (id: string) => boolean
  children: string[]
  /** O8：本层子模块 → 视图节点（折叠进「+N」的换成占位） */
  rep: (node: string) => string
  /** O9：本层共用件（普通层次） */
  shelf: ReadonlySet<string>
}

/** 关系投影到本层的结果：视图边、共用件的边、出现的参与者与边界节点 */
interface Projected {
  edges: EdgeCollector
  shelfEdges: EdgeCollector
  actorIds: Set<string>
  boundaryOrder: string[]
}

const roleOf = (index: ModelIndex, id: string) => index.modules.get(id)!.role

/** L14：边界角色的视图标记 */
const rimOf = (index: ModelIndex, id: string): Pick<ViewNode, 'rim'> => {
  const role = roleOf(index, id)
  return role === 'port' || role === 'adapter' ? { rim: role } : {}
}

export function projectLevel(index: ModelIndex, parentId: string, opts: ProjectOptions = DEFAULT_PROJECT_OPTIONS): LevelView {
  const visible = makeVisibility(index, opts)
  if (!index.pathOf.has(parentId) || !visible(parentId)) throw new Error(`未知或已隐藏的层次：${parentId}`)
  const children = (index.childrenOf.get(parentId) ?? []).filter(visible)
  const layered = children.length > 0 && children.every(id => index.modules.get(id)!.kind === 'layer')

  // ADR-0027：普通层次按 role 分三类——核心、普通、共用件（分层总览在带内分，layeredOverview）
  const shelf = layered ? [] : children.filter(id => isSharedRole(roleOf(index, id)))
  const cores = layered ? [] : children.filter(id => roleOf(index, id) === 'core')
  // L14：port / adapter 常显、不折叠进「+N」（O8 的例外），也不算普通模块
  const rims = layered ? [] : children.filter(id => isBoundaryRole(roleOf(index, id)))
  const normal = layered ? [] : children.filter(id => !shelf.includes(id) && !cores.includes(id) && !rims.includes(id))
  const over = normal.length > FOLD_LIMIT
  // O8：有核心模块时折叠（单击临时展开，同 O6 的 expandedBands）；没有核心时不折叠，只提示
  const folding = over && cores.length > 0
  const expanded = folding && (opts.expandedBands ?? []).includes(parentId)
  const alias: Record<string, string> = {}
  if (folding && !expanded) for (const id of normal) alias[id] = moreNodeId(parentId)
  const scope: LevelScope = { index, parentId, opts, visible, children, rep: n => alias[n] ?? n, shelf: new Set(shelf) }

  const relations = index.model.relations.filter(r => {
    if (opts.relationTypes && opts.relationTypes.length > 0 && !opts.relationTypes.includes(r.type)) return false
    return (index.actors.has(r.from) || visible(r.from)) && (index.actors.has(r.to) || visible(r.to))
  })
  const proj: Projected = { edges: new EdgeCollector(), shelfEdges: new EdgeCollector(), actorIds: new Set(), boundaryOrder: [] }
  for (const r of relations) projectRelation(scope, proj, r)
  addScenarioEnds(scope, proj)

  const tail = [...boundaryNodes(scope, proj.boundaryOrder), ...actorNodes(index, proj.actorIds)]
  if (!layered) {
    const nodes: ViewNode[] = []
    for (const id of children) {
      if (alias[id]) continue
      if (scope.shelf.has(id)) nodes.push({ ...childNode(scope, id, 'module'), role: 'shared' })
      else nodes.push({ ...childNode(scope, id, 'module'), ...(cores.includes(id) ? { core: true as const } : {}), ...rimOf(index, id) })
    }
    if (folding) nodes.push({ id: moreNodeId(parentId), moduleId: parentId, role: 'more', hasChildren: false, hiddenCount: expanded ? 0 : normal.length, expanded: expanded ? normal.length : 0 })
    const shelfEdges = proj.shelfEdges.result()
    return withSharedCounts({
      mode: 'graph',
      parentId,
      nodes: [...nodes, ...tail],
      edges: proj.edges.result(),
      ...(shelf.length ? { shelf } : {}),
      ...(shelfEdges.length ? { shelfEdges } : {}),
      ...(folding ? { fold: { id: moreNodeId(parentId), members: expanded ? [] : normal, expanded } } : {}),
      ...(over && !folding ? { foldHint: normal.length } : {}),
      ...(Object.keys(alias).length ? { alias } : {}),
    })
  }
  return layeredOverview(scope, relations, proj, tail)
}

/** O10：每个非共用件节点连到的共用件个数（「共用 ×N」） */
function withSharedCounts(view: LevelView): LevelView {
  const shelf = shelfOf(view)
  if (!shelf.size || !view.shelfEdges?.length) return view
  const users = new Map<string, Set<string>>()
  for (const e of view.shelfEdges)
    for (const [a, b] of [
      [e.from, e.to],
      [e.to, e.from],
    ])
      if (!shelf.has(a) && shelf.has(b)) users.set(a, (users.get(a) ?? new Set()).add(b))
  return { ...view, nodes: view.nodes.map(n => (users.has(n.id) ? { ...n, sharedCount: users.get(n.id)!.size } : n)) }
}

/** 关系 a → b 投影到本层：参与者与本层子树之间的边、本层子模块之间的边、与外部的边界边；一端在共用件架上的进 shelfEdges（O10） */
function projectRelation({ index, parentId, opts, rep, shelf }: LevelScope, proj: Projected, r: RelationEntity) {
  const a0 = mapEndpoint(index, parentId, r.from)
  const b0 = mapEndpoint(index, parentId, r.to)
  if (a0.kind === 'skip' || b0.kind === 'skip') return
  if (a0.kind === 'external' && b0.kind === 'external') return
  // O8：折叠进「+N」的子模块换成占位节点（边按 L5 聚合到占位上）
  const a = a0.kind === 'local' ? { ...a0, node: rep(a0.node), exact: a0.exact && rep(a0.node) === a0.node } : a0
  const b = b0.kind === 'local' ? { ...b0, node: rep(b0.node), exact: b0.exact && rep(b0.node) === b0.node } : b0
  const into = (x: string, y: string) => (shelf.has(x) || shelf.has(y) ? proj.shelfEdges : proj.edges)

  // L6、A2：参与者与本层子树之间的关系；与本层子树无关的参与者不出现
  if (a.kind === 'actor' || b.kind === 'actor') {
    const local = a.kind === 'local' ? a : b.kind === 'local' ? b : null
    if (!local) return
    proj.actorIds.add(a.kind === 'actor' ? a.node : b.node)
    into(a.node, b.node).add(a.node, b.node, r, local.exact)
    return
  }
  if (a.kind === 'local' && b.kind === 'local') {
    if (a.node !== b.node) into(a.node, b.node).add(a.node, b.node, r, a.exact && b.exact)
    return
  }
  if (opts.showBoundaries) addBoundaryEdge(proj, a, b, r, shelf)
}

/** 一端在本层外：外部端点画成边界节点 */
function addBoundaryEdge(
  proj: Projected,
  a: Exclude<Endpoint, { kind: 'skip' }>,
  b: Exclude<Endpoint, { kind: 'skip' }>,
  r: RelationEntity,
  shelf: ReadonlySet<string>,
) {
  const ext = a.kind === 'external' ? a : b
  const local = a.kind === 'external' ? b : a
  const boundaryId = `boundary:${ext.node}`
  if (!proj.boundaryOrder.includes(ext.node)) proj.boundaryOrder.push(ext.node)
  const exact = a.exact && b.exact
  const into = shelf.has(local.node) ? proj.shelfEdges : proj.edges
  if (a.kind === 'external') into.add(boundaryId, b.node, r, exact)
  else into.add(a.node, boundaryId, r, exact)
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

/** 分层总览中一个端点在带内的代表：核心模块、共用件，否则为层本身 */
type Rep = { node: string; core: boolean; shelf: boolean; exact: boolean }

/** 分层总览（O）：层画成带，带内只画核心模块、共用件进带底的共用件架（O9），另算核心模块之间的核心跨层边与共用件的边 */
function layeredOverview(scope: LevelScope, relations: readonly RelationEntity[], proj: Projected, tail: ViewNode[]): LevelView {
  const { index, parentId, children } = scope
  const coreOf = new Map<string, Set<string>>()
  const shelfOfLayer = new Map<string, Set<string>>()
  // O6：临时展开的层，全部非共用件子模块都按核心模块露出
  const expanded = new Set(scope.opts.expandedBands ?? [])
  for (const l of children) {
    const kids = visibleChildren(scope, l)
    shelfOfLayer.set(l, new Set(kids.filter(c => isSharedRole(roleOf(index, c)))))
    // L14：port / adapter 同核心模块常显在带内
    coreOf.set(l, new Set(kids.filter(c => !shelfOfLayer.get(l)!.has(c) && (expanded.has(l) || roleOf(index, c) === 'core' || isBoundaryRole(roleOf(index, c))))))
  }
  const nodes = children.map(id => childNode(scope, id, 'layer'))
  const bands: Band[] = children.map(l => {
    const m = index.modules.get(l)!
    const kids = visibleChildren(scope, l)
    const core = kids.filter(c => coreOf.get(l)!.has(c))
    const shelf = kids.filter(c => shelfOfLayer.get(l)!.has(c))
    for (const c of core) nodes.push({ id: c, moduleId: c, role: 'core', hasChildren: visibleChildren(scope, c).length > 0, layerId: l, ...rimOf(index, c) })
    for (const c of shelf) nodes.push({ id: c, moduleId: c, role: 'shared', hasChildren: visibleChildren(scope, c).length > 0, layerId: l })
    const declared = kids.filter(c => roleOf(index, c) === 'core' || isBoundaryRole(roleOf(index, c))).length
    return {
      layerId: l,
      order: m.order ?? Infinity,
      coreModuleIds: core,
      hiddenCount: kids.length - core.length - shelf.length,
      ...(expanded.has(l) && core.length > declared ? { expanded: core.length - declared } : {}),
      shelf,
    }
  })
  const coreEdges = new EdgeCollector()
  const shelfEdges = new EdgeCollector()
  for (const r of relations) projectCoreRelation(scope, coreOf, shelfOfLayer, coreEdges, shelfEdges, r)
  const shelfList = shelfEdges.result()
  return withSharedCounts({
    mode: 'layered',
    parentId,
    nodes: [...nodes, ...tail],
    edges: proj.edges.result(),
    bands,
    coreEdges: coreEdges.result(),
    ...(shelfList.length ? { shelfEdges: shelfList } : {}),
  })
}

/**
 * 核心跨层边：关系端点在层内落到核心模块时用核心模块；两端都没落到核心模块时与层间边重复，不记录。
 * O10：一端落到共用件的进共用件的边（同一层内核心与共用件之间的也算；共用件与自己所在的带之间不算）。
 */
function projectCoreRelation(
  { index, parentId }: LevelScope,
  coreOf: Map<string, Set<string>>,
  shelfOfLayer: Map<string, Set<string>>,
  coreEdges: EdgeCollector,
  shelfEdges: EdgeCollector,
  r: RelationEntity,
) {
  const depth = index.pathOf.get(parentId)!.length - 1
  const a = mapEndpoint(index, parentId, r.from)
  const b = mapEndpoint(index, parentId, r.to)
  if (a.kind === 'skip' || b.kind === 'skip') return
  if (a.kind === 'actor' || b.kind === 'actor') {
    const local = a.kind === 'local' ? a : b.kind === 'local' ? b : null
    if (!local) return
    const c = coreRep(index.pathOf.get(local === a ? r.from : r.to)!, depth, coreOf, shelfOfLayer)
    const from = a.kind === 'actor' ? a.node : c.node
    const to = b.kind === 'actor' ? b.node : c.node
    if (c.shelf) shelfEdges.add(from, to, r, c.exact)
    else if (c.core) coreEdges.add(from, to, r, c.exact)
    return
  }
  if (a.kind !== 'local' || b.kind !== 'local') return
  const ca = coreRep(index.pathOf.get(r.from)!, depth, coreOf, shelfOfLayer)
  const cb = coreRep(index.pathOf.get(r.to)!, depth, coreOf, shelfOfLayer)
  if (ca.node === cb.node) return
  if (ca.shelf || cb.shelf) {
    // 共用件与它所在的带之间（同层的普通模块用它）不画：带就是它的框
    if (a.node === b.node && (!ca.core && !ca.shelf ? true : !cb.core && !cb.shelf)) return
    shelfEdges.add(ca.node, cb.node, r, ca.exact && cb.exact)
    return
  }
  if (a.node === b.node) return
  if (ca.core || cb.core) coreEdges.add(ca.node, cb.node, r, ca.exact && cb.exact)
}

/** 端点在层内落到核心模块或共用件时用它，否则用层本身 */
function coreRep(path: string[], depth: number, coreOf: Map<string, Set<string>>, shelfOfLayer: Map<string, Set<string>>): Rep {
  const layer = path[depth + 1]
  const second = path[depth + 2]
  if (second !== undefined && coreOf.get(layer)?.has(second)) return { node: second, core: true, shelf: false, exact: path.length === depth + 3 }
  if (second !== undefined && shelfOfLayer.get(layer)?.has(second)) return { node: second, core: false, shelf: true, exact: path.length === depth + 3 }
  return { node: layer, core: false, shelf: false, exact: path.length === depth + 2 }
}

/** L5：按 (from, to, type) 收集视图边，同类型内聚合并汇总同步 / 异步 */
class EdgeCollector {
  private map = new Map<string, ViewEdge & { allExact: boolean; modes: Set<string> }>()

  add(from: string, to: string, r: RelationEntity, exact: boolean) {
    const id = edgeId(from, to, r.type)
    let e = this.map.get(id)
    if (!e) {
      e = { id, kind: 'direct', from, to, type: r.type, relationIds: [], mode: 'sync', allExact: true, modes: new Set() }
      this.map.set(id, e)
    }
    e.relationIds.push(r.id)
    e.allExact &&= exact
    e.modes.add(relationMode(r))
  }

  result(): ViewEdge[] {
    return [...this.map.values()].map(({ allExact, modes, ...e }) => ({
      ...e,
      kind: allExact && e.relationIds.length === 1 ? 'direct' : 'aggregate',
      mode: modes.size > 1 ? 'mixed' : ([...modes][0] as 'sync' | 'async'),
    }))
  }
}

/** 两个模块路径的最近公共祖先（N3 定位关系、S9 场景所在层次） */
export function lowestCommonAncestor(index: ModelIndex, a: string, b: string): string {
  const pa = index.pathOf.get(a) ?? [index.rootId]
  const pb = index.pathOf.get(b) ?? [index.rootId]
  let i = 0
  while (i < pa.length && i < pb.length && pa[i] === pb[i]) i++
  return pa[i - 1] ?? index.rootId
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

/** 视图边 ID（L5） */
export function edgeId(from: string, to: string, type: string): string {
  return `${from}->${to}:${type}`
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
