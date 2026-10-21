/**
 * 帧的层次投影（P1–P5、P7、P10、P11、S9、R7、R13）：把回放路径上的每一帧映射到当前层次，合并为可见消息。
 * 端点映射与结构投影共用 mapEndpoint（P1），落点的视图边 ID 与 projectLevel 一致。
 */
import { lowestCommonAncestor } from '../indexer'
import { mapEndpoint } from '../project'
import type { LevelView, MessageKind, ModelIndex, ViewEdge } from '../types'
import type { Frame, PlanNode, ScenarioPlan } from './plan'
import type { Choices } from './path'

/** 分层总览中消息在时序图上的两条泳道（核心模块优先），与结构图上的落点节点不同时给出（P7、P14） */
export type Lanes = { from: string; to: string }

/** 一帧在本层的落点 */
export type Landing =
  /** 落在视图边上；from / to 是消息方向上的视图节点，reverse 表示与边的箭头相反（P10）；core 表示分层总览的核心跨层边（P7） */
  | { kind: 'edge'; edgeId: string; from: string; to: string; reverse: boolean; core?: boolean; lanes?: Lanes }
  /** 本层两节点之间没有视图边（P11） */
  | { kind: 'unmodeled'; from: string; to: string; lanes?: Lanes }
  /** 两端落在本层同一个节点（P3）；带 lanes 时是分层总览中同一层不同泳道之间的消息，时序图画成泳道间的箭头 */
  | { kind: 'internal'; node: string; lanes?: Lanes }
  /** 两端都在本层外（P4） */
  | { kind: 'hidden' }

export type VisibleLanding = Exclude<Landing, { kind: 'hidden' }>

export interface VisibleMessage {
  index: number
  /** 覆盖的连续帧 */
  frameIds: string[]
  at: VisibleLanding
  kind: MessageKind | 'internal'
}

export interface ScenarioLevelView {
  levelId: string
  /** 本层可见消息 = 单步单位（R7） */
  messages: VisibleMessage[]
  /** 本层不可见的帧 */
  hidden: string[]
  /** 路径上帧的先后序号 */
  order: Map<string, number>
  /** 帧 → 所在可见消息的序号 */
  messageOf: Map<string, number>
}

/** 视图节点 ID：本层子模块、边界节点、参与者；视图中没有该节点时为 null */
function viewNode(index: ModelIndex, view: LevelView, ids: ReadonlySet<string>, id: string): { node: string; local: boolean } | null {
  const ep = mapEndpoint(index, view.parentId, id)
  if (ep.kind === 'skip') return null
  const node = ep.kind === 'external' ? `boundary:${ep.node}` : ep.node
  return ids.has(node) ? { node, local: ep.kind === 'local' } : null
}

/** 分层总览：端点落在核心模块的子树内时用核心模块 */
function coreNode(index: ModelIndex, view: LevelView, id: string): string | null {
  const parentDepth = (index.pathOf.get(view.parentId) ?? []).length - 1
  const second = index.pathOf.get(id)?.[parentDepth + 2]
  return second !== undefined && view.nodes.some(n => n.role === 'core' && n.id === second) ? second : null
}

function findEdge(edges: readonly ViewEdge[], a: string, b: string, relation?: string): ViewEdge | undefined {
  const between = edges.filter(e => (e.from === a && e.to === b) || (e.from === b && e.to === a))
  return (relation ? between.find(e => e.relationIds.includes(relation)) : undefined) ?? between.find(e => e.from === a) ?? between[0]
}

export function landFrame(index: ModelIndex, view: LevelView, frame: Frame, nodeIds?: ReadonlySet<string>): Landing {
  const ids = nodeIds ?? new Set(view.nodes.map(n => n.id))
  const a = viewNode(index, view, ids, frame.from)
  const b = viewNode(index, view, ids, frame.to)
  // P4：至少一端落在本层子树内才可见；一端是父模块自身或祖先时按另一端的内部活动处理
  if (!a?.local && !b?.local) return { kind: 'hidden' }
  const layered = view.mode === 'layered'
  // P3、P7、P14：分层总览先看核心模块——端点在核心模块的子树内时，它的泳道是核心模块
  const ca = layered ? (index.actors.has(frame.from) ? frame.from : (coreNode(index, view, frame.from) ?? a?.node)) : a?.node
  const cb = layered ? (index.actors.has(frame.to) ? frame.to : (coreNode(index, view, frame.to) ?? b?.node)) : b?.node
  if (!a || !b) return { kind: 'internal', node: ((a ? ca : cb) ?? (a ?? b)!.node)! }
  if (ca === cb) return { kind: 'internal', node: ca! }
  // 只在泳道与结构图落点节点不同时给出
  const lanes = layered && (ca !== a.node || cb !== b.node) ? { lanes: { from: ca!, to: cb! } } : {}
  if (a.node === b.node) return { kind: 'internal', node: a.node, ...lanes }
  if (layered) {
    const core = 'lanes' in lanes ? findEdge(view.coreEdges ?? [], ca!, cb!, frame.relation) : undefined
    if (core) return { kind: 'edge', edgeId: core.id, from: ca!, to: cb!, reverse: core.from !== ca, core: true }
  }
  const e = findEdge(view.edges, a.node, b.node, frame.relation)
  if (e) return { kind: 'edge', edgeId: e.id, from: a.node, to: b.node, reverse: e.from !== a.node, ...lanes }
  return { kind: 'unmodeled', from: a.node, to: b.node, ...lanes }
}

// ── 线性化：路径（回放）与全貌（时序图）共用同一套合并规则 ──

export type FrameStatus = 'path' | 'unchosen' | 'unreached'

export type Entry =
  | { kind: 'frame'; frame: Frame; status: FrameStatus }
  /** 分支点：合并在此断开 */
  | { kind: 'branch'; pointId: string; status: FrameStatus }
  /** 空分支的占位 */
  | { kind: 'empty'; pointId: string; option: number; status: FrameStatus }

/**
 * path：按已选分支走出回放路径，遇到未选分支的分支点即截止；
 * display：列出计划全貌，未选的分支标为 unchosen，截止处之后标为 unreached。
 */
export function linearize(plan: ScenarioPlan, choices: Choices, mode: 'path' | 'display'): Entry[] {
  const out: Entry[] = []
  let reached = true
  const walk = (nodes: readonly PlanNode[], status: FrameStatus): boolean => {
    for (const n of nodes) {
      const st: FrameStatus = status === 'path' && !reached ? 'unreached' : status
      if (n.kind === 'frame') {
        out.push({ kind: 'frame', frame: n.frame, status: st })
        continue
      }
      out.push({ kind: 'branch', pointId: n.point.id, status: st })
      const c = choices.get(n.point.id)
      const valid = c !== undefined && c >= 0 && c < n.options.length
      if (mode === 'path') {
        if (!valid) return false
        if (!walk(n.options[c], 'path')) return false
        out.push({ kind: 'branch', pointId: n.point.id, status: st })
        continue
      }
      const statuses = n.options.map((_, k): FrameStatus => (st !== 'path' ? st : !valid ? 'unreached' : k === c ? 'path' : 'unchosen'))
      if (st === 'path' && !valid) reached = false
      n.options.forEach((opt, k) => {
        if (opt.length === 0) out.push({ kind: 'empty', pointId: n.point.id, option: k, status: statuses[k] })
        else walk(opt, statuses[k])
      })
      out.push({ kind: 'branch', pointId: n.point.id, status: st })
    }
    return true
  }
  walk(plan.nodes, 'path')
  return out
}

/** 同一条视图边（含方向）、同一节点内部、同一对未建模节点（含方向） */
const landingKey = (l: VisibleLanding) =>
  (l.kind === 'edge' ? `e:${l.edgeId}:${l.from}` : l.kind === 'internal' ? `i:${l.node}` : `u:${l.from}|${l.to}`) + (l.lanes ? `:${l.lanes.from}>${l.lanes.to}` : '')
const contextKey = (f: Frame) => f.fragments.map(t => `${t.id}:${t.branch ?? ''}`).join('/')

export interface MergedMessage {
  kind: 'message'
  frames: Frame[]
  at: VisibleLanding
  status: FrameStatus
}

/** 空分支在本层的占位（时序图中画出分支条件） */
export interface EmptySlot {
  kind: 'empty'
  pointId: string
  option: number
  status: FrameStatus
}

/** P5：连续落在同一条视图边且同方向、或同一节点内部，并在同一组合框分支中的帧合并为一条可见消息；不可见的帧、分支点、空分支都会断开合并 */
export function mergeEntries(index: ModelIndex, view: LevelView, entries: readonly Entry[]): { items: (MergedMessage | EmptySlot)[]; hidden: Frame[] } {
  const ids = new Set(view.nodes.map(n => n.id))
  const items: (MergedMessage | EmptySlot)[] = []
  const hidden: Frame[] = []
  let open: { msg: MergedMessage; key: string } | null = null
  for (const e of entries) {
    if (e.kind !== 'frame') {
      open = null
      if (e.kind === 'empty') items.push({ kind: 'empty', pointId: e.pointId, option: e.option, status: e.status })
      continue
    }
    const at = landFrame(index, view, e.frame, ids)
    if (at.kind === 'hidden') {
      hidden.push(e.frame)
      open = null
      continue
    }
    const key = `${landingKey(at)}#${contextKey(e.frame)}#${e.status}`
    if (open && open.key === key) {
      open.msg.frames.push(e.frame)
      continue
    }
    open = { msg: { kind: 'message', frames: [e.frame], at, status: e.status }, key }
    items.push(open.msg)
  }
  return { items, hidden }
}

/** 内部活动画成激活条；分层总览中同一层不同泳道之间（带 lanes）按帧自己的类型画箭头 */
export const messageKind = (m: { frames: Frame[]; at: VisibleLanding }): VisibleMessage['kind'] =>
  m.at.kind === 'internal' && !m.at.lanes ? 'internal' : m.frames[0].kind

/** 回放路径在当前层次的投影 */
export function projectScenario(index: ModelIndex, view: LevelView, plan: ScenarioPlan, choices: Choices): ScenarioLevelView {
  const entries = linearize(plan, choices, 'path')
  const { items, hidden } = mergeEntries(index, view, entries)
  const messages = items.filter((m): m is MergedMessage => m.kind === 'message')
  const order = new Map<string, number>()
  for (const e of entries) if (e.kind === 'frame') order.set(e.frame.id, order.size)
  const messageOf = new Map<string, number>()
  const visible = messages.map((m, i) => {
    for (const f of m.frames) messageOf.set(f.id, i)
    return { index: i, frameIds: m.frames.map(f => f.id), at: m.at, kind: messageKind(m) }
  })
  return { levelId: view.parentId, messages: visible, hidden: hidden.map(f => f.id), order, messageOf }
}

/** 播放头所在的可见消息；播放头在本层不可见时取它之前最近的一条（R11 时用于标出已走过的边） */
function positionOf(view: ScenarioLevelView, frameId: string | null): { at: number; exact: boolean } {
  if (frameId === null) return { at: -1, exact: false }
  const m = view.messageOf.get(frameId)
  if (m !== undefined) return { at: m, exact: true }
  const ord = view.order.get(frameId) ?? -1
  let at = -1
  view.messages.forEach((msg, i) => {
    if ((view.order.get(msg.frameIds[0]) ?? Infinity) < ord) at = i
  })
  return { at, exact: false }
}

/** 播放头所在的可见消息序号；尚未开始或本层不可见时为 null */
export function currentMessage(view: ScenarioLevelView, frameId: string | null): number | null {
  const p = positionOf(view, frameId)
  return p.exact ? p.at : null
}

/** 已走过（含当前）的可见消息数：从头播放到播放头为止经过的消息 */
export function walkedCount(view: ScenarioLevelView, frameId: string | null): number {
  return positionOf(view, frameId).at + 1
}

/** R7：本层下一条可见消息覆盖的第一帧；没有时为 null */
export function stepAfter(view: ScenarioLevelView, frameId: string | null): string | null {
  const next = view.messages[positionOf(view, frameId).at + 1]
  return next ? next.frameIds[0] : null
}

/** R7：本层上一条可见消息覆盖的第一帧；没有时为 null */
export function stepBefore(view: ScenarioLevelView, frameId: string | null): string | null {
  const p = positionOf(view, frameId)
  const prev = view.messages[p.exact ? p.at - 1 : p.at]
  return prev ? prev.frameIds[0] : null
}

/** R13：指向某帧时播放头的落点——该帧所在可见消息的第一帧；本层不可见时就是它自己 */
export function landing(view: ScenarioLevelView, frameId: string): string {
  const m = view.messageOf.get(frameId)
  return m === undefined ? frameId : view.messages[m].frameIds[0]
}

/** S9：场景所在层次 = 所有帧端点（模块）的最近公共祖先 */
export function scenarioHome(index: ModelIndex, plan: ScenarioPlan): string {
  return homeOf(index, [...plan.frames.values()].flatMap(f => [f.from, f.to]))
}

/** R11：能看到某一帧的层次（两端的最近公共祖先） */
export function frameHome(index: ModelIndex, frame: Frame): string {
  return homeOf(index, [frame.from, frame.to])
}

function homeOf(index: ModelIndex, ids: string[]): string {
  const ends = ids.filter(id => index.modules.has(id))
  if (ends.length === 0) return index.rootId
  const lca = ends.reduce((acc, id) => lowestCommonAncestor(index, acc, id))
  // 公共祖先本身就是端点时，在它这一层看不到它自己，退到它的父模块
  return ends.includes(lca) ? (index.modules.get(lca)?.parentId ?? index.rootId) : lca
}

/** 舞台需要的端点对：计划中的全部帧（含所有分支），供 projectLevel 补齐边界节点与参与者 */
export function stageEnds(plan: ScenarioPlan): { from: string; to: string }[] {
  return [...plan.frames.values()].map(f => ({ from: f.from, to: f.to }))
}
