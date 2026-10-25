/**
 * 普通层次排布（A7、L4、L11）：elkjs layered 算法排父模块框内的子模块（自上而下或自左向右，端口固定朝向，正交走线）；框外的元素按方位摆放。
 */
import type { ELK, ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api'
import type { LevelView } from '@/model'
import {
  NODE_SIZE,
  SHELF,
  SURFACE,
  contentBounds,
  elementPortId,
  expandedSize,
  sizeOf,
  type Box,
  type EdgeRoute,
  type LayoutExpansion,
  type Point,
  type PositionedView,
} from './geometry'
import { LABEL_SLOT, compassOf, edgeLabel, nearPoints, placeOutside, placeRims, spreadEnds } from './routes'

/**
 * L11：elk 只排父模块框内的子模块与它们之间的边；框外的元素（用户、外部系统与时间、边界节点）在布局后按方位摆放（routes.ts placeOutside，A7、L4），
 * 边界角色（port / adapter，L14）在布局后压在父模块框的上边 / 右边（placeRims），
 * 它们的边不参与布局，要画时才按需正交走线（edgeRoute）。
 * 端口方向——每条边在两端各有自己的端口：进边在入口侧、出边在出口侧（自上而下为上进下出，自左向右为左进右出）；
 * 关系全是交互（ADR-0029），出入点都在该侧的前半（顶边 / 底边的左半，自左向右布局时左边 / 右边的上半）；进边一侧的后半留给端口记号（L13）：
 * 每个内部节点在进边一侧的末尾占一个半边宽的保留端口（RESERVED），用 FIXED_ORDER 固定，elk 只在前半里排开关系边的端口。
 */
type Side = 'NORTH' | 'SOUTH' | 'WEST' | 'EAST'
/** elk 端口序号按边分段：顺时针的 上、右、下、左 */
const SIDE_BASE: Record<Side, number> = { NORTH: 0, EAST: 1000, SOUTH: 2000, WEST: 3000 }

/** L13：进边一侧后半的保留端口（不连边，只占位）的 ID 后缀 */
export const RESERVED = '#ports'

export function portSide(end: 'in' | 'out', direction: 'DOWN' | 'RIGHT'): Side {
  return direction === 'DOWN' ? (end === 'out' ? 'SOUTH' : 'NORTH') : end === 'out' ? 'EAST' : 'WEST'
}

/** C6：节点在布局里的尺寸——展开表面的节点随元素数加长 */
const boxSize = (n: LevelView['nodes'][number], direction: 'DOWN' | 'RIGHT', exp?: LayoutExpansion | null) => {
  const els = exp?.nodes.get(n.id)
  return els ? expandedSize(sizeOf(n), els.length, direction) : sizeOf(n)
}

export function toElkGraph(view: LevelView, direction: 'DOWN' | 'RIGHT' = 'DOWN', exp?: LayoutExpansion | null): ElkNode {
  // O9：共用件不参与 elk 布局，布局后收进父模块框底部的共用件架（placeShelf）
  const inner = view.nodes.filter(n => compassOf(n) === 'inner' && n.role !== 'shared')
  const ids = new Set(inner.map(n => n.id))
  type Port = { id: string; width: number; height: number; side: Side; reserved?: boolean; element?: boolean; layoutOptions: Record<string, string> }
  const ports = new Map<string, Port[]>(inner.map(n => [n.id, []]))
  const port = (node: string, id: string, end: 'in' | 'out') => {
    const side = portSide(end, direction)
    ports.get(node)!.push({ id, width: 1, height: 1, side, layoutOptions: { 'elk.port.side': side } })
    return id
  }
  // C6：展开表面的节点——元素端口排在入边一侧（按给出的顺序、等距），接到元素的边连到元素端口；这样的节点不留端口记号的保留端口
  const expanded = new Set<string>()
  for (const n of inner) {
    const els = exp?.nodes.get(n.id)
    if (!els) continue
    expanded.add(n.id)
    const side = portSide('in', direction)
    for (const el of els)
      ports.get(n.id)!.push({ id: elementPortId(n.id, el), width: 1, height: 1, side, element: true, layoutOptions: { 'elk.port.side': side } })
  }
  const target = (e: { id: string; to: string }) => {
    const t = exp?.targets.get(e.id)
    return t && expanded.has(t.node) ? elementPortId(t.node, t.element) : null
  }
  /**
   * C6、T2-9：展开节点的尺寸——入边一侧的端口（元素端口与其余入边的端口）在这一侧等距分布（DISTRIBUTED），
   * 节点按这一侧的端口总数加长，保证元素端口间距不小于 SURFACE.pitch（元素名横排、两行错开时放得下）
   */
  const expandedBox = (n: LevelView['nodes'][number]): { width: number; height: number } => {
    const b = boxSize(n, direction, exp)
    if (!expanded.has(n.id)) return { width: b.w, height: b.h }
    const side = portSide('in', direction)
    const span = ports.get(n.id)!.filter(p => p.side === side).length * SURFACE.pitch + 2 * SURFACE.pad
    return direction === 'DOWN' ? { width: Math.max(b.w, span), height: b.h } : { width: b.w, height: Math.max(b.h, SURFACE.head + span) }
  }
  const edges = view.edges
    .filter(e => ids.has(e.from) && ids.has(e.to))
    // L5：同一对节点按类型的平行边各有端口，由 elk 错开。
    // 每条边都申请一个至少放得下「?」或「×N」的标签槽：事实标记在布局后才叠加，槽太小时 elk 可能不给坐标（画布另有中点兜底）
    .map<ElkExtendedEdge>(e => {
      const text = edgeLabel(e)
      const el = target(e)
      return {
        id: e.id,
        sources: [port(e.from, `${e.id}#out`, 'out')],
        targets: [el ?? port(e.to, `${e.id}#in`, 'in')],
        // 接到元素端口的元素级边不标 ×N，不占标签槽
        labels: el ? [] : [{ id: `${e.id}#label`, text, width: Math.max(LABEL_SLOT.w, text.length * 7 + 18), height: LABEL_SLOT.h }],
      }
    })
  // 框外边（参与者的边、边界边）在内部节点上的那一端只占一个端口、不连线：与内部边的端口一起排左右顺序，
  // 按需走线时直接用 elk 给出的端口位置，同一侧的所有出入点才统一排在前半
  for (const e of view.edges) {
    if (ids.has(e.from) && !ids.has(e.to)) port(e.from, `${e.id}#out`, 'out')
    if (ids.has(e.to) && !ids.has(e.from) && !target(e)) port(e.to, `${e.id}#in`, 'in')
  }
  // L11、L13：进边一侧的后半留给端口记号——末尾一个半边长的保留端口，关系边的端口只能排在它前面
  for (const n of inner) {
    if (expanded.has(n.id)) continue
    const side = portSide('in', direction)
    const { w, h } = sizeOf(n)
    const half = (side === 'NORTH' || side === 'SOUTH' ? w : h) / 2
    const across = side === 'NORTH' || side === 'SOUTH'
    ports
      .get(n.id)!
      .push({ id: `${n.id}${RESERVED}`, width: across ? half : 1, height: across ? 1 : half, side, reserved: true, layoutOptions: { 'elk.port.side': side } })
  }
  // L11：关系边的端口在前——顶边 / 底边的左半，左边 / 右边的上半；elk 的端口序是顺时针（上边从左到右、右边从上到下、
  // 下边从右到左、左边从下到上），按这个方向给 FIXED_ORDER 的序号
  for (const list of ports.values()) {
    for (const side of ['NORTH', 'EAST', 'SOUTH', 'WEST'] as const) {
      // C6：展开的节点在入边一侧先排元素端口（按元素顺序），关系边与不接元素的边的端口在后
      const visual = [
        ...list.filter(p => p.side === side && p.element),
        ...list.filter(p => p.side === side && !p.reserved && !p.element),
        ...list.filter(p => p.side === side && p.reserved),
      ]
      const clockwise = side === 'SOUTH' || side === 'WEST' ? [...visual].reverse() : visual
      clockwise.forEach((p, i) => (p.layoutOptions['elk.port.index'] = String(SIDE_BASE[side] + i)))
    }
  }
  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '72',
      'elk.spacing.nodeNode': '44',
      'elk.spacing.edgeNode': '24',
      'elk.spacing.edgeEdge': '14',
      'elk.spacing.portPort': '12',
      // 进节点前的直段放得下箭头与拐角圆角（同 ARRIVE 的考虑）
      'elk.layered.spacing.edgeNodeBetweenLayers': '30',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.edgeLabels.inline': 'true',
    },
    children: inner.map(n => ({
      id: n.id,
      ...expandedBox(n),
      ports: ports.get(n.id)!.map(({ id, width, height, layoutOptions }) => ({ id, width, height, layoutOptions })),
      // C6：展开的节点上元素端口按顺序等距排在入边一侧（标签画在端口处）
      layoutOptions: {
        'elk.portConstraints': 'FIXED_ORDER',
        ...(expanded.has(n.id) ? { 'elk.portAlignment.default': 'DISTRIBUTED' } : {}),
      } as Record<string, string>,
    })),
    edges,
  }
}

/** 父模块虚线框的内边距：到内部节点 / 到走线（px），与 elk.spacing.nodeNode 同量级 */
export const FRAME_PAD = 28
export const FRAME_EDGE_PAD = 12

export function fromElkGraph(view: LevelView, graph: ElkNode, exp?: LayoutExpansion | null): PositionedView {
  const nodes = new Map<string, Box>()
  const ports = new Map<string, Point>()
  for (const c of graph.children ?? []) {
    nodes.set(c.id, { x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? 0, h: c.height ?? 0 })
    for (const p of c.ports ?? [])
      if (!p.id.endsWith(RESERVED)) ports.set(p.id, { x: (c.x ?? 0) + (p.x ?? 0) + (p.width ?? 0) / 2, y: (c.y ?? 0) + (p.y ?? 0) + (p.height ?? 0) / 2 })
  }
  // C6：元素端口的位置（按入边一侧的顺序）；框外边接到元素时，它在内部节点上的端点就是元素端口（outsideRoute 按 `<边 ID>#in` 取）
  let elements: PositionedView['elements']
  if (exp)
    for (const [node, names] of exp.nodes) {
      if (!nodes.has(node)) continue
      elements ??= new Map()
      elements.set(
        node,
        names.flatMap(name => {
          const at = ports.get(elementPortId(node, name))
          return at ? [{ name, ...at }] : []
        }),
      )
    }
  for (const [id, t] of exp?.targets ?? []) {
    const at = ports.get(elementPortId(t.node, t.element))
    if (at && !ports.has(`${id}#in`)) ports.set(`${id}#in`, at)
  }
  const edges = new Map<string, EdgeRoute>()
  for (const e of (graph.edges ?? []) as ElkExtendedEdge[]) {
    const s = e.sections?.[0]
    if (!s) continue
    const lbl = e.labels?.[0]
    const points = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]
    const label = lbl && lbl.x !== undefined ? { x: lbl.x + (lbl.width ?? 0) / 2, y: (lbl.y ?? 0) + (lbl.height ?? 0) / 2 } : undefined
    // elk 有时把没放下的标签留在原点：离走线太远的标签坐标不用，交给画布按走线中点放（canvas/edges.ts routeMidpoint）
    edges.set(e.id, { points, ...(label && nearPoints(label, points, LABEL_SLOT.w + LABEL_SLOT.h) ? { label } : {}) })
  }
  // 汇到同一端点的几条边错开；接到元素端口的元素级边汇在同一元素上是本意，不错开
  spreadEnds(exp ? view.edges.filter(e => !exp.targets.has(e.id)) : view.edges, edges)
  const direction = graph.layoutOptions?.['elk.direction'] === 'RIGHT' ? 'RIGHT' : 'DOWN'
  // 父模块框：包住内部节点（留 FRAME_PAD）与内部走线（留 FRAME_EDGE_PAD），框线不压在走线上
  const inner = [...nodes.values()]
  const pts = [...edges.values()].flatMap(r => r.points)
  const boxes = [
    ...inner.map(b => ({ x1: b.x - FRAME_PAD, y1: b.y - FRAME_PAD, x2: b.x + b.w + FRAME_PAD, y2: b.y + b.h + FRAME_PAD })),
    ...pts.map(p => ({ x1: p.x - FRAME_EDGE_PAD, y1: p.y - FRAME_EDGE_PAD, x2: p.x + FRAME_EDGE_PAD, y2: p.y + FRAME_EDGE_PAD })),
  ]
  const parentFrame = boxes.length
    ? (() => {
        const x1 = Math.min(...boxes.map(b => b.x1))
        const y1 = Math.min(...boxes.map(b => b.y1))
        return { x: x1, y: y1, w: Math.max(...boxes.map(b => b.x2)) - x1, h: Math.max(...boxes.map(b => b.y2)) - y1 }
      })()
    : { x: 0, y: 0, w: NODE_SIZE.module.w, h: NODE_SIZE.module.h }
  // O9：共用件架在父模块框底部，框随之加高
  const shelved = placeShelf(view.shelf ?? [], nodes, parentFrame)
  // L14：边界角色压在父模块框线上（port 上边、adapter 右边），框随之让出
  const rimmed = placeRims(view, nodes, shelved.frame)
  // A7、L4：框外的元素按方位摆放
  const frame = placeOutside(view, nodes, rimmed)
  return {
    view,
    nodes,
    edges,
    coreEdges: new Map(),
    direction,
    parentFrame: rimmed,
    ports,
    ...(elements ? { elements } : {}),
    ...(exp?.more?.size ? { elementsMore: exp.more } : {}),
    ...(shelved.shelf ? { shelf: shelved.shelf } : {}),
    ...(frame ? { frame } : {}),
  }
}

/** O9：一行至少放这么多共用件（框太窄时加宽框，不让架竖成一列） */
const SHELF_MIN_PER_ROW = 4

/**
 * O9：普通层次的共用件架——父模块框底部紧凑排开（左侧留出「共用件」字样），放不下时换行；框向下（必要时向右）撑开包住架。
 * 返回撑开后的框与架的外框。
 */
export function placeShelf(ids: readonly string[], nodes: Map<string, Box>, parentFrame: Box): { frame: Box; shelf?: Box } {
  if (!ids.length) return { frame: parentFrame }
  const step = SHELF.w + SHELF.gap
  const fit = Math.floor((parentFrame.w - 2 * FRAME_PAD - SHELF.label + SHELF.gap) / step)
  const perRow = Math.max(1, Math.min(ids.length, Math.max(fit, SHELF_MIN_PER_ROW)))
  const rows = Math.ceil(ids.length / perRow)
  const x0 = parentFrame.x + FRAME_PAD + SHELF.label
  const y0 = parentFrame.y + parentFrame.h - FRAME_PAD + SHELF.top
  ids.forEach((id, i) => nodes.set(id, { x: x0 + (i % perRow) * step, y: y0 + Math.floor(i / perRow) * (SHELF.h + SHELF.gap), w: SHELF.w, h: SHELF.h }))
  const shelf = { x: parentFrame.x + FRAME_PAD, y: y0, w: SHELF.label + perRow * step - SHELF.gap, h: rows * (SHELF.h + SHELF.gap) - SHELF.gap }
  const right = Math.max(parentFrame.x + parentFrame.w, shelf.x + shelf.w + FRAME_PAD)
  const bottom = shelf.y + shelf.h + FRAME_PAD / 2
  return { frame: { x: parentFrame.x, y: parentFrame.y, w: right - parentFrame.x, h: bottom - parentFrame.y }, shelf }
}

let elkPromise: Promise<ELK> | undefined

/** 浏览器里用 Worker 跑 elk，测试等无 Worker 环境用同步打包版 */
function getElk(): Promise<ELK> {
  elkPromise ??= (async () => {
    if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
      const [{ default: ElkApi }, { default: ElkWorker }] = await Promise.all([import('elkjs/lib/elk-api.js'), import('elkjs/lib/elk-worker.min.js?worker')])
      return new ElkApi({ workerFactory: () => new ElkWorker() })
    }
    const { default: ElkBundled } = await import('elkjs/lib/elk.bundled.js')
    return new ElkBundled()
  })()
  return elkPromise
}

/** 画布大致的宽高比；布局结果越接近它，适应画布后缩放越小 */
const TARGET_ASPECT = 1.4

/**
 * 普通层次先自上而下排；若结果又高又窄（依赖链长），再试自左向右，取宽高比更接近画布的一种。
 */
export async function layoutGraph(view: LevelView, exp?: LayoutExpansion | null): Promise<PositionedView> {
  const elk = await getElk()
  const down = fromElkGraph(view, await elk.layout(toElkGraph(view, 'DOWN', exp)), exp)
  const score = (pv: PositionedView) => {
    const b = contentBounds(pv)
    return b ? Math.abs(Math.log(b.w / b.h / TARGET_ASPECT)) : 0
  }
  const b = contentBounds(down)
  if (!b || b.w / b.h > TARGET_ASPECT / 2) return down
  const right = fromElkGraph(view, await elk.layout(toElkGraph(view, 'RIGHT', exp)), exp)
  return score(right) < score(down) ? right : down
}
