/** 画布场景各部分共用的派生（ADR-0013）：聚焦对象、选中的边、回放经过的边、舞台显示、选中突出与相邻节点 */
import type { LevelEvolution, LevelFacts, ScenarioLevelView, ViewEdge, VisibleLanding } from '@/model'
import type { EdgeRoute, PositionedView } from '../layout'
import { landingId, stageDisplay, type StageDisplay, type StageOverlay } from '../stage'
import type { CanvasInput } from './types'

/** 画布场景各部分（节点、关系边、回放叠加、代码事实叠加）共用的派生 */
export interface SceneContext {
  input: CanvasInput
  pv: PositionedView
  st: StageOverlay | null
  sv: ScenarioLevelView | null
  layered: boolean
  /** 结构视角下开启「代码事实」时的本层投影；运行视角为 null */
  facts: LevelFacts | null
  /** 结构视角下开启热度或时间耦合时的本层投影（J5）；运行视角为 null */
  evo: LevelEvolution | null
  /** 悬停时序图中的一条消息时，它在本层的落点（预览） */
  hoverLanding: VisibleLanding | null
  /** 聚焦对象：悬停优先，其次是选中的模块（选中的外部模块在本视图里以边界节点出现） */
  focusId: string | null
  selectedEdgeIds: Set<string>
  /** 回放走过的、预览的、悬停预览的边（视图边 ID） */
  playEdges: Set<string>
  /** 舞台显示（V5、V8、V9、V10）：运行视角下每个节点与边显示、淡化还是隐藏；结构视角为 null */
  display: StageDisplay | null
  /** R15、R16：选中步骤的消息与配对消息，以及它们所在的边；选中的不是步骤时为 null（不变灰） */
  emphMessages: Set<number> | null
  emphEdges: Set<string> | null
  /** 分层总览中显示的核心跨层边：与聚焦对象相连的、被选中的，或回放落在其上的（P7） */
  visibleCoreEdges: ViewEdge[]
  /** 与聚焦对象相邻的节点 ID；无聚焦对象时为 null（不变淡） */
  near: Set<string> | null
  /** L11：当前画出来的框外边按可见集分配轨道后的走线（普通层次；canvasScene 在算节点与边之前填入） */
  routes: Map<string, EdgeRoute>
}

export function sceneContext(input: CanvasInput, pv: PositionedView): SceneContext {
  const { stage: st, scenarioView: sv } = input
  const layered = pv.view.mode === 'layered'
  const facts = st ? null : (input.facts ?? null)
  const evo = st ? null : (input.evolution ?? null)
  const hoverLanding = hoverLandingOf(input.hover, sv)
  const focusId = focusOf(input, pv)
  const selectedEdgeIds = selectedEdgesOf(input, pv, facts, evo)
  const playEdges = new Set<string>(st?.walked.keys() ?? [])
  for (const p of st?.previews ?? []) if (p.at?.kind === 'edge') playEdges.add(p.at.edgeId)
  if (hoverLanding?.kind === 'edge') playEdges.add(hoverLanding.edgeId)
  const em = input.emphasis
  const emphMessages = em?.selected == null ? null : new Set([em.selected, ...em.paired])
  const visibleCoreEdges = (pv.view.coreEdges ?? []).filter(
    e => (focusId && (e.from === focusId || e.to === focusId)) || selectedEdgeIds.has(e.id) || playEdges.has(e.id),
  )
  return {
    input,
    pv,
    st,
    sv,
    layered,
    facts,
    evo,
    hoverLanding,
    focusId,
    selectedEdgeIds,
    playEdges,
    display: displayOf(input, pv, playEdges),
    emphMessages,
    emphEdges: emphEdgesOf(emphMessages, sv),
    visibleCoreEdges,
    near: nearOf(pv, layered, focusId, visibleCoreEdges),
    routes: new Map(),
  }
}

function hoverLandingOf(hover: string | null, sv: ScenarioLevelView | null): VisibleLanding | null {
  if (!hover?.startsWith('step:') || !sv) return null
  const m = sv.messageOf.get(hover.slice('step:'.length))
  return m === undefined ? null : sv.messages[m].at
}

function focusOf({ hover, selection: sel }: CanvasInput, pv: PositionedView): string | null {
  if (hover?.startsWith('step:')) return null
  if (hover) return hover
  if (sel?.kind === 'actor') return sel.id
  if (sel?.kind !== 'module') return null
  return !pv.nodes.has(sel.id) && pv.nodes.has(`boundary:${sel.id}`) ? `boundary:${sel.id}` : sel.id
}

function selectedEdgesOf({ selection: sel, stage: st }: CanvasInput, pv: PositionedView, facts: LevelFacts | null, evo: LevelEvolution | null): Set<string> {
  if (sel?.kind === 'edge') return new Set([sel.id])
  if (sel?.kind === 'dep') return new Set((facts?.overlays ?? []).filter(o => `${o.fromModule}->${o.toModule}` === sel.id).map(o => o.id))
  // J7：选中的耦合对所在的耦合线
  if (sel?.kind === 'couple') return new Set((evo?.couplings ?? []).filter(l => l.pairs.includes(sel.id)).map(l => l.id))
  if (sel?.kind === 'relation') {
    const ids = [...pv.view.edges, ...(pv.view.coreEdges ?? [])].filter(e => e.relationIds.includes(sel.id)).map(e => e.id)
    // P15：经由上层关系的临时线同样随关系选中
    return new Set([...ids, ...(st?.temps ?? []).filter(t => t.relationId === sel.id).map(t => t.edgeId)])
  }
  return new Set<string>()
}

function displayOf(input: CanvasInput, pv: PositionedView, playEdges: ReadonlySet<string>): StageDisplay | null {
  const { stage: st, hover } = input
  if (!st) return null
  const play = new Set(playEdges)
  const cur = st.current?.at
  if (cur?.kind === 'edge') play.add(cur.edgeId)
  // V10：悬停的节点（时序图消息的悬停不算）
  const h = hover && !hover.startsWith('step:') ? hover : null
  return stageDisplay({ view: pv.view, participants: input.participants, playEdges: play, mode: input.mode, reveal: new Set(input.reveal), hover: h })
}

function emphEdgesOf(emphMessages: ReadonlySet<number> | null, sv: ScenarioLevelView | null): Set<string> | null {
  if (!emphMessages || !sv) return null
  const ids = new Set<string>()
  for (const i of emphMessages) {
    const at = sv.messages[i]?.at
    if (at) ids.add(landingId(at))
  }
  return ids
}

function nearOf(pv: PositionedView, layered: boolean, f: string | null, visibleCoreEdges: readonly ViewEdge[]): Set<string> | null {
  if (!f || !pv.nodes.has(f)) return null
  // 分层总览中只有核心模块与参与者参与聚焦，选中层（带）不让其他内容变淡
  if (layered && !pv.view.nodes.some(n => n.id === f && (n.role === 'core' || n.role === 'actor'))) return null
  const set = new Set([f])
  for (const e of layered ? visibleCoreEdges : pv.view.edges) {
    if (e.from === f) set.add(e.to)
    if (e.to === f) set.add(e.from)
  }
  return set
}

/** V5：运行视角隐藏了静态内容时只按可见节点适应画布 */
export function visibleIdsOf(display: StageDisplay | null): Set<string> | null {
  if (!display || ![...display.nodes.values()].includes('hide')) return null
  return new Set([...display.nodes].filter(([, v]) => v !== 'hide').map(([id]) => id))
}
