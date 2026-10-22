/**
 * 画布场景的边（ADR-0013）：关系边（本层视图边与分层总览的核心跨层边）、回放叠加的临时线（P11、P15）与分支预览、
 * 代码事实叠加线（K9）。显隐、变淡、回放态、选中突出的灰化与证实标记都在这里定。
 */
import type { EdgeFact, ModelDiff, ModelIndex, ViewEdge } from '@/model'
import { edgeLabel, isBoundaryEdge, linkRoute, type EdgeRoute } from '../layout'
import { isTemp, landingId } from '../stage'
import type { SceneContext } from './context'
import type { CanvasEdge, RouteEdgeData } from './types'

/** K9：关系边的证实标记 */
const FACT_MARK: Record<EdgeFact, string> = { confirmed: '✓', partial: '◐', unconfirmed: '?' }

/** 临时线用的视图边外形；经由上层关系时取该关系的类型与同步 / 异步（P15） */
function tempEdge(idx: ModelIndex | null, id: string, from: string, to: string, relationId?: string): ViewEdge {
  const r = relationId ? idx?.relations.get(relationId) : undefined
  return { id, kind: 'direct', from, to, type: r?.type ?? 'calls', types: [], relationIds: relationId ? [relationId] : [], mode: r?.mode ?? 'sync' }
}

/** 回放态：当前（带方向）、走过、预览、悬停 */
function playOf(ctx: SceneContext, id: string): Pick<RouteEdgeData, 'play' | 'flowReverse'> {
  const { st, hoverLanding: hov } = ctx
  if (!st) return {}
  const cur = st.current?.at
  if (cur && cur.kind !== 'internal' && landingId(cur) === id) return { play: 'current', flowReverse: cur.kind === 'edge' ? cur.reverse : false }
  if (hov && hov.kind !== 'internal' && landingId(hov) === id) return { play: 'hover' }
  if (st.previews.some(p => p.at?.kind === 'edge' && p.at.edgeId === id)) return { play: 'preview' }
  if (st.walked.has(id)) return { play: 'walked' }
  return {}
}

function edgeChange(marks: ModelDiff | null, e: ViewEdge): 'added' | 'changed' | undefined {
  if (!marks) return undefined
  const kinds = e.relationIds.map(id => marks.relation.get(id)?.kind)
  return kinds.includes('added') ? 'added' : kinds.includes('changed') ? 'changed' : undefined
}

const touchesFocus = (ctx: SceneContext, e: ViewEdge) => !!ctx.focusId && (e.from === ctx.focusId || e.to === ctx.focusId)

/** 运行视角：按舞台显示（V5、V8）；分层总览：层间边在聚焦核心模块时变淡；普通层次：与聚焦对象无关的边变淡 */
function edgeDim(ctx: SceneContext, e: ViewEdge, core: boolean, selected: boolean, played: boolean): boolean {
  if (ctx.st) return !played && !selected && (ctx.display?.edges.get(e.id) ?? 'show') === 'dim'
  if (ctx.layered) return !!ctx.near && !core && !selected
  return !!ctx.near && !touchesFocus(ctx, e) && !selected
}

function makeEdge(ctx: SceneContext, e: ViewEdge, route: EdgeRoute | undefined, core: boolean, extra: Partial<RouteEdgeData> = {}): CanvasEdge | null {
  if (!route) return null
  const selected = ctx.selectedEdgeIds.has(e.id)
  const play = playOf(ctx, e.id)
  const fact = ctx.facts?.edgeFacts.get(e.id)
  const base = ctx.st && play.play ? '' : edgeLabel(e)
  return {
    id: core ? `core:${e.id}` : e.id,
    source: e.from,
    target: e.to,
    type: 'route',
    zIndex: play.play === 'current' ? 5 : core ? 3 : 1,
    markerEnd: { type: e.type === 'implements' ? 'arrow' : 'arrowclosed', color: `var(--rel-${e.type})`, width: 14, height: 14 },
    data: {
      route,
      edge: e,
      // 运行视角下走过的边由步骤序号标注，不再标类型；K9：证实标记跟在类型后
      label: fact ? `${base} ${FACT_MARK[fact]}`.trim() : base,
      ...(fact ? { fact } : {}),
      ...(ctx.facts?.violatedEdges.has(e.id) ? { violated: true } : {}),
      selected,
      core,
      change: edgeChange(ctx.input.diff, e),
      dim: edgeDim(ctx, e, core, selected, !!play.play),
      // R15：选中步骤时，不属于选中 / 配对消息的走过的边淡为灰色
      muted: play.play === 'walked' && !!ctx.emphEdges && !ctx.emphEdges.has(e.id),
      ...play,
      ...extra,
    },
  }
}

/** 运行视角下舞台隐藏的边仍画出回放经过的与选中的 */
function stageShown(ctx: SceneContext, e: ViewEdge): boolean {
  if (!ctx.st || ctx.display?.edges.get(e.id) !== 'hide') return true
  return ctx.playEdges.has(e.id) || ctx.selectedEdgeIds.has(e.id) || !!playOf(ctx, e.id).play
}

/** 边界边默认隐藏：只在聚焦（悬停 / 选中）其任一端、被选中或回放经过时出现，避免外部关系淹没内部结构 */
function boundaryShown(ctx: SceneContext, e: ViewEdge): boolean {
  if (!isBoundaryEdge(e)) return true
  const { st, input } = ctx
  const revealed = (id: string) => input.reveal.includes(id)
  return (
    ctx.selectedEdgeIds.has(e.id) ||
    ctx.playEdges.has(e.id) ||
    touchesFocus(ctx, e) ||
    (!!st && (input.mode === 'show' || revealed(e.from) || revealed(e.to))) ||
    !!ctx.facts?.violatedEdges.has(e.id)
  )
}

/** 关系边：本层视图边，分层总览另加显示的核心跨层边 */
export function structureEdges(ctx: SceneContext): (CanvasEdge | null)[] {
  const { pv } = ctx
  const list = pv.view.edges.filter(e => stageShown(ctx, e) && boundaryShown(ctx, e)).map(e => makeEdge(ctx, e, pv.edges.get(e.id), false))
  if (ctx.layered) list.push(...ctx.visibleCoreEdges.map(e => makeEdge(ctx, e, pv.coreEdges.get(e.id), true)))
  return list
}

/** 回放叠加的边：P11、P15 本层没有视图边的消息画临时线，不参与布局——经由上层关系为关系类型色的实线，未建模为红色虚线；分支预览同样画临时线 */
export function replayEdges(ctx: SceneContext): (CanvasEdge | null)[] {
  const { st, emphEdges } = ctx
  if (!st) return []
  const idx = ctx.input.index
  const list = st.temps.map(u =>
    makeEdge(ctx, tempEdge(idx, u.edgeId, u.from, u.to, u.relationId), u.route, false, {
      temp: u.kind,
      label: u.kind === 'upper' ? '经由上层' : '未建模',
      muted: !!emphEdges && !emphEdges.has(u.edgeId),
    }),
  )
  for (const p of st.previews) {
    if (!isTemp(p.at) || !p.route) continue
    const id = landingId(p.at)
    const rel = p.at.kind === 'upper' ? p.at.relationId : undefined
    if (!st.walked.has(id))
      list.push(makeEdge(ctx, tempEdge(idx, id, p.at.from, p.at.to, rel), p.route, false, { temp: p.at.kind, play: 'preview', label: '' }))
  }
  return list
}

/** 代码事实叠加（K9）：代码依赖叠加线，不参与布局 */
export function factEdges(ctx: SceneContext): (CanvasEdge | null)[] {
  return (ctx.facts?.overlays ?? []).map(o => {
    const label = [o.undescribed ? `未描述 ${o.undescribed}` : '', o.violations ? `违规 ${o.violations}` : ''].filter(Boolean).join(' · ')
    const ve: ViewEdge = { id: o.id, kind: 'direct', from: o.from, to: o.to, type: 'depends', types: [], relationIds: [], mode: 'sync' }
    const route = linkRoute(ctx.pv.nodes.get(o.from), ctx.pv.nodes.get(o.to))
    return makeEdge(ctx, ve, route, false, { temp: 'code', label, overlay: o, ...(o.violations ? { violated: true } : {}) })
  })
}
