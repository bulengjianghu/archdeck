/**
 * Layout：给 LevelView 算坐标与边的走线——入口与缓存；外部只经本文件引用（state.layout 的访问面）。
 * - graph：elkjs layered 算法，正交走线（graph.ts，L4、L11）；
 * - layered：按层序分带，规则排布，不调用 elk（layered.ts，O2、O3）；
 * - 手工走线与边界（routes.ts）、几何类型（geometry.ts）。
 * 结果按视图内容缓存，同样的输入得到同样的输出。
 */
import type { LevelView } from '@/model'
import { DEFAULT_BAND_COLUMNS, layoutLayered } from './layered'
import { layoutGraph } from './graph'
import type { LayoutOptions, PositionedView } from './geometry'

export * from './geometry'
export { BAND, DEFAULT_BAND_COLUMNS, bandColumnsFor, layoutLayered, moreChipId } from './layered'
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
  type Compass,
  linkRoute,
  nearPoints,
  parallelOffsets,
  placeActors,
  spreadEnds,
} from './routes'
export { fromElkGraph, portSide, toElkGraph } from './graph'

const cache = new Map<string, PositionedView>()
const CACHE_LIMIT = 64

/** 布局算法的版本：端口、层约束等选项改了就升，旧结果不再命中 */
export const LAYOUT_VERSION = 'L11-halves-1'

export function cacheKey(view: LevelView, opts: LayoutOptions = {}): string {
  return JSON.stringify([
    LAYOUT_VERSION,
    view.mode === 'layered' ? (opts.bandColumns ?? DEFAULT_BAND_COLUMNS) : 0,
    view.mode,
    view.parentId,
    view.nodes.map(n => (n.actorKind ? `${n.id}:${n.actorKind}` : n.id)),
    // 两级缓存：这里是节点布局；普通层次中框外元素的边不参与路由，只在内部节点上占端口（左动右静），所以也进键；它们的走线按布局与可见集另行记忆（outsideRoutes）
    view.edges.map(e => [e.id, e.relationIds.length]),
  ])
}

export async function layoutView(view: LevelView, opts: LayoutOptions = {}): Promise<PositionedView> {
  const key = cacheKey(view, opts)
  const hit = cache.get(key)
  if (hit) return { ...hit, view }
  let result: PositionedView
  if (view.mode === 'layered') result = layoutLayered(view, opts)
  else if (view.nodes.length === 0) result = { view, nodes: new Map(), edges: new Map(), coreEdges: new Map() }
  else result = await layoutGraph(view)
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  cache.set(key, result)
  return result
}

// 草图布局（state.layout.sketch，ADR-0025）：草图画布的节点、直线边与显示位置，经本入口访问
export {
  sketchScene,
  sketchPositions,
  bandRelative,
  straightEdge,
  bandAt,
  rootLayers,
  aggregateEdgeId,
  SKETCH_NODE,
  SKETCH_LAYER,
  SKETCH_BAND,
  SKETCH_PARALLEL_GAP,
} from './sketch'
export type { SketchScene, SketchNode, SketchEdge, SketchNodeData, SketchEdgeData, SketchNodeKind, SketchSceneInput, SketchBand } from './sketch'
