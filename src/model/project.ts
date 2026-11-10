/**
 * Projector：给定当前父模块 P，算出这一层次要画的节点和边（规则 L、O 见 docs/02-domain.md，机制见 docs/architecture/projection.md）。
 *
 * 关系 a → b 的端点先映射到「P 下的直接子模块」：
 * - 两端映射到不同子模块：端点恰好就是子模块 → 直接边；否则 → 聚合边；
 * - 两端映射到同一子模块：属于更深层次，不画；
 * - 一端在 P 外部：外部端点提升为「最近公共祖先下、它那一侧的子模块」作为边界节点。
 * 同一 (from, to, type) 的关系合并成一条边（L5：同一对节点之间不同类型的关系各成一条）。
 */
import { isBoundaryRole, isSharedRole, mechanismOf, relationMode } from './types'
import { stratumKey } from './names'
import type {
  Band,
  ModelIndex,
  ProjectOptions,
  RelationEntity,
  ViewEdge,
  ViewNode,
  LevelView,
  StratumEntity,
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

/** ST（ADR-0052）：多成员层的带节点 ID（单成员层的带即成员，用成员 ID） */
export const stratumNodeId = (key: string): string => `s:${key}`

/** ST：分层总览里一个层的带节点 ID */
export function bandNodeId(index: Pick<ModelIndex, 'rootId'>, s: Pick<StratumEntity, 'parent' | 'id' | 'members'>): string {
  return s.members.length === 1 ? s.members[0] : stratumNodeId(stratumKey(index, s))
}

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
  // ST（ADR-0052）：父模块声明了分层即分层总览（O1）；层是分类，带不是模块
  const strata = (index.strata.get(parentId) ?? []).map(s => ({ s, members: s.members.filter(visible) })).filter(x => x.members.length > 0)
  const layered = strata.length > 0

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
  // ST：多成员层的成员在本层映射到它的带（同单成员层：端点落在带里即落到带上）
  const bandOf = new Map<string, string>()
  for (const { s, members } of strata) for (const id of members) bandOf.set(id, bandNodeId(index, s))
  const scope: LevelScope = { index, parentId, opts, visible, children, rep: n => alias[n] ?? bandOf.get(n) ?? n, shelf: new Set(shelf) }

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
  return layeredOverview(scope, strata, relations, proj, tail)
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

/** 分层总览中一个端点在带内的代表：带内露出的模块、共用件，否则为带本身 */
type Rep = { node: string; core: boolean; shelf: boolean; exact: boolean }

/** 一条带（O2）：带节点、它的层、带内的内容（单成员层为成员的子模块，多成员层为成员） */
interface BandScope {
  id: string
  s: StratumEntity
  /** 单成员层：带即这个成员 */
  member?: string
  contents: string[]
  shown: Set<string>
  shelf: Set<string>
}

/**
 * 分层总览（O1、O2、O2a，ADR-0052）：一层一条带。单成员层的带即成员，带内画成员的子模块，同今天的根层：核心与 port / adapter 常显、其余折成「+N」；
 * 多成员层的带内画成员，放得下（非共用件不超过七个，X13）就全显，超过才把普通成员折成「+N」。共用件进带底的共用件架（O9）。
 */
function layeredOverview(scope: LevelScope, strata: { s: StratumEntity; members: string[] }[], relations: readonly RelationEntity[], proj: Projected, tail: ViewNode[]): LevelView {
  const { index, parentId } = scope
  // O6：临时展开的带，全部非共用件内容都露出
  const expanded = new Set(scope.opts.expandedBands ?? [])
  const scopes: BandScope[] = strata.map(({ s, members }) => {
    const id = bandNodeId(index, s)
    const member = s.members.length === 1 ? s.members[0] : undefined
    const contents = member ? visibleChildren(scope, member) : members
    const shelf = new Set(contents.filter(c => isSharedRole(roleOf(index, c))))
    const rest = contents.filter(c => !shelf.has(c))
    // O2：单成员层的带即成员，同今天的根层——核心常显、其余折成「+N」；O2a：多成员层的带内成员放得下（不超过七个，X13）就全显
    const fold = (member !== undefined || rest.length > FOLD_LIMIT) && !expanded.has(id)
    const shown = new Set(rest.filter(c => !fold || roleOf(index, c) === 'core' || isBoundaryRole(roleOf(index, c))))
    return { id, s, ...(member ? { member } : {}), contents, shown, shelf }
  })
  const nodes: ViewNode[] = scopes.map(b =>
    b.member
      ? { ...childNode(scope, b.member, 'layer'), stratum: stratumKey(index, b.s) }
      : { id: b.id, moduleId: b.id, role: 'layer', hasChildren: false, stratum: stratumKey(index, b.s) },
  )
  const bands: Band[] = scopes.map(b => {
    const core = b.contents.filter(c => b.shown.has(c))
    const shelf = b.contents.filter(c => b.shelf.has(c))
    for (const c of core) nodes.push({ id: c, moduleId: c, role: 'core', hasChildren: visibleChildren(scope, c).length > 0, layerId: b.id, ...rimOf(index, c) })
    for (const c of shelf) nodes.push({ id: c, moduleId: c, role: 'shared', hasChildren: visibleChildren(scope, c).length > 0, layerId: b.id })
    const always = b.contents.filter(c => !b.shelf.has(c) && (roleOf(index, c) === 'core' || isBoundaryRole(roleOf(index, c)))).length
    return {
      layerId: b.id,
      stratum: stratumKey(index, b.s),
      order: b.s.order ?? Infinity,
      coreModuleIds: core,
      hiddenCount: b.contents.length - core.length - shelf.length,
      ...(expanded.has(b.id) && core.length > always ? { expanded: core.length - always } : {}),
      shelf,
    }
  })
  const byChild = new Map<string, BandScope>()
  for (const b of scopes) for (const id of b.member ? [b.member] : b.contents) byChild.set(id, b)
  const coreEdges = new EdgeCollector()
  const shelfEdges = new EdgeCollector()
  for (const r of relations) projectCoreRelation(scope, byChild, coreEdges, shelfEdges, r)
  const shelfList = shelfEdges.result()
  const alias: Record<string, string> = {}
  for (const b of scopes) if (!b.member) for (const c of b.contents) alias[c] = b.id
  return withSharedCounts({
    mode: 'layered',
    parentId,
    nodes: [...nodes, ...tail],
    edges: proj.edges.result(),
    bands,
    coreEdges: coreEdges.result(),
    ...(shelfList.length ? { shelfEdges: shelfList } : {}),
    ...(Object.keys(alias).length ? { alias } : {}),
  })
}

/**
 * 核心跨层边：关系端点在带内落到露出的模块时用它；两端都没落到露出的模块时与带间边重复，不记录。
 * O10：一端落到共用件的进共用件的边（同一带内露出的模块与共用件之间的也算；共用件与自己所在的带之间不算）。
 */
function projectCoreRelation(
  { index, parentId }: LevelScope,
  byChild: ReadonlyMap<string, BandScope>,
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
    const c = coreRep(index.pathOf.get(local === a ? r.from : r.to)!, depth, byChild)
    const from = a.kind === 'actor' ? a.node : c.node
    const to = b.kind === 'actor' ? b.node : c.node
    if (c.shelf) shelfEdges.add(from, to, r, c.exact)
    else if (c.core) coreEdges.add(from, to, r, c.exact)
    return
  }
  if (a.kind !== 'local' || b.kind !== 'local') return
  const ca = coreRep(index.pathOf.get(r.from)!, depth, byChild)
  const cb = coreRep(index.pathOf.get(r.to)!, depth, byChild)
  if (ca.node === cb.node) return
  const sameBand = byChild.get(a.node) === byChild.get(b.node)
  if (ca.shelf || cb.shelf) {
    // 共用件与它所在的带之间（同带的其他内容用它）不画：带就是它的框
    if (sameBand && (!ca.core && !ca.shelf ? true : !cb.core && !cb.shelf)) return
    shelfEdges.add(ca.node, cb.node, r, ca.exact && cb.exact)
    return
  }
  if (sameBand) return
  if (ca.core || cb.core) coreEdges.add(ca.node, cb.node, r, ca.exact && cb.exact)
}

/** 端点在带内落到露出的模块或共用件时用它，否则用带本身 */
function coreRep(path: string[], depth: number, byChild: ReadonlyMap<string, BandScope>): Rep {
  const child = path[depth + 1]
  const band = byChild.get(child)
  if (!band) return { node: child, core: false, shelf: false, exact: path.length === depth + 2 }
  const at = band.member ? depth + 2 : depth + 1
  const inner = path[at]
  const exact = path.length === at + 1
  if (inner !== undefined && band.shown.has(inner)) return { node: inner, core: true, shelf: false, exact }
  if (inner !== undefined && band.shelf.has(inner)) return { node: inner, core: false, shelf: true, exact }
  return { node: band.id, core: false, shelf: false, exact: !!band.member && path.length === depth + 2 }
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
    const m = mechanismOf(r)
    if (m) e.mechs = { ...e.mechs, [m]: (e.mechs?.[m] ?? 0) + 1 }
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
 * 声明了分层的父模块下为 [0, 按层序排好的位置]，其他为 [1, 在父模块子模块中的描述顺序]。逐项比较即得层次顺序（compareKeys）：
 * 同一父模块的模块相邻，上层在前，祖先在后代之前。参与者与未知 ID 的键为空。
 */
export function hierarchyKey(index: ModelIndex, id: string): number[] {
  const path = index.pathOf.get(id)
  if (!path || index.actors.has(id)) return []
  const key: number[] = []
  // ST：声明了分层的父模块下，子模块按层序排在前（childrenOf 已按层序排好）
  for (let i = 1; i < path.length; i++) key.push(index.strata.has(path[i - 1]) ? 0 : 1, (index.childrenOf.get(path[i - 1]) ?? []).indexOf(path[i]))
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

/** L45：「只看现状」隐藏的模块数——status: target 的模块及其后代（L7 可见性的补集，画布角留痕计数用） */
export function countHiddenByCurrentOnly(index: ModelIndex): number {
  const visible = makeVisibility(index, { showBoundaries: true, currentOnly: true })
  let n = 0
  for (const id of index.modules.keys()) if (!visible(id)) n++
  return n
}
