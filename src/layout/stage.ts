/**
 * 舞台叠加（V5、P7、P10、P11、P15、R11）与舞台显示（V5、V8、V9）：把本层帧投影与播放头换成画布要画的东西——
 * 参与的节点、走过的边与步骤序号、当前消息（方向）、经由上层与未建模的临时线、分支点各选项的预览。
 * 纯函数，只算数据与坐标；画布只按它着色。
 */
import { currentMessage, walkedCount, type Landing, type ScenarioLevelView, type VisibleLanding } from '@/model'
import type { LevelView } from '@/model'
import { edgeRoute, linkRoute, type Box, type EdgeRoute, type PositionedView } from './layout'

export interface StageMark {
  /** 视图边 ID；临时线为 `<种类>:<from>|<to>`（tempId），内部活动为 `node:<节点>` */
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
  /** 本层没有视图边的两节点之间的临时线（经由上层 P15、未建模 P11）：只画走过的与当前的 */
  temps: TempLine[]
  /** 停在分支点时各选项首条消息的预览 */
  previews: { option: number; label: string; at: VisibleLanding | null; route?: EdgeRoute; pos?: { x: number; y: number } }[]
  /** 当前帧在本层不可见（R11） */
  hiddenCurrent: boolean
}

/** 临时线落点：本层两节点之间没有视图边 */
export type TempLanding = Extract<VisibleLanding, { kind: 'upper' | 'unmodeled' }>

export interface TempLine {
  kind: TempLanding['kind']
  edgeId: string
  from: string
  to: string
  route: EdgeRoute
  /** 经由上层关系：对应的关系 */
  relationId?: string
}

export const tempId = (at: Pick<TempLanding, 'kind' | 'from' | 'to'>) => `${at.kind}:${at.from}|${at.to}`
export const isTemp = (at: VisibleLanding | null | undefined): at is TempLanding => at?.kind === 'upper' || at?.kind === 'unmodeled'

/** 落点在画布上对应的边 ID：视图边、临时线，或内部活动的 `node:<节点>` */
export const landingId = (at: VisibleLanding): string => (at.kind === 'edge' ? at.edgeId : at.kind === 'internal' ? `node:${at.node}` : tempId(at))

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
    // P7：分层总览中消息两端的核心模块小块同样参与
    if (m.at.lanes) for (const id of [m.at.lanes.from, m.at.lanes.to]) active.add(id)
  }
  const routeOf = (at: VisibleLanding): { id: string; route?: EdgeRoute } => {
    if (at.kind === 'edge') {
      const ve = pv.view.edges.find(e => e.id === at.edgeId)
      return { id: at.edgeId, route: at.core ? pv.coreEdges.get(at.edgeId) : ve ? edgeRoute(pv, ve) : pv.edges.get(at.edgeId) }
    }
    if (isTemp(at)) return { id: tempId(at), route: linkRoute(pv.nodes.get(at.from), pv.nodes.get(at.to)) }
    return { id: landingId(at) }
  }

  const walked = new Map<string, StageMark>()
  const temps = new Map<string, TempLine>()
  const count = walkedCount(sv, frameId)
  sv.messages.slice(0, count).forEach(m => {
    const { id, route } = routeOf(m.at)
    if (isTemp(m.at) && route && !temps.has(id))
      temps.set(id, { kind: m.at.kind, edgeId: id, from: m.at.from, to: m.at.to, route, ...(m.at.kind === 'upper' ? { relationId: m.at.relationId } : {}) })
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

  return { active, walked, current, temps: [...temps.values()], previews, hiddenCurrent: frameId !== null && ci === null }
}

/** V8：运行视角下静态关系的显示方式 */
export type StaticMode = 'hide' | 'dim' | 'show'
export type Visibility = 'show' | 'dim' | 'hide'

export interface StageDisplayInput {
  view: LevelView
  /** 参与本场景的节点（时序图泳道）：path = 回放路径上的消息碰到它，other = 只出现在未选分支或未到达部分 */
  participants: ReadonlyMap<string, 'path' | 'other'>
  /** 回放边（走过、当前、预览、悬停预览）的视图边 ID */
  playEdges: ReadonlySet<string>
  mode: StaticMode
  /** V9：「在画布上显示」的节点，它们的静态边及对端节点照常显示 */
  reveal: ReadonlySet<string>
  /** V10：悬停的视图节点，临时显示它的静态边 */
  hover?: string | null
}

export interface StageDisplay {
  nodes: Map<string, Visibility>
  edges: Map<string, Visibility>
}

/**
 * 舞台显示（V5、V8、V9、V10）：运行视角下每个节点与视图边是显示、淡化还是隐藏。布局不变，只决定画不画、淡不淡。
 * - 回放边始终显示；参与路径的节点显示，只在未选分支 / 未到达处出现的节点淡化；
 * - 其余节点与静态边：隐藏 / 淡化 / 照常（按显示方式）；「在画布上显示」的节点的静态边及对端节点照常；
 * - 悬停的可见节点：「隐藏」时它的静态边及对端节点淡显，「淡显」时它的静态边照常；「全显」不变；
 * - 分层总览的带始终显示（它是骨架）；共用件架上的共用件照常显示但淡化（P18）。
 */
export function stageDisplay(input: StageDisplayInput): StageDisplay {
  const { view, participants, playEdges, mode, reveal, hover } = input
  const rest: Visibility = mode === 'hide' ? 'hide' : mode === 'dim' ? 'dim' : 'show'
  const revealedEdges = view.edges.filter(e => reveal.has(e.from) || reveal.has(e.to))
  const revealedNodes = new Set([...reveal, ...revealedEdges.flatMap(e => [e.from, e.to])])

  const nodes = new Map<string, Visibility>()
  for (const n of view.nodes) {
    const p = participants.get(n.id)
    if (p === 'path') nodes.set(n.id, 'show')
    else if (n.role === 'layer' || revealedNodes.has(n.id)) nodes.set(n.id, 'show')
    // P18：共用件架照常显示但淡化（共用件不开泳道，经过它的步骤落在另一端）
    else if (n.role === 'shared') nodes.set(n.id, 'dim')
    else if (p === 'other') nodes.set(n.id, mode === 'show' ? 'show' : 'dim')
    else nodes.set(n.id, rest)
  }
  const edges = new Map<string, Visibility>()
  const revealed = new Set(revealedEdges.map(e => e.id))
  // V10：悬停的节点须本身可见；它的静态边在「隐藏」时淡显（对端节点同样淡显），在「淡显」时照常
  const hovering = !!hover && mode !== 'show' && nodes.has(hover) && nodes.get(hover) !== 'hide'
  const hovered = hovering ? [...view.edges, ...(view.coreEdges ?? [])].filter(e => e.from === hover || e.to === hover) : []
  const hoverEdge: Visibility = mode === 'hide' ? 'dim' : 'show'
  if (mode === 'hide') for (const e of hovered) for (const id of [e.from, e.to]) if (nodes.get(id) === 'hide') nodes.set(id, 'dim')
  const hoverIds = new Set(hovered.map(e => e.id))
  for (const e of [...view.edges, ...(view.coreEdges ?? [])]) {
    if (playEdges.has(e.id) || revealed.has(e.id)) edges.set(e.id, 'show')
    else if (hoverIds.has(e.id)) edges.set(e.id, hoverEdge)
    // 端点被隐藏的边不画
    else if (nodes.get(e.from) === 'hide' || nodes.get(e.to) === 'hide') edges.set(e.id, 'hide')
    else edges.set(e.id, rest)
  }
  return { nodes, edges }
}
