/**
 * 画布场景的边（ADR-0013）：关系边（本层视图边与分层总览的核心跨层边）、回放叠加的临时线（P11、P15）与分支预览、
 * 代码事实叠加线（K9）、时间耦合的波浪线（J5）、组装叠加线（O12）。显隐、变淡、回放态、选中突出的灰化，以及视觉通道（L10：箭头、线宽档；标签位按 L26 组装，labels.ts）都在这里定。
 * 线型不在这里定：实线 = 交互、虚线 = 依赖（L18，ADR-0035），由画布按临时线种类取（edgeStyle）。
 */
import {
  CARRIER_ROLE_TEXT,
  CARRIER_TEMPLATE_LABELS,
  CARRIER_VERDICT_LABELS,
  callbackPairs,
  callbackText,
  isCallbackVia,
  moduleName,
  nodeOf as nodeOfModule,
  parseVia,
  relationMode,
  type EdgeFact,
  type ModelDiff,
  type ModelIndex,
  type ViewEdge,
} from '@/model'
import {
  coreHandleBadges,
  edgeLabel,
  edgeRoute,
  edgeWeight,
  handleBadge,
  isBoundaryEdge,
  linkRoute,
  spreadEdgeId,
  type Box,
  type EdgeRoute,
  type HandleBadge,
  type Point,
} from '../layout'
import { isTemp, landingId } from '../stage'
import type { SceneContext } from './context'
import { DEP_KIND_LABELS, DEP_TIER_LABELS, ELEMENT_KIND_LABELS, depViewEdge, depWeight, elementAt, inImpact, routeToPoint } from './structure'
import { composeLabel, hasWarnTag, type TagPart } from './labels'
import { depLabel } from './structure'
import type { CanvasEdge, EdgeArrow, FactState, RouteEdgeData } from './types'

/** K9：证实状态（只进数据与面板，不改线型——L10、ADR-0035） */
const factState = (fact: EdgeFact | undefined): FactState => (fact === 'unconfirmed' || fact === 'partial' ? 'unconfirmed' : 'confirmed')

/** K9、L26：边上未证实的关系——有逐条证实时按关系计条数，否则退回视图边的证实标记（部分证实时条数未知） */
function unconfirmedOf(ctx: SceneContext, e: ViewEdge): { ids: string[]; count?: number } | null {
  const facts = ctx.facts
  if (!facts) return null
  if (facts.unconfirmed) {
    const ids = e.relationIds.filter(id => facts.unconfirmed!.has(id))
    return ids.length ? { ids, count: ids.length } : null
  }
  const f = facts.edgeFacts.get(e.id)
  if (f === 'unconfirmed') return { ids: [...e.relationIds], count: e.relationIds.length }
  return f === 'partial' ? { ids: [] } : null
}

/** L26⑤：未证实的悬停——逐条列出，缺的依赖写在后面 */
function unconfirmedTitle(ctx: SceneContext, ids: readonly string[]): string | undefined {
  if (!ids.length) return undefined
  const line = (id: string) =>
    `${relationText(ctx.input.index, id)}——${ctx.facts?.unconfirmed?.get(id)?.isolated ? '两端之间没有任何代码依赖（K6）' : '代码里没有与它相符的依赖（K5）'}`
  return ['未证实（K9）：', ...ids.map(line)].join('\n')
}

/** L10：同步（含同步与异步混合）实心；异步空心（通知一律异步，relationMode） */
export const arrowOf = (e: ViewEdge): EdgeArrow => (e.mode === 'async' ? 'open' : 'closed')

/** L12：视图边（含聚合边、经由上层的临时线）里有任一条关系经端口（via: port:<P>，含迁移期的「端口未指明」）即画插座 */
export const viaPort = (idx: ModelIndex | null, e: ViewEdge): boolean =>
  !!idx && e.relationIds.some(id => parseVia(idx.relations.get(id)?.via)?.kind === 'port')

/** L24：视图边里经回调（via: channel:callback）的关系 */
export const callbackRelations = (idx: ModelIndex | null, e: ViewEdge): string[] =>
  idx ? e.relationIds.filter(id => isCallbackVia(idx.relations.get(id)?.via)) : []

/** L24：边的悬停里经回调的说明；聚合边逐条列出 */
function callbackTitle(idx: ModelIndex | null, ids: readonly string[], aggregate: boolean): string | undefined {
  if (!idx || !ids.length) return undefined
  if (!aggregate) return callbackText(idx, ids[0])
  return ids.map(id => `${id}：${callbackText(idx, id)}`).join('\n')
}

/** 临时线用的视图边外形；经由上层关系时取该关系的类型与同步 / 异步（P15；通知一律异步） */
function tempEdge(idx: ModelIndex | null, id: string, from: string, to: string, relationId?: string): ViewEdge {
  const r = relationId ? idx?.relations.get(relationId) : undefined
  return { id, kind: 'direct', from, to, type: r?.type ?? 'calls', relationIds: relationId ? [relationId] : [], mode: r ? relationMode(r) : 'sync' }
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

/**
 * 边的层级：激活的边（与聚焦对象相邻、选中、回放当前或走过）浮在节点之上——高于 Vue Flow 选中节点的 1000，
 * 不被途经的节点盖住；其余边在模块节点之下、带之上。步骤徽标与分支预览（节点）再高一档（nodes.ts）。
 */
export const EDGE_Z = { idle: 1, active: 1001, current: 1002 } as const

/** L27：边的一端是聚焦对象（选中或悬停的节点） */
const touchesFocus = (ctx: SceneContext, e: { from: string; to: string }) => ctx.focusIds.some(f => e.from === f || e.to === f)
/** L27：边的一端是悬停的节点（悬停叠加在影响面查询、边聚焦之上） */
const touchesHover = (ctx: SceneContext, e: { from: string; to: string }) => !!ctx.hoverFocus && (e.from === ctx.hoverFocus || e.to === ctx.hoverFocus)

/** 运行视角：按舞台显示（V5、V8）；分层总览：层间边在聚焦核心模块时变淡；普通层次：与聚焦对象无关的边变淡 */
function edgeDim(ctx: SceneContext, e: ViewEdge, core: boolean, selected: boolean, played: boolean): boolean {
  if (ctx.st) return !played && !selected && (ctx.display?.edges.get(e.id) ?? 'show') === 'dim'
  if (ctx.layered) return !!ctx.near && !core && !selected
  return !!ctx.near && !touchesFocus(ctx, e) && !selected
}

/**
 * 走线的中点：曲线取两端点的中点，折线按长度取一半处。
 * elk 不一定给每个标签槽返回坐标；没有标签坐标而要画标签（×N、?）时落在这里，不能退到画布原点。
 */
export function routeMidpoint(route: EdgeRoute): { x: number; y: number } {
  const pts = route.points
  if (route.curve || pts.length < 2) {
    const a = pts[0] ?? { x: 0, y: 0 }
    const b = pts[pts.length - 1] ?? a
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }
  const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y))
  let rest = lens.reduce((n, l) => n + l, 0) / 2
  for (let i = 0; i < lens.length; i++) {
    if (rest <= lens[i] && lens[i] > 0) {
      const t = rest / lens[i]
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t }
    }
    rest -= lens[i]
  }
  return pts[pts.length - 1]
}

/** makeEdge 的附加数据：tags 为这条线自带的 L26 标签（缺段、经上层、未建模、叠加线的计数），与关系边的标签一起按词表次序合并 */
type EdgeExtra = Partial<RouteEdgeData> & { tags?: TagPart[] }

function makeEdge(ctx: SceneContext, e: ViewEdge, route0: EdgeRoute | undefined, core: boolean, extra0: EdgeExtra = {}): CanvasEdge | null {
  if (!route0) return null
  const { tags, ...extra } = extra0
  const selected = ctx.selectedEdgeIds.has(e.id)
  const play = playOf(ctx, e.id)
  const fact = ctx.facts?.edgeFacts.get(e.id)
  const state = factState(fact)
  // L26④：运行视角下走过的边由步骤序号标注，不标条数，标签照写；L23b：收起的交互束条数带把手数
  const quiet = !!ctx.st && !!play.play
  const head = quiet ? '' : (extra.handles ?? edgeLabel(e))
  const total = e.relationIds.length
  // L26②：标签位按词表次序合并——违规（K9）、未证实（K9；③分层总览只写在聚合边上、总带条数）、回调（L24）、混合（D8）
  const violated = !!ctx.facts?.violatedEdges.has(e.id)
  const unc = unconfirmedOf(ctx, e)
  const uncTag: TagPart | null = !unc
    ? null
    : ctx.layered
      ? total > 1
        ? { tag: '未证实', count: unc.count }
        : null
      : { tag: '未证实', count: unc.count, total }
  const callbacks = callbackRelations(ctx.input.index, e)
  const parts: (TagPart | null)[] = [
    violated && !extra.temp ? { tag: '违规' } : null,
    uncTag,
    callbacks.length ? { tag: '回调', count: callbacks.length, total } : null,
    extra.mixed ? { tag: '混合' } : null,
    ...(tags ?? []),
  ]
  const label = extra.label ?? composeLabel(head, parts)
  const route = label && !route0.label ? { ...route0, label: routeMidpoint(route0) } : route0
  // L24：悬停说明接在其余说明之后；配对的正向关系供悬停时一起高亮（L25）；L26⑤：未证实逐条列出
  const cbTitle = callbackTitle(ctx.input.index, callbacks, total > 1)
  const pairs = ctx.input.index ? [...new Set(callbacks.flatMap(id => callbackPairs(ctx.input.index!, id)))] : []
  const vioTitle = violated && !extra.temp ? '违规（K9）：这对节点之间有基线外的违规依赖（面板列出）' : ''
  const title = [extra.title, vioTitle, uncTag ? unconfirmedTitle(ctx, unc!.ids) : '', cbTitle].filter(Boolean).join('\n\n') || undefined
  return {
    id: core ? `core:${e.id}` : e.id,
    source: e.from,
    target: e.to,
    type: 'route',
    zIndex: play.play === 'current' ? EDGE_Z.current : selected || play.play || touchesFocus(ctx, e) ? EDGE_Z.active : EDGE_Z.idle,
    data: {
      route,
      edge: e,
      label,
      ...(label ? { pill: true } : {}),
      ...(hasWarnTag(parts) ? { warn: true } : {}),
      factState: state,
      arrow: arrowOf(e),
      weight: edgeWeight(e),
      ...(viaPort(ctx.input.index, e) ? { port: true } : {}),
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
      ...(callbacks.length ? { callback: true } : {}),
      ...(pairs.length ? { callbackPairs: pairs } : {}),
      ...(title ? { title } : {}),
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

/** 本层画出来的视图边（舞台显示与边界边的显隐之后）；结构视角不画交互边 */
export const shownEdges = (ctx: SceneContext): ViewEdge[] => (ctx.structure ? [] : ctx.pv.view.edges.filter(e => stageShown(ctx, e) && boundaryShown(ctx, e)))

/** 交互边：本层视图边，分层总览另加显示的核心跨层边，另加显示的共用件的边（O10）；框外边取按可见集分配轨道后的走线（ctx.routes）。结构视角为空 */
export function interactionEdges(ctx: SceneContext): (CanvasEdge | null)[] {
  const { pv } = ctx
  if (ctx.structure) return []
  const list = shownEdges(ctx).flatMap(e => spreadEdges(ctx, e, ctx.routes.get(e.id) ?? edgeRoute(pv, e)))
  // O4、L23b：核心跨层边带把手角标与悬停分组（总览不展开表面）
  const badges = ctx.layered && ctx.input.index && !ctx.st ? coreHandleBadges(pv.view, ctx.input.index) : null
  if (ctx.layered) list.push(...ctx.visibleCoreEdges.map(e => makeEdge(ctx, e, pv.coreEdges.get(e.id), true, withHandles(mixedOf(ctx, e), badges?.get(e.id)))))
  // O10：共用件的边不参与布局，悬停 / 选中一端时画成曲线
  list.push(
    ...ctx.visibleShelfEdges.map(e =>
      makeEdge(ctx, e, linkRoute(pv.nodes.get(e.from), pv.nodes.get(e.to)), false, { shelf: true, dim: false, ...mixedOf(ctx, e) }),
    ),
  )
  return list
}

/**
 * L23b：收起的交互束——角标 `×N · M 把手`（M 为 0 只写 ×N）、悬停按所属子模块分组列出各条；束内修饰不一致时「混合」的说明接在后面。
 * 散开到元素的各段与运行视角不带（ADR-0033）。
 */
function withHandles(extra: Partial<RouteEdgeData>, badge: HandleBadge | null | undefined): Partial<RouteEdgeData> {
  if (!badge?.label) return extra
  return { ...extra, handles: badge.label, title: [badge.title, extra.title].filter(Boolean).join('\n\n') }
}

/** L23b：普通层次的交互视图边的把手角标（运行视角不给） */
const badgeOf = (ctx: SceneContext, e: ViewEdge): HandleBadge | null =>
  ctx.st || ctx.layered || !ctx.input.index ? null : handleBadge(ctx.input.index, ctx.pv.view, e)

/** D8：束内修饰不一致——「混合」记号与悬停列出各条（运行视角不标） */
function mixedOf(ctx: SceneContext, e: ViewEdge): Partial<RouteEdgeData> {
  const sp = ctx.st ? null : ctx.input.spreads?.get(e.id)
  if (!sp?.mixed) return {}
  const what = [sp.mixed.mode ? '同步 / 异步' : '', sp.mixed.via ? 'via' : ''].filter(Boolean).join('、')
  return { mixed: true, title: [`束内${what}不一致（D8）：`, ...e.relationIds.map(id => relationText(ctx.input.index, id))].join('\n') }
}

/**
 * D7、L23：接收方表面展开时，交互束按关系的接口散开到对应元素——每个元素一段（取布局里接到元素端口的那条走线），
 * 没写接口（或元素不在本层展开里）的留在原视图边上接到模块本体；只画被交互接到的元素。框外边与运行视角不散开。
 */
function spreadEdges(ctx: SceneContext, e: ViewEdge, route: EdgeRoute | undefined): (CanvasEdge | null)[] {
  const sp = ctx.input.spreads?.get(e.id)
  const placed = ctx.pv.elements?.get(e.to)
  const mixed = mixedOf(ctx, e)
  const whole = () => [makeEdge(ctx, e, route, false, withHandles(mixed, badgeOf(ctx, e)))]
  if (ctx.st || !sp || !placed) return whole()
  const groups = new Map<string, string[]>()
  for (const it of sp.items) {
    const name = it.element?.name
    if (name && placed.some(p => p.name === name) && ctx.pv.edges.has(spreadEdgeId(e.id, name))) groups.set(name, [...(groups.get(name) ?? []), it.relation])
  }
  if (!groups.size) return whole()
  const sel = ctx.input.selection
  const out: (CanvasEdge | null)[] = []
  for (const [name, rels] of groups) {
    const id = spreadEdgeId(e.id, name)
    if ((sel?.kind === 'relation' && rels.includes(sel.id)) || (sel?.kind === 'edge' && sel.id === e.id)) ctx.selectedEdgeIds.add(id)
    const part: ViewEdge = { ...e, id, relationIds: rels }
    out.push(makeEdge(ctx, part, ctx.pv.edges.get(id), false))
  }
  const rest = e.relationIds.filter(id => ![...groups.values()].some(r => r.includes(id)))
  if (rest.length) out.push(makeEdge(ctx, { ...e, relationIds: rest }, route, false, mixed))
  return out
}

/** C6、L23：交互视角里被画出来的散开段接到的元素（节点上只画这些元素记号） */
export function spreadHits(ctx: SceneContext): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  if (ctx.st || ctx.structure) return out
  for (const e of shownEdges(ctx)) {
    const sp = ctx.input.spreads?.get(e.id)
    const placed = ctx.pv.elements?.get(e.to)
    if (!sp || !placed) continue
    for (const it of sp.items) {
      const name = it.element?.name
      if (name && placed.some(p => p.name === name) && ctx.pv.edges.has(spreadEdgeId(e.id, name)))
        (out.get(e.to) ?? out.set(e.to, new Set()).get(e.to)!).add(name)
    }
  }
  // L22：承载段接到的元素也画
  for (const seg of ctx.input.carrier?.segments ?? []) {
    const el = seg.edge?.element?.name
    const b = seg.edge ? projectNode(ctx, seg.edge.toModule) : null
    if (el && b && ctx.pv.elements?.get(b)?.some(p => p.name === el)) (out.get(b) ?? out.set(b, new Set()).get(b)!).add(el)
  }
  return out
}

/** 回放叠加的边：P11、P15 本层没有视图边的消息画临时线，不参与布局——经由上层关系为关系类型色的实线、标「经上层」，未建模为红色实线、标「未建模」（L18、L26）；分支预览同样画临时线 */
export function replayEdges(ctx: SceneContext): (CanvasEdge | null)[] {
  const { st, emphEdges } = ctx
  if (!st) return []
  const idx = ctx.input.index
  const list = st.temps.map(u =>
    makeEdge(ctx, tempEdge(idx, u.edgeId, u.from, u.to, u.relationId), u.route, false, {
      temp: u.kind,
      tags: [{ tag: u.kind === 'upper' ? '经上层' : '未建模' }],
      muted: !!emphEdges && !emphEdges.has(u.edgeId),
    }),
  )
  for (const p of st.previews) {
    if (!isTemp(p.at) || !p.route) continue
    const id = landingId(p.at)
    const rel = p.at.kind === 'upper' ? p.at.relationId : undefined
    if (!st.walked.has(id))
      list.push(
        makeEdge(ctx, tempEdge(idx, id, p.at.from, p.at.to, rel), p.route, false, { temp: p.at.kind, play: 'preview', label: '', pill: false, warn: false }),
      )
  }
  return list
}

/** 盒子边框上朝向另一点的出口（中心连线与边框的交点） */
function borderPoint(box: Box, toward: Point): Point {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const dx = toward.x - cx
  const dy = toward.y - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const t = Math.min(dx === 0 ? Infinity : box.w / 2 / Math.abs(dx), dy === 0 ? Infinity : box.h / 2 / Math.abs(dy))
  return { x: cx + dx * t, y: cy + dy * t }
}

/** J5：耦合线的走线——两框中心连线裁到边框，直线两点（画布按它画波浪线），不参与布局 */
export function coupleRoute(a?: Box, b?: Box): EdgeRoute | undefined {
  if (!a || !b) return undefined
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const p1 = borderPoint(a, cb)
  const p2 = borderPoint(b, ca)
  return { points: [p1, p2], label: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } }
}

/** F7（L44）：时间耦合线不进布局，只能临时出现——聚焦（选中或悬停）一端、或选中这对耦合时画；常显的只剩面板清单与画布角计数 */
export const coupleShown = (ctx: Pick<SceneContext, 'focusIds' | 'input'>, l: { from: string; to: string; pairs: readonly string[] }): boolean =>
  ctx.focusIds.some(f => f === l.from || f === l.to) || (ctx.input.selection?.kind === 'couple' && l.pairs.includes(ctx.input.selection.id))

/** 时间耦合（J5）：本层两端之间的灰色波浪线，标 ×N，无依赖无关系的更深色；不参与布局、不算跳线；按需显示（F7，L44） */
export function evolutionEdges(ctx: SceneContext): (CanvasEdge | null)[] {
  return (ctx.evo?.couplings ?? [])
    .filter(l => coupleShown(ctx, l))
    .map(l => {
      const ve: ViewEdge = { id: l.id, kind: 'direct', from: l.from, to: l.to, type: 'calls', relationIds: [], mode: 'sync' }
      const route = coupleRoute(ctx.pv.nodes.get(l.from), ctx.pv.nodes.get(l.to))
      return makeEdge(ctx, ve, route, false, {
        temp: 'couple',
        label: `×${l.shared}`,
        pill: true,
        warn: false,
        factState: 'confirmed',
        couple: l,
        violated: false,
      })
    })
}

/**
 * L44（第十四轮 F12）：常显的线必须进布局、被 L30 测量，否则只能临时出现——代码依赖叠加线两端都在本层的常显，取并集布局里同一对节点的束的走线；
 * 一端是边界节点的同框外的交互边（L4）只在聚焦一端或选中它时画，与此刻画出来的框外边一起分轨（overlayViewEdges 交给 outsideRoutes），画布角计数。
 */
export function overlayShown(
  ctx: Pick<SceneContext, 'focusIds' | 'input'>,
  o: { id: string; from: string; to: string; fromModule: string; toModule: string },
): boolean {
  const outside = o.from.startsWith('boundary:') || o.to.startsWith('boundary:')
  if (!outside) return true
  const sel = ctx.input.selection
  return ctx.focusIds.some(f => f === o.from || f === o.to) || (sel?.kind === 'dep' && sel.id === `${o.fromModule}->${o.toModule}`)
}

/** L44：交给 outsideRoutes 一起分轨的叠加线（一端是边界节点、此刻画出来的） */
export function overlayViewEdges(ctx: Pick<SceneContext, 'facts' | 'focusIds' | 'input'>): ViewEdge[] {
  return (ctx.facts?.overlays ?? [])
    .filter(o => (o.from.startsWith('boundary:') || o.to.startsWith('boundary:')) && overlayShown(ctx, o))
    .map(o => ({ id: o.id, kind: 'direct', from: o.from, to: o.to, type: 'calls', relationIds: [], mode: 'sync' }))
}

/** L44：叠加线的标签文字（分轨时按实际尺寸避让） */
export const overlayTags = (o: { violations: number; undescribed: number }): TagPart[] => [
  ...(o.violations ? [{ tag: '违规' as const, count: o.violations }] : []),
  ...(o.undescribed ? [{ tag: '未解释' as const, count: o.undescribed }] : []),
]

/** 代码事实叠加（K9）：代码依赖叠加线（虚线，L18）；标「违规 N · 未解释 N」（L26）；走线进布局（L44） */
export function factEdges(ctx: SceneContext): (CanvasEdge | null)[] {
  return (ctx.facts?.overlays ?? [])
    .filter(o => overlayShown(ctx, o))
    .map(o => {
      const tags = overlayTags(o)
      const ve: ViewEdge = { id: o.id, kind: 'direct', from: o.from, to: o.to, type: 'calls', relationIds: [], mode: 'sync' }
      // L44：框外的与框外边一起分轨；两端都在本层的取同一对节点的束在并集布局里的走线；都没有时（分层总览）退回曲线
      const route = ctx.routes.get(o.id) ?? ctx.pv.edges.get(`bundle:${o.from}->${o.to}`) ?? linkRoute(ctx.pv.nodes.get(o.from), ctx.pv.nodes.get(o.to))
      return makeEdge(ctx, ve, route, false, {
        temp: 'code',
        tags,
        factState: 'undescribed',
        overlay: o,
        ...(o.violations ? { violated: true } : {}),
      })
    })
}

/** O12：组装叠加线——组装事实投影到本层的虚线（组装专用色，依赖方一端实心菱形，L18、L16），不参与布局；同一对节点合并标 ×N；单击落到这对节点的代码依赖（K10） */
export function assemblyEdges(ctx: SceneContext): (CanvasEdge | null)[] {
  if (ctx.st || ctx.structure) return []
  // L44：两端都在本层的取并集布局里同一对节点的束的走线；一端是边界节点的只在聚焦一端时画（同 L4）
  const outside = (o: { from: string; to: string }) => o.from.startsWith('boundary:') || o.to.startsWith('boundary:')
  return (ctx.input.assembly ?? [])
    .filter(o => !outside(o) || ctx.focusIds.some(f => f === o.from || f === o.to))
    .map(o => {
      const ve: ViewEdge = { id: o.id, kind: 'direct', from: o.from, to: o.to, type: 'calls', relationIds: [], mode: 'sync' }
      const route = ctx.pv.edges.get(`bundle:${o.from}->${o.to}`) ?? linkRoute(ctx.pv.nodes.get(o.from), ctx.pv.nodes.get(o.to))
      return makeEdge(ctx, ve, route, false, {
        temp: 'assembly',
        label: o.count > 1 ? `×${o.count}` : '',
        factState: 'confirmed',
        assembly: o,
        violated: false,
      })
    })
}

/**
 * L15、L16、L21、C6：结构视角的结构边——画出来的束、散开的元素级边与跨层依赖（structureScene 的显隐之后），编码数据交给 DepEdge（UML 类图惯例）。
 * 标签只有角标与异常标记（L26 标签位）：形态不止一种的束「×N 元素」（L21①）、违规（U15 基线外）、未解释（K17）、越过入口（C3）、逆稳定（U17，浅色）；
 * 变淡：影响面查询生效时两端不都在闭包里的边；选中束时不在聚焦里的（B3）；否则与选中、悬停的节点都无关的边（共享通道，L27）；与悬停节点相连的边总不变淡。
 */
export function depEdges(ctx: SceneContext): (CanvasEdge | null)[] {
  const sc = ctx.structure
  if (!sc) return []
  const nodeOf = (id: string) => ctx.pv.view.nodes.find(n => n.id === id) ?? { id }
  return sc.shown.map(e => {
    const route0 = sc.routes.get(e.id)
    if (!route0) return null
    const selected = sc.selected.has(e.id)
    const unfocused = !!sc.focus && !sc.focus.has(e.bundle ?? e.id) && !e.chip
    // L27：悬停的一跳叠加在影响面查询（K15b）与边聚焦（L21④）之上
    const dim =
      !selected &&
      !touchesHover(ctx, e) &&
      (sc.impact ? !(inImpact(sc, nodeOf(e.from)) && inImpact(sc, nodeOf(e.to))) : unfocused || (!!ctx.near && !touchesFocus(ctx, e)))
    const { label, tags } = depLabel(e.look)
    const route = label && !route0.label ? { ...route0, label: routeMidpoint(route0) } : route0
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      type: 'dep' as const,
      // 同交互边（L11）：与聚焦对象相邻或选中的浮在节点之上，其余在节点之下
      zIndex: selected || touchesFocus(ctx, e) ? EDGE_Z.active : EDGE_Z.idle,
      data: {
        route,
        edge: depViewEdge(e),
        label,
        ...(hasWarnTag(tags) || e.look.bypass ? { warn: true } : {}),
        factState: 'confirmed' as const,
        arrow: 'open' as const,
        weight: depWeight(e.look.deps),
        selected,
        dim,
        ...(e.chip ? { core: true } : {}),
        dep: e.look,
      },
    }
  })
}

/**
 * L22 反向：结构视角选中一条束时，它承载的交互（K17 覆盖明细）在同一画布上临时画出并高亮——取并集布局里这些交互边的走线
 * （两个视角共用一份布局，交互边本就有走线），不参与布局与跳线；单击选中那条交互。
 */
export function carriedEdges(ctx: SceneContext): (CanvasEdge | null)[] {
  const sc = ctx.structure
  if (!sc?.carried.length) return []
  const { pv } = ctx
  const want = new Set(sc.carried)
  const seen = new Set<string>()
  const out: (CanvasEdge | null)[] = []
  for (const e of [...pv.view.edges, ...(pv.view.coreEdges ?? [])]) {
    const rel = e.relationIds.filter(id => want.has(id))
    if (!rel.length || seen.has(e.id)) continue
    seen.add(e.id)
    const core = !!pv.view.coreEdges?.includes(e)
    const route = (core ? pv.coreEdges.get(e.id) : (pv.edges.get(e.id) ?? edgeRoute(pv, e))) ?? linkRoute(pv.nodes.get(e.from), pv.nodes.get(e.to))
    if (!route) continue
    const idx = ctx.input.index
    const ve: ViewEdge = { ...e, id: `carried:${e.id}`, kind: 'direct', relationIds: rel }
    out.push(
      makeEdge(ctx, ve, route, false, {
        temp: 'carried',
        factState: 'confirmed',
        selected: false,
        dim: false,
        title: ['这条束承载的交互（K17 覆盖，L22）：', ...rel.map(id => relationText(idx, id))].join('\n'),
      }),
    )
  }
  return out.map(e => (e ? { ...e, zIndex: EDGE_Z.active } : e))
}

/**
 * L22、D4：交互视角选中一条交互时它的承载段临时画在同一画布上并高亮——元素级边按结构视图的形态记号（DepEdge），
 * 接到元素端口（被依赖方展开时）或节点本体；缺的段画成警示色虚线、标「缺段」（L26）；两端投到本层同一节点或不在本层的段不画（面板定位）。不参与布局与跳线。
 */
export function carrierEdges(ctx: SceneContext): (CanvasEdge | null)[] {
  const c = ctx.input.carrier
  const idx = ctx.input.index
  if (!c || ctx.st || ctx.structure || !idx) return []
  const { pv } = ctx
  const out: (CanvasEdge | null)[] = []
  c.segments.forEach((seg, i) => {
    const a = projectNode(ctx, seg.edge?.fromModule ?? seg.from)
    const b = projectNode(ctx, seg.edge?.toModule ?? seg.to)
    if (!a || !b || a === b) return
    const role = CARRIER_ROLE_TEXT[seg.role](moduleName(idx, seg.from === '*' ? seg.to : seg.from), moduleName(idx, seg.to))
    const id = `carrier:${c.relation}:${i}`
    const ve: ViewEdge = { id, kind: 'direct', from: a, to: b, type: 'calls', relationIds: [], mode: 'sync' }
    if (seg.missing || !seg.edge) {
      if (!seg.missing) return
      const route = linkRoute(pv.nodes.get(a), pv.nodes.get(b))
      out.push(
        makeEdge(ctx, ve, route, false, {
          temp: 'carrier-gap',
          tags: [{ tag: '缺段' }],
          factState: 'unconfirmed',
          selected: false,
          dim: false,
          title: `承载（${CARRIER_TEMPLATE_LABELS[c.template]}）缺段：${role}——代码里没有这一段依赖（K5d）`,
        }),
      )
      return
    }
    const e = seg.edge
    const el = e.element?.name
    const route = routeToPoint(pv.nodes.get(a), elementAt(pv, b, el), pv.nodes.get(b))
    if (!route) return
    out.push({
      id,
      source: a,
      target: b,
      type: 'dep',
      zIndex: EDGE_Z.active,
      data: {
        route,
        edge: ve,
        label: seg.moduleLevel ? '模块级' : '',
        factState: 'confirmed',
        arrow: 'open',
        weight: 1,
        selected: true,
        dim: false,
        temp: 'carried',
        dep: {
          kind: e.form,
          tier: e.tier,
          fromModule: e.fromModule,
          toModule: e.toModule,
          deps: 1,
          files: e.files.length,
          carrier: true,
          ...(e.element ? { element: { name: e.element.name, kind: e.element.kind } } : {}),
          title: [
            `承载（${CARRIER_TEMPLATE_LABELS[c.template]} · ${CARRIER_VERDICT_LABELS[c.verdict]}）：${role}`,
            `${DEP_KIND_LABELS[e.form]}（${DEP_TIER_LABELS[e.tier]}）：${moduleName(idx, e.fromModule)} → ${moduleName(idx, e.toModule)}${e.element ? ` · ${e.element.name}（${ELEMENT_KIND_LABELS[e.element.kind]}）` : ''}`,
            ...(seg.moduleLevel ? ['只在模块级成立（边接到模块本体或别的元素，K5 回退）'] : []),
            ...e.files.slice(0, 3).map(f => `${f.from}:${f.line}`),
          ].join('\n'),
        },
      },
    })
  })
  return out
}

/** 一条关系的一行说明：两端、类型、修饰与说明（悬停用） */
export function relationText(idx: ModelIndex | null, id: string): string {
  const r = idx?.relations.get(id)
  if (!r || !idx) return id
  const mods = [
    r.type,
    r.mode === 'async' ? '异步' : r.type === 'queries' || r.type === 'commands' ? '同步' : '',
    r.via ? `via ${r.via}` : '',
    r.interface ? `接口 ${r.interface}` : '',
  ]
  return `${moduleName(idx, r.from)} → ${moduleName(idx, r.to)}（${mods.filter(Boolean).join(' · ')}）${r.description ? `：${r.description}` : ''}`
}

/** 模块在本层的投影节点（自身、边界节点或所在的祖先节点）；不在本层为 null */
export function projectNode(ctx: SceneContext, module: string): string | null {
  const idx = ctx.input.index
  const v = ctx.pv.view
  if (!idx || module === '*') return null
  return nodeOfModule(idx, v, new Set(v.nodes.map(n => n.id)), module)
}

/** L22：承载叠加涉及的节点（变淡的例外）：交互两端与各段两端在本层的投影 */
export function carrierNodes(ctx: Pick<SceneContext, 'input' | 'pv'>): Set<string> | null {
  const c = ctx.input.carrier
  const idx = ctx.input.index
  if (!c || !idx) return null
  const v = ctx.pv.view
  const present = new Set(v.nodes.map(n => n.id))
  const out = new Set<string>()
  const r = idx.relations.get(c.relation)
  for (const m of [r?.from, r?.to, ...c.segments.flatMap(s => [s.edge?.fromModule ?? s.from, s.edge?.toModule ?? s.to])]) {
    if (!m || m === '*') continue
    const n = nodeOfModule(idx, v, present, m)
    if (n) out.add(n)
  }
  return out
}
