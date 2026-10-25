/**
 * Layout：给 LevelView 算坐标与边的走线——入口与缓存；外部只经本文件引用（state.layout 的访问面）。
 * - graph：elkjs layered 算法，正交走线（graph.ts，L4、L11）；
 * - layered：按层序分带，规则排布，不调用 elk（layered.ts，O2、O3）；
 * - 手工走线与边界（routes.ts）、几何类型（geometry.ts）。
 * 并集布局（L15，第七轮 T6）：交互边与结构边（StructureLinks）一起交给布局，节点位置由两组边共同决定、每条边都由同一个走线器走线；
 * 两个视角共用这一份布局（V12 由构造保证），各自只画自己那组边。
 * 结果按视图内容与结构边缓存，同样的输入得到同样的输出。
 */
import type { LevelView, ViewEdge } from '@/model'
import { DEFAULT_BAND_COLUMNS, layoutLayered } from './layered'
import { layoutGraph } from './graph'
import type { LayoutOptions, PositionedView } from './geometry'

export * from './geometry'
export { BAND, DEFAULT_BAND_COLUMNS, bandColumnsFor, bandShelfTop, layoutLayered, moreChipId } from './layered'
export {
  ACTOR_GAP,
  LABEL_SLOT,
  PARALLEL_GAP,
  edgeLabel,
  edgeWeight,
  isBoundaryEdge,
  compassOf,
  edgeRoute,
  outsideRoutes,
  isOutsideEdge,
  placeOutside,
  placeRims,
  type Compass,
  linkRoute,
  nearPoints,
  parallelOffsets,
  placeActors,
  spreadEnds,
} from './routes'
export { RESERVED, fromElkGraph, placeShelf, portSide, toElkGraph } from './graph'

/** 一条交给布局的结构边：ID 与两端视图节点 */
export interface StructureLink {
  id: string
  from: string
  to: string
}

/**
 * L15：与交互边并集布局的结构边——本层的结构边（levelDeps，含只引类型；没有代码事实时为 U16 的允许边），
 * 分层总览另有核心模块（与架上共用件）的跨层依赖（chipDeps，全部块）。
 */
export interface StructureLinks {
  edges: readonly StructureLink[]
  core?: readonly StructureLink[]
}

const linkEdge = (l: StructureLink): ViewEdge => ({ id: l.id, kind: 'direct', from: l.from, to: l.to, type: 'calls', relationIds: [], mode: 'sync' })

/**
 * 并集视图：结构边并入视图边——普通层次与架上共用件相连的并入共用件的边（O10，不参与 elk），其余并入视图边（内部边由 elk 走线、
 * 框外边在内部节点上占端口）；分层总览的跨层依赖并入核心跨层边（O4）。同一对节点同方向的交互边与结构边各保留自己的边 ID。
 */
export function unionView(view: LevelView, links: StructureLinks | null | undefined): LevelView {
  if (!links || (!links.edges.length && !links.core?.length)) return view
  const shelf = new Set(view.shelf ?? [])
  const onShelf = (e: StructureLink) => shelf.has(e.from) || shelf.has(e.to)
  return {
    ...view,
    edges: [...view.edges, ...links.edges.filter(e => !onShelf(e)).map(linkEdge)],
    ...(view.mode === 'layered' ? {} : { shelfEdges: [...(view.shelfEdges ?? []), ...links.edges.filter(onShelf).map(linkEdge)] }),
    ...(links.core?.length ? { coreEdges: [...(view.coreEdges ?? []), ...links.core.map(linkEdge)] } : {}),
  }
}

const cache = new Map<string, PositionedView>()
const CACHE_LIMIT = 64

/** 布局算法的版本：端口、层约束等选项改了就升，旧结果不再命中 */
export const LAYOUT_VERSION = 'L15-union-1'

export function cacheKey(view: LevelView, opts: LayoutOptions = {}, links?: StructureLinks | null): string {
  return JSON.stringify([
    LAYOUT_VERSION,
    view.mode === 'layered' ? (opts.bandColumns ?? DEFAULT_BAND_COLUMNS) : 0,
    view.mode,
    view.parentId,
    view.nodes.map(n => (n.actorKind ? `${n.id}:${n.actorKind}` : n.rim ? `${n.id}:${n.rim}` : n.id)),
    // 两级缓存：这里是节点布局；普通层次中框外元素的边不参与路由，只在内部节点上占端口（左动右静），所以也进键；它们的走线按布局与可见集另行记忆（outsideRoutes）
    view.edges.map(e => [e.id, e.relationIds.length]),
    // L15：结构边进键——代码事实变化（结构边增删）即重算；只按 ID，编码数据（档、违规）不影响布局
    (links?.edges ?? []).map(e => e.id),
    (links?.core ?? []).map(e => e.id),
  ])
}

/**
 * 给层次视图布局；links 为与交互边并集布局的结构边（L15）。结果的 view 是传入的视图（只有交互边），
 * 结构边的走线与交互边的一起在 edges（分层总览的跨层依赖在 coreEdges）里，按边 ID 取。
 */
export async function layoutView(view: LevelView, opts: LayoutOptions = {}, links?: StructureLinks | null): Promise<PositionedView> {
  const key = cacheKey(view, opts, links)
  const hit = cache.get(key)
  if (hit) return { ...hit, view }
  const union = unionView(view, links)
  let result: PositionedView
  if (view.mode === 'layered') result = layoutLayered(union, opts)
  else if (view.nodes.length === 0) result = { view, nodes: new Map(), edges: new Map(), coreEdges: new Map() }
  else result = await layoutGraph(union)
  result = { ...result, view }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  cache.set(key, result)
  return result
}

// 草图布局（state.layout.sketch，ADR-0025）：草图画布的节点、直线边、引用列与框线（X22）与显示位置，经本入口访问
export {
  sketchScene,
  sketchPositions,
  bandRelative,
  straightEdge,
  bandAt,
  outsideCenter,
  referenceColumns,
  rootLayers,
  aggregateEdgeId,
  SKETCH_NODE,
  SKETCH_LAYER,
  SKETCH_BAND,
  SKETCH_PARALLEL_GAP,
  SKETCH_CANVAS_FALLBACK,
  canvasArea,
  SKETCH_CENTER_MIN_W,
  SKETCH_REF,
  SKETCH_COLUMN,
} from './sketch'
export type {
  SketchScene,
  SketchNode,
  SketchEdge,
  SketchNodeData,
  SketchEdgeData,
  SketchNodeKind,
  SketchSceneInput,
  SketchBand,
  SketchColumn,
  SketchRect,
  SketchFrameKind,
} from './sketch'
