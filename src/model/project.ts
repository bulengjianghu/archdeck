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

type Endpoint =
  | { kind: 'local'; node: string; exact: boolean; depthPath: string[] }
  | { kind: 'external'; node: string; exact: boolean }
  | { kind: 'skip' }

export const DEFAULT_PROJECT_OPTIONS: ProjectOptions = { showBoundaries: true }

export function projectLevel(index: ModelIndex, parentId: string, opts: ProjectOptions = DEFAULT_PROJECT_OPTIONS): LevelView {
  const visible = makeVisibility(index, opts)
  const parentPath = index.pathOf.get(parentId)
  if (!parentPath || !visible(parentId)) throw new Error(`未知或已隐藏的层次：${parentId}`)

  const children = (index.childrenOf.get(parentId) ?? []).filter(visible)
  const layered = children.length > 0 && children.every(id => index.modules.get(id)!.kind === 'layer')
  const visibleChildren = (id: string) => (index.childrenOf.get(id) ?? []).filter(visible)

  const depth = parentPath.length - 1
  const mapEndpoint = (id: string): Endpoint => {
    const path = index.pathOf.get(id)!
    if (path[depth] === parentId) {
      if (path.length === depth + 1) return { kind: 'skip' } // 端点就是 P 自身，属于上一层次
      return { kind: 'local', node: path[depth + 1], exact: path.length === depth + 2, depthPath: path }
    }
    let i = 0
    while (i < path.length && i < parentPath.length && path[i] === parentPath[i]) i++
    if (i >= path.length) return { kind: 'skip' } // 端点是 P 的祖先（校验已禁止，防御）
    return { kind: 'external', node: path[i], exact: path.length === i + 1 }
  }

  const relations = index.model.relations.filter(r => {
    if (opts.relationTypes && opts.relationTypes.length > 0 && !opts.relationTypes.includes(r.type)) return false
    return visible(r.from) && visible(r.to)
  })

  const edges = new EdgeCollector(!layered && !!opts.mergeTypes)
  const boundaryOrder: string[] = []
  const coreEdges = new EdgeCollector(false)
  const coreOf = new Map<string, Set<string>>()
  if (layered) for (const l of children) coreOf.set(l, new Set(visibleChildren(l).filter(c => index.modules.get(c)!.core)))

  for (const r of relations) {
    const a = mapEndpoint(r.from)
    const b = mapEndpoint(r.to)
    if (a.kind === 'skip' || b.kind === 'skip') continue
    if (a.kind === 'external' && b.kind === 'external') continue

    if (a.kind === 'local' && b.kind === 'local') {
      if (a.node === b.node) continue
      edges.add(a.node, b.node, r, a.exact && b.exact)
      if (layered) {
        const ca = coreRep(a.depthPath, depth, coreOf)
        const cb = coreRep(b.depthPath, depth, coreOf)
        // 两端都没落到核心模块时与层间边重复，不再记录
        if (ca.core || cb.core) coreEdges.add(ca.node, cb.node, r, ca.exact && cb.exact)
      }
      continue
    }
    if (!opts.showBoundaries) continue
    const ext = a.kind === 'external' ? a : (b as Extract<Endpoint, { kind: 'external' }>)
    const boundaryId = `boundary:${ext.node}`
    if (!boundaryOrder.includes(ext.node)) boundaryOrder.push(ext.node)
    const exact = a.exact && b.exact
    if (a.kind === 'external') edges.add(boundaryId, (b as { node: string }).node, r, exact)
    else edges.add(a.node, boundaryId, r, exact)
  }

  const nodes: ViewNode[] = children.map(id => ({
    id,
    moduleId: id,
    role: layered ? 'layer' : 'module',
    hasChildren: visibleChildren(id).length > 0,
  }))
  let bands: Band[] | undefined
  if (layered) {
    bands = children.map(l => {
      const m = index.modules.get(l)!
      const core = visibleChildren(l).filter(c => coreOf.get(l)!.has(c))
      for (const c of core) nodes.push({ id: c, moduleId: c, role: 'core', hasChildren: visibleChildren(c).length > 0, layerId: l })
      return { layerId: l, order: m.order ?? Infinity, coreModuleIds: core, hiddenCount: visibleChildren(l).length - core.length }
    })
  }
  for (const b of boundaryOrder) {
    nodes.push({ id: `boundary:${b}`, moduleId: b, role: 'boundary', hasChildren: visibleChildren(b).length > 0 })
  }

  return {
    mode: layered ? 'layered' : 'graph',
    parentId,
    nodes,
    edges: edges.result(),
    ...(layered ? { bands, coreEdges: coreEdges.result() } : {}),
  }
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

/** 视图边 ID；不给 type 表示合并了类型 */
export function edgeId(from: string, to: string, type?: string): string {
  return type ? `${from}->${to}:${type}` : `${from}->${to}`
}

/** currentOnly 时，status: target 的模块及其后代不可见 */
function makeVisibility(index: ModelIndex, opts: ProjectOptions): (id: string) => boolean {
  if (!opts.currentOnly) return id => index.pathOf.has(id)
  return id => {
    const path = index.pathOf.get(id)
    return !!path && path.every(p => index.modules.get(p)?.status !== 'target')
  }
}
