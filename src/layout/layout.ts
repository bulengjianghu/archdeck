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
import { isOutsideEdge } from './routes'

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
export const LAYOUT_VERSION = 'A7-compass-2'

export function cacheKey(view: LevelView, opts: LayoutOptions = {}): string {
  return JSON.stringify([
    LAYOUT_VERSION,
    view.mode === 'layered' ? (opts.bandColumns ?? DEFAULT_BAND_COLUMNS) : 0,
    view.mode,
    view.parentId,
    view.nodes.map(n => (n.actorKind ? `${n.id}:${n.actorKind}` : n.id)),
    // 两级缓存：这里是节点布局，普通层次中框外元素的边（参与者的边、边界边）不参与布局、不进键；它们的走线按布局另行记忆（edgeRoute）
    view.edges.filter(e => view.mode === 'layered' || !isOutsideEdge(view, e)).map(e => [e.id, e.relationIds.length]),
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
