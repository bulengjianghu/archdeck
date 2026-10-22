/**
 * 普通层次排布（L4、L11）：elkjs layered 算法，自上而下（或自左向右），端口固定朝向，正交走线。
 */
import type { ELK, ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api'
import type { LevelView, ViewNode } from '@/model'
import { NODE_SIZE, contentBounds, sizeOf, type Box, type EdgeRoute, type PositionedView } from './geometry'
import { LABEL_SLOT, edgeLabel, hasActors, isBoundaryEdge, nearPoints, spreadEnds } from './routes'

/**
 * L4、L11：普通层次的节点都交给 elk——用户在第一行（DOWN；RIGHT 为第一列），内部子模块居中，边界节点与外部系统、时间在最后一行，
 * 最后一行的顺序按视图节点顺序（边界节点按层次顺序，P9）。边只交内部边与参与者的边，由 elk 正交绕行；
 * 边界边不参与布局（不为它们留通道，图保持紧凑），显示时才按需走线（routes.ts boundaryRoute）。
 * 用层约束（FIRST / LAST）而不用分区：分区时边界节点会被排成两行；最后一行的顺序用 semiInteractive 的位置提示固定。
 */
export type Row = 'first' | 'inner' | 'last'

export function rowOf(n: ViewNode): Row {
  if (n.role === 'boundary') return 'last'
  if (n.role === 'actor') return n.actorKind === 'user' ? 'first' : 'last'
  return 'inner'
}

/**
 * L11：端口方向——每条边在两端各有自己的端口，边固定（FIXED_SIDE）、顺序由 elk 排以减少交叉。
 * 内部节点进边在上、出边在下（RIGHT：左进右出）；最先一行的用户只朝下（右），最后几行的边界节点、外部系统只朝上（左）。
 */
export function portSide(n: ViewNode, end: 'in' | 'out', direction: 'DOWN' | 'RIGHT'): 'NORTH' | 'SOUTH' | 'WEST' | 'EAST' {
  const row = rowOf(n)
  const forward = row === 'first' ? true : row === 'inner' ? end === 'out' : false
  return direction === 'DOWN' ? (forward ? 'SOUTH' : 'NORTH') : forward ? 'EAST' : 'WEST'
}

export function toElkGraph(view: LevelView, direction: 'DOWN' | 'RIGHT' = 'DOWN'): ElkNode {
  const byId = new Map(view.nodes.map(n => [n.id, n]))
  const lastRow = [...view.nodes.filter(n => n.role === 'boundary'), ...view.nodes.filter(n => n.role === 'actor' && rowOf(n) === 'last')].map(n => n.id)
  const ports = new Map<string, { id: string; width: number; height: number; layoutOptions: Record<string, string> }[]>(view.nodes.map(n => [n.id, []]))
  const port = (node: string, id: string, end: 'in' | 'out') => {
    ports.get(node)!.push({ id, width: 1, height: 1, layoutOptions: { 'elk.port.side': portSide(byId.get(node)!, end, direction) } })
    return id
  }
  const edges = view.edges
    .filter(e => byId.has(e.from) && byId.has(e.to) && !isBoundaryEdge(e))
    // L5：同一对节点按类型的平行边各有端口，由 elk 错开。
    // 每条边都申请一个至少放得下「?」或「×N」的标签槽：事实标记在布局后才叠加，槽太小时 elk 可能不给坐标（画布另有中点兜底）
    .map<ElkExtendedEdge>(e => {
      const text = edgeLabel(e)
      return {
        id: e.id,
        sources: [port(e.from, `${e.id}#out`, 'out')],
        targets: [port(e.to, `${e.id}#in`, 'in')],
        labels: [{ id: `${e.id}#label`, text, width: Math.max(LABEL_SLOT.w, text.length * 7 + 18), height: LABEL_SLOT.h }],
      }
    })
  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.crossingMinimization.semiInteractive': 'true',
      // 边界节点在 elk 里没有边：不拆成独立的连通分量，层约束（LAST）才对它们生效
      'elk.separateConnectedComponents': 'false',
      'elk.layered.spacing.nodeNodeBetweenLayers': '72',
      'elk.spacing.nodeNode': '44',
      'elk.spacing.edgeNode': '24',
      'elk.spacing.edgeEdge': '14',
      'elk.spacing.portPort': '12',
      'elk.layered.spacing.edgeNodeBetweenLayers': '24',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.edgeLabels.inline': 'true',
    },
    children: view.nodes.map(n => {
      const row = rowOf(n)
      const last = row === 'last' ? lastRow.indexOf(n.id) : -1
      return {
        id: n.id,
        width: sizeOf(n).w,
        height: sizeOf(n).h,
        ports: ports.get(n.id),
        layoutOptions: {
          'elk.portConstraints': 'FIXED_SIDE',
          ...(row === 'inner' ? {} : { 'elk.layered.layering.layerConstraint': row === 'first' ? 'FIRST_SEPARATE' : 'LAST_SEPARATE' }),
          // 位置提示只用来定最后一行的先后：边界节点按视图顺序（层次顺序），其后是外部系统与时间
          ...(last >= 0 ? { 'elk.position': direction === 'DOWN' ? `(${last * 1000},0)` : `(0,${last * 1000})` } : {}),
        },
      }
    }),
    edges,
  }
}

/** 父模块虚线框的内边距：到内部节点 / 到走线（px），与 elk.spacing.nodeNode 同量级 */
export const FRAME_PAD = 28
export const FRAME_EDGE_PAD = 12

export function fromElkGraph(view: LevelView, graph: ElkNode): PositionedView {
  const nodes = new Map<string, Box>()
  for (const c of graph.children ?? []) nodes.set(c.id, { x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? 0, h: c.height ?? 0 })
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
  spreadEnds(view.edges, edges)
  const direction = graph.layoutOptions?.['elk.direction'] === 'RIGHT' ? 'RIGHT' : 'DOWN'
  if (!hasActors(view)) return { view, nodes, edges, coreEdges: new Map(), direction }
  // A7：有参与者时画内部结构的边界框（父模块虚线框）：包住内部节点（留 FRAME_PAD）与已布局的走线（留 FRAME_EDGE_PAD，参与者那一端的点除外）——
  // 框线不压在走线上，参与者与框线之间至少隔开半条层间通道
  const inner = view.nodes.filter(n => rowOf(n) === 'inner').map(n => nodes.get(n.id)!)
  const actors = view.nodes.filter(n => n.role === 'actor').map(n => nodes.get(n.id)!)
  const inActor = (p: { x: number; y: number }) => actors.some(b => p.x >= b.x - 1 && p.x <= b.x + b.w + 1 && p.y >= b.y - 1 && p.y <= b.y + b.h + 1)
  const pts = [...edges.values()].flatMap(r => r.points).filter(p => !inActor(p))
  const boxes = [
    ...inner.map(b => ({ x1: b.x - FRAME_PAD, y1: b.y - FRAME_PAD, x2: b.x + b.w + FRAME_PAD, y2: b.y + b.h + FRAME_PAD })),
    ...pts.map(p => ({ x1: p.x - FRAME_EDGE_PAD, y1: p.y - FRAME_EDGE_PAD, x2: p.x + FRAME_EDGE_PAD, y2: p.y + FRAME_EDGE_PAD })),
  ]
  const frame = inner.length
    ? (() => {
        const x1 = Math.min(...boxes.map(b => b.x1))
        const y1 = Math.min(...boxes.map(b => b.y1))
        return { x: x1, y: y1, w: Math.max(...boxes.map(b => b.x2)) - x1, h: Math.max(...boxes.map(b => b.y2)) - y1 }
      })()
    : { x: 0, y: 0, w: NODE_SIZE.module.w, h: NODE_SIZE.module.h }
  return { view, nodes, edges, coreEdges: new Map(), direction, frame }
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
export async function layoutGraph(view: LevelView): Promise<PositionedView> {
  const elk = await getElk()
  const down = fromElkGraph(view, await elk.layout(toElkGraph(view, 'DOWN')))
  const score = (pv: PositionedView) => {
    const b = contentBounds(pv)
    return b ? Math.abs(Math.log(b.w / b.h / TARGET_ASPECT)) : 0
  }
  const b = contentBounds(down)
  if (!b || b.w / b.h > TARGET_ASPECT / 2) return down
  const right = fromElkGraph(view, await elk.layout(toElkGraph(view, 'RIGHT')))
  return score(right) < score(down) ? right : down
}
