/**
 * 普通层次排布（A7、L4、L11）：elkjs layered 算法排父模块框内的子模块（自上而下或自左向右，端口固定朝向，正交走线）；框外的元素按方位摆放。
 */
import type { ELK, ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api'
import type { LevelView } from '@/model'
import { NODE_SIZE, contentBounds, sizeOf, type Box, type EdgeRoute, type PositionedView } from './geometry'
import { LABEL_SLOT, compassOf, edgeLabel, nearPoints, placeOutside, spreadEnds } from './routes'

/**
 * L11：elk 只排父模块框内的子模块与它们之间的边；框外的元素（用户、外部系统与时间、边界节点）在布局后按方位摆放（routes.ts placeOutside，A7、L4），
 * 它们的边不参与布局，要画时才按需正交走线（edgeRoute）。
 * 端口方向——每条边在两端各有自己的端口，边固定（FIXED_SIDE）、顺序由 elk 排以减少交叉：进边在入口侧、出边在出口侧
 * （自上而下为上进下出，自左向右为左进右出）。
 */
export function portSide(end: 'in' | 'out', direction: 'DOWN' | 'RIGHT'): 'NORTH' | 'SOUTH' | 'WEST' | 'EAST' {
  return direction === 'DOWN' ? (end === 'out' ? 'SOUTH' : 'NORTH') : end === 'out' ? 'EAST' : 'WEST'
}

export function toElkGraph(view: LevelView, direction: 'DOWN' | 'RIGHT' = 'DOWN'): ElkNode {
  const inner = view.nodes.filter(n => compassOf(n) === 'inner')
  const ids = new Set(inner.map(n => n.id))
  const ports = new Map<string, { id: string; width: number; height: number; layoutOptions: Record<string, string> }[]>(inner.map(n => [n.id, []]))
  const port = (node: string, id: string, end: 'in' | 'out') => {
    ports.get(node)!.push({ id, width: 1, height: 1, layoutOptions: { 'elk.port.side': portSide(end, direction) } })
    return id
  }
  const edges = view.edges
    .filter(e => ids.has(e.from) && ids.has(e.to))
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
      width: sizeOf(n).w,
      height: sizeOf(n).h,
      ports: ports.get(n.id),
      layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' },
    })),
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
  // A7、L4：框外的元素按方位摆放
  const frame = placeOutside(view, nodes, parentFrame)
  return { view, nodes, edges, coreEdges: new Map(), direction, parentFrame, ...(frame ? { frame } : {}) }
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
