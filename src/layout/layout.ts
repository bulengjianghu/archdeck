/**
 * Layout：给 LevelView 算坐标与边的走线——入口与缓存；外部只经本文件引用（state.layout 的访问面）。
 * - graph：elkjs layered 算法，正交走线（graph.ts，L4、L11）；
 * - layered：按层序分带，规则排布，不调用 elk（layered.ts，O2、O3）；
 * - 手工走线与边界（routes.ts）、几何类型（geometry.ts）。
 * 并集布局（L15，第七轮 T6）：交互边与结构边（StructureLinks）一起交给布局，节点位置由两组边共同决定、每条边都由同一个走线器走线；
 * 两个视角共用这一份布局（V12 由构造保证），各自只画自己那组边。
 * 表面展开（L20②、L20a②，ADR-0036）不进 elk：先取收起态的布局（去掉 expand / interactions，同一缓存），再在固定的节点上排端口点、给接到点的边走线（dots.ts）。
 * 结果按视图内容与结构边缓存，同样的输入得到同样的输出。
 */
import type { ElementKind, LevelView, ViewEdge } from '@/model'
import { DEFAULT_BAND_COLUMNS, layoutLayered } from './layered'
import { layoutGraph } from './graph'
import { compassOf } from './routes'
import { spreadEdgeId, type LayoutExpansion, type LayoutOptions, type PositionedView } from './geometry'
import { expandSurface } from './dots'
import type { LayoutTiers } from './tiers'

export * from './geometry'
export {
  BAND,
  DEFAULT_BAND_COLUMNS,
  bandColumnsFor,
  bandShelfTop,
  bandTextBoxes,
  coreHandleBadges,
  gapHeight,
  gapTracks,
  layoutLayered,
  moreChipId,
} from './layered'
export {
  ACTOR_GAP,
  LABEL_SLOT,
  PARALLEL_GAP,
  edgeLabel,
  edgeWeight,
  handleBadge,
  handleLabel,
  type HandleBadge,
  isBoundaryEdge,
  compassOf,
  edgeRoute,
  labelWidth,
  outsideRoutes,
  isOutsideEdge,
  placeOutside,
  placeRims,
  type Compass,
  linkRoute,
  mechTags,
  nearPoints,
  parallelOffsets,
  placeActors,
  portFor,
  spreadEnds,
} from './routes'
export {
  EDGE_TAGS,
  MAX_TAGS,
  PILL_GAP,
  composeLabel,
  composePill,
  hasWarnTag,
  isWarnTag,
  pillWidth,
  tagText,
  type EdgeTag,
  type Pill,
  type PillSegment,
  type TagPart,
} from './labels'
export { RESERVED, fromElkGraph, placeShelf, portSide, toElkGraph } from './graph'
export { LINE_BUDGET, budgetHint } from './budget'
export {
  elkLayers,
  placeTierLabels,
  tierBandLabel,
  tierGeometry,
  tierTextBoxes,
  LAYER_STATUS,
  layerStatusOf,
  type LayerStatus,
  type LayoutTiers,
  type TierGeometry,
} from './tiers'

/** 一条交给布局的结构边：ID 与两端视图节点 */
export interface StructureLink {
  id: string
  from: string
  to: string
}

/** C6、K14：一条元素级结构边（布局用）——所在的束与接到的元素名（越过入口、整模块为 null，接到节点本体） */
export interface ElementLink extends StructureLink {
  bundle: string
  element: string | null
  /** 元素种类（排序用，不进缓存键） */
  kind?: ElementKind
}

/**
 * C6、L20、L23：一个展开表面的节点——元素作为端口点排在入边一侧（按序），散开哪些依赖方 / 发起方节点的束（null 为全部）；
 * 交互束按接收方表面散开（D7）的去向在 interactions 里（视图边 → 它的关系接到的元素）。
 */
export interface SurfaceExpand {
  node: string
  elements: readonly string[]
  from: readonly string[] | null
  /** 端口封顶后没画成端口的元素数（「+N 个元素」，边接到节点本体） */
  more?: number
  /** L20b：元素所属的子模块组（与 elements 对齐，组号为子模块的声明顺序，本体为 null）；不分组时不给 */
  groups?: readonly (number | null)[]
  /** L20a②：元素的优先次序（交互接到的 → 使用者数 → 名字）；入边一侧放不下时从末尾截掉 */
  ranked?: readonly string[]
}

/**
 * L15：与交互边并集布局的结构边——本层的束（一对节点同方向一条，L21；没有代码事实时为 U16 的允许边），
 * 分层总览另有核心模块（与架上共用件）的跨层依赖（chipDeps，按对合成一条）。
 * C6：展开表面时（expand）被散开的束换成它的元素级边（elements），接到元素端口；交互束按表面散开的去向见 interactions。
 */
export interface StructureLinks {
  edges: readonly StructureLink[]
  core?: readonly StructureLink[]
  /** 本层全部元素级边（不论显示偏好） */
  elements?: readonly ElementLink[]
  /** C6：展开表面的节点（呈现层按选中与「总是展开表面」给出） */
  expand?: readonly SurfaceExpand[]
  /** D7：交互视图边 → 它的关系接到的接收方元素（只给接收方展开的） */
  interactions?: readonly { edge: string; elements: readonly string[] }[]
  /** L28：普通层次按本层值依赖的分层（模型层 levelTiers）；没有代码事实时不给，按边排 */
  tiers?: LayoutTiers
  /** L11、L13（ADR-0039 修订 1）：普通层次中有端口记号的内部节点（视图节点 ID）——只有它们进边一侧的后半留给记号，其余用整条边；不给即都没有 */
  marked?: readonly string[]
}

const linkEdge = (l: StructureLink): ViewEdge => ({ id: l.id, kind: 'direct', from: l.from, to: l.to, type: 'calls', relationIds: [], mode: 'sync' })

/** C6：被散开的束（ID）——被依赖方节点展开、依赖方在散开范围内、且有元素级边 */
export function spreadBundles(links: StructureLinks | null | undefined): Set<string> {
  const out = new Set<string>()
  if (!links?.expand?.length || !links.elements?.length) return out
  const has = new Set(links.elements.map(e => e.bundle))
  for (const x of links.expand) for (const b of links.edges) if (b.to === x.node && (!x.from || x.from.includes(b.from)) && has.has(b.id)) out.add(b.id)
  return out
}

/**
 * 并集视图：结构边并入视图边——普通层次与架上共用件相连的并入共用件的边（O10，不参与 elk），其余并入视图边（内部边由 elk 走线、
 * 框外边在内部节点上占端口）；分层总览的跨层依赖并入核心跨层边（O4）。同一对节点同方向的交互边与结构边各保留自己的边 ID。
 * 只用收起态的束：表面展开不进 elk（L20a②），元素级边与散开段的走线由 dots.ts 在布局结果上补。
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

/** C6：布局里的表面展开（排端口点、走线用）——只对普通层次的内部节点（不含共用件、边界节点、参与者）；没有展开时为 null */
export function layoutExpansion(view: LevelView, links: StructureLinks | null | undefined): LayoutExpansion | null {
  if (view.mode === 'layered' || !links?.expand?.length) return null
  const inner = new Set(view.nodes.filter(n => compassOf(n) === 'inner' && n.role !== 'shared' && n.role !== 'more').map(n => n.id))
  const nodes = new Map<string, readonly string[]>()
  const more = new Map<string, number>()
  const groups = new Map<string, readonly (number | null)[]>()
  const ranked = new Map<string, readonly string[]>()
  for (const x of links.expand)
    if (inner.has(x.node) && x.elements.length) {
      nodes.set(x.node, x.elements)
      if (x.more) more.set(x.node, x.more)
      if (x.groups) groups.set(x.node, x.groups)
      if (x.ranked) ranked.set(x.node, x.ranked)
    }
  if (!nodes.size) return null
  const targets = new Map<string, { node: string; element: string }>()
  const spread = spreadBundles(links)
  for (const e of links.elements ?? [])
    if (spread.has(e.bundle) && e.element && nodes.get(e.to)?.includes(e.element)) targets.set(e.id, { node: e.to, element: e.element })
  const to = new Map(view.edges.map(e => [e.id, e.to]))
  for (const x of links.interactions ?? [])
    for (const el of x.elements) {
      const node = to.get(x.edge)
      if (node && nodes.get(node)?.includes(el)) targets.set(spreadEdgeId(x.edge, el), { node, element: el })
    }
  return { nodes, targets, more, ...(groups.size ? { groups } : {}), ...(ranked.size ? { ranked } : {}) }
}

const cache = new Map<string, PositionedView>()
const CACHE_LIMIT = 64

/** 布局算法的版本：端口、层约束等选项改了就升，旧结果不再命中 */
export const LAYOUT_VERSION = 'L11-marked-1'

export function cacheKey(view: LevelView, opts: LayoutOptions = {}, links?: StructureLinks | null): string {
  return JSON.stringify([
    LAYOUT_VERSION,
    view.mode === 'layered' ? (opts.bandColumns ?? DEFAULT_BAND_COLUMNS) : 0,
    view.mode,
    view.parentId,
    view.nodes.map(n => (n.actorKind ? `${n.id}:${n.actorKind}` : n.rim ? `${n.id}:${n.rim}` : n.id)),
    // 两级缓存：这里是节点布局；普通层次中框外元素的边不参与路由，只在内部节点上占端口（左动右静），所以也进键；它们的走线按布局与可见集另行记忆（outsideRoutes）
    view.edges.map(e => [e.id, e.relationIds.length]),
    // L15、L21：结构边进键——按束 ID（代码事实变化、束增删即重算）；只按 ID，编码数据（形态、档、违规）不影响布局
    (links?.edges ?? []).map(e => e.id),
    (links?.core ?? []).map(e => e.id),
    // L28：分层进键（层号、环组、孤立、层带）
    links?.tiers ?? null,
    // L11、L13：有端口记号的节点进键（只有它们保留进边一侧的后半）
    links?.marked ?? [],
    // C6：展开表面时元素级边、展开的节点与元素、交互束的散开进键（不展开时不进；展开的结果建在收起态那一份之上，L20a②）
    ...(links?.expand?.length
      ? [
          (links.elements ?? []).map(e => [e.id, e.element]),
          links.expand.map(x => [x.node, x.elements, x.from, x.more ?? 0, x.groups ?? null]),
          (links.interactions ?? []).map(x => [x.edge, x.elements]),
        ]
      : []),
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
  let result: PositionedView
  if (view.mode !== 'layered' && links?.expand?.length) {
    // L20a②：节点位置只取收起态（同一缓存，换选中不重排），展开只排端口点、重新走线
    const { expand: _x, interactions: _i, ...collapsed } = links
    result = expandSurface(await layoutView(view, opts, collapsed), view, links)
  } else if (view.mode === 'layered') result = layoutLayered(unionView(view, links), opts)
  else if (view.nodes.length === 0) result = { view, nodes: new Map(), edges: new Map(), coreEdges: new Map() }
  else result = await layoutGraph(unionView(view, links), links?.tiers, links?.marked)
  result = { ...result, view }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  cache.set(key, result)
  return result
}

// 表面展开的输入（C6、L20、L23）：哪些节点展开、元素端口与散开范围，两个视角同一套规则
export { SURFACE_PORT_CAP, surfaceExpansion, type Expansion, type ExpansionInput } from './surface'

// 第二十一轮波 2：AI 新框的安放（DL-6）与折线取点（草图走线的标签位，DL-29），经本入口访问
export { placeNewBoxes, type Placement, type PlacementTier } from './placement'
export { pointAlong } from './routing'

// 草图布局（state.layout.sketch，ADR-0025）：草图画布的节点、直线边、引用列与框线（X22）与显示位置，经本入口访问
export {
  sketchScene,
  sketchPositions,
  projectSeed,
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
