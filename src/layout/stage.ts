/**
 * 舞台叠加（V5、P7、P10、P11、R11）：把本层帧投影与播放头换成画布要画的东西——
 * 参与的节点、走过的边与步骤序号、当前消息（方向）、未建模的临时线、分支点各选项的预览。
 * 纯函数，只算数据与坐标；画布只按它着色。
 */
import { currentMessage, walkedCount, type Landing, type ScenarioLevelView, type VisibleLanding } from '@/model'
import { linkRoute, type Box, type EdgeRoute, type PositionedView } from './layout'

export interface StageMark {
  /** 视图边 ID；未建模的临时线为 `unmodeled:<from>|<to>` */
  edgeId: string
  /** 步骤序号（从 1 起，对应本层可见消息） */
  steps: number[]
  /** 步骤序号标在哪里 */
  at?: { x: number; y: number }
}

export interface StageOverlay {
  /** 本层参与回放的节点（全部可见消息的端点） */
  active: Set<string>
  /** 走过（含当前）的边 → 步骤序号 */
  walked: Map<string, StageMark>
  /** 当前可见消息 */
  current: { index: number; at: VisibleLanding } | null
  /** 本层没有视图边的两节点之间的临时线（P11）：只画走过的与当前的 */
  unmodeled: { edgeId: string; from: string; to: string; route: EdgeRoute }[]
  /** 停在分支点时各选项首条消息的预览 */
  previews: { option: number; label: string; at: VisibleLanding | null; route?: EdgeRoute; pos?: { x: number; y: number } }[]
  /** 当前帧在本层不可见（R11） */
  hiddenCurrent: boolean
}

export const unmodeledId = (from: string, to: string) => `unmodeled:${from}|${to}`

const mid = (r?: EdgeRoute) => r?.label ?? (r ? r.points[Math.floor(r.points.length / 2)] : undefined)
const center = (b?: Box) => (b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : undefined)

export function stageOverlay(
  sv: ScenarioLevelView,
  pv: PositionedView,
  frameId: string | null,
  options: { option: number; label: string; landing: Landing | null }[] = [],
): StageOverlay {
  const active = new Set<string>()
  for (const m of sv.messages) {
    if (m.at.kind === 'internal') active.add(m.at.node)
    else {
      active.add(m.at.from)
      active.add(m.at.to)
    }
  }
  const routeOf = (at: VisibleLanding): { id: string; route?: EdgeRoute } => {
    if (at.kind === 'edge') return { id: at.edgeId, route: at.core ? pv.coreEdges.get(at.edgeId) : pv.edges.get(at.edgeId) }
    if (at.kind === 'unmodeled') return { id: unmodeledId(at.from, at.to), route: linkRoute(pv.nodes.get(at.from), pv.nodes.get(at.to)) }
    return { id: `node:${at.node}` }
  }

  const walked = new Map<string, StageMark>()
  const unmodeled = new Map<string, StageOverlay['unmodeled'][number]>()
  const count = walkedCount(sv, frameId)
  sv.messages.slice(0, count).forEach(m => {
    const { id, route } = routeOf(m.at)
    if (m.at.kind === 'unmodeled' && route) unmodeled.set(id, { edgeId: id, from: m.at.from, to: m.at.to, route })
    const box = m.at.kind === 'internal' ? pv.nodes.get(m.at.node) : undefined
    const mark = walked.get(id) ?? { edgeId: id, steps: [], at: box ? { x: box.x + box.w - 8, y: box.y + 2 } : mid(route) }
    mark.steps.push(m.index + 1)
    walked.set(id, mark)
  })

  const ci = currentMessage(sv, frameId)
  const current = ci === null ? null : { index: ci, at: sv.messages[ci].at }

  const previews = options.map(o => {
    if (!o.landing || o.landing.kind === 'hidden') return { option: o.option, label: o.label, at: null }
    const at = o.landing
    const { route } = routeOf(at)
    const pos = at.kind === 'internal' ? center(pv.nodes.get(at.node)) : mid(route)
    return { option: o.option, label: o.label, at, route, pos }
  })

  return { active, walked, current, unmodeled: [...unmodeled.values()], previews, hiddenCurrent: frameId !== null && ci === null }
}
