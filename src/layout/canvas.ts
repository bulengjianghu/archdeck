/**
 * 画布场景（ADR-0013）：把带坐标的层次视图换成画布要画的节点与边——位置、类型、数据（选中、变淡、设计版本标记、回放态、
 * 选中突出的灰化）、类名、层级，以及运行视角下适应画布用的可见节点。纯函数，与 stageOverlay、stageDisplay 同属 Layout；
 * 画布组件只把结果写入 Vue Flow、把交互转成操作。规则见 docs/architecture/workbench.md §4。
 *   结构视角：聚焦对象（悬停优先、其次选中）不相邻的节点与边变淡；核心跨层边只在聚焦核心模块时出现（O4）；边界边只在聚焦其一端或被选中时出现（L4）。
 *   运行视角：舞台显示决定显隐与淡化（V5、V8、V9、V10）；回放叠加（P7、P10、P11、P15、F6）；选中步骤时其余走过的边与步骤序号变灰（R15、R16）。
 *   选中文件：归属模块在本层的投影节点加文件高亮（G14）。
 *   代码事实（结构视角、开关开启，K9、Y4）：关系边标证实、含违规的边红色描边、未描述依赖与违规画成不参与布局的叠加线、本层环的节点标编号。
 */
import {
  FIELD_LABELS,
  moduleName,
  type ActorEntity,
  type ActorKind,
  type DepOverlay,
  type EdgeFact,
  type LevelFacts,
  type ModelDiff,
  type ModelIndex,
  type ModuleEntity,
  type ScenarioLevelView,
  type ViewEdge,
  type ViewNode,
  type VisibleLanding,
} from '@/model'
import { edgeLabel, isBoundaryEdge, linkRoute, moreChipId, type Box, type EdgeRoute, type PositionedView } from './layout'
import { isTemp, landingId, stageDisplay, type StageDisplay, type StageOverlay, type StaticMode, type TempLine, type Visibility } from './stage'

/** 画布节点的公共数据 */
export interface NodeData {
  moduleId: string
  name: string
  module?: ModuleEntity
  childCount: number
  selected: boolean
  /** 结构视角有聚焦对象（悬停 / 选中）时，与它无关的节点变淡；运行视角按舞台显示 */
  dim: boolean
  /** 边界节点：外部模块所在路径 */
  path?: string
  /** 带（层）专用 */
  band?: { abstraction?: string; mayDependOn: string[]; hiddenCount: number }
  /** +N 占位块 */
  hiddenCount?: number
  /** 设计版本：本模块相对对比基线新增或修改 */
  change?: 'added' | 'changed'
  /** 修改了哪些字段（显示用） */
  changedFields?: string
  /** 设计版本：涉及其子树或相关关系的变更条数 */
  touched?: number
  /** 外部参与者节点 */
  actor?: ActorEntity
  actorKind?: ActorKind
  /** 运行视角：步骤序号（结构图上的序号标记） */
  steps?: { n: number; frameId: string; current: boolean; muted?: boolean }[]
  /** 运行视角：分支点某个选项的预览 */
  preview?: { pointId: string; option: number; label: string }
  /** Y4：本层环的编号 */
  cycle?: number
}

export interface RouteEdgeData {
  route: EdgeRoute
  edge: ViewEdge
  label: string
  selected: boolean
  dim: boolean
  /** 核心跨层边，只在悬停/选中时出现 */
  core?: boolean
  /** 设计版本：边包含新增或修改的关系 */
  change?: 'added' | 'changed'
  /** 运行视角：当前消息、走过、分支预览、时序图悬停预览 */
  play?: 'current' | 'walked' | 'preview' | 'hover'
  /** R15：选中步骤时，不属于选中 / 配对消息的走过的边淡为灰色 */
  muted?: boolean
  /** 当前消息与边的箭头方向相反（P10） */
  flowReverse?: boolean
  /** 本层没有视图边时的临时线：经由上层关系（P15）/ 结构中未建模（P11）；代码依赖叠加线（K9） */
  temp?: TempLine['kind'] | 'code'
  /** K9：关系边的证实 */
  fact?: EdgeFact
  /** K9：边含违规 */
  violated?: boolean
  /** K9：代码依赖叠加线的内容 */
  overlay?: DepOverlay
}

export type CanvasNodeType = 'frame' | 'module' | 'boundary' | 'band' | 'core' | 'more' | 'actor' | 'step' | 'preview'

/** 与 Vue Flow 的节点同形 */
export interface CanvasNode {
  id: string
  type: CanvasNodeType
  position: { x: number; y: number }
  data: NodeData
  zIndex: number
  width: number
  height: number
  style: { width: string; height: string }
  selectable: false
  draggable: false
  connectable: false
  class?: string
}

/** 与 Vue Flow 的边同形；箭头类型由画布换成 Vue Flow 的枚举 */
export interface CanvasEdge {
  id: string
  source: string
  target: string
  type: 'route'
  zIndex: number
  markerEnd: { type: 'arrow' | 'arrowclosed'; color: string; width: number; height: number }
  data: RouteEdgeData
}

export interface CanvasInput {
  positioned: PositionedView | null
  index: ModelIndex | null
  selection: { kind: string; id: string } | null
  /** 悬停：视图节点 ID，或 `step:<帧 ID>`（悬停时序图消息） */
  hover: string | null
  /** 运行视角的舞台叠加；结构视角为 null */
  stage: StageOverlay | null
  scenarioView: ScenarioLevelView | null
  /** 选中突出：选中步骤所在的可见消息与配对消息（R15、R16）；选中的不是步骤时 selected 为 null */
  emphasis: { selected: number | null; paired: ReadonlySet<number> } | null
  /** 参与本场景的舞台节点（V5） */
  participants: ReadonlyMap<string, 'path' | 'other'>
  /** 静态关系显示方式与「在画布上显示」的节点（V8、V9） */
  mode: StaticMode
  reveal: readonly string[]
  /** 设计版本且开启「标出变更」时的差异；否则为 null */
  diff: ModelDiff | null
  /** G14：选中文件在本层投影的节点 */
  fileHits: ReadonlySet<string> | null
  /** 停在分支点时的分支点 ID（分支预览用） */
  branchPointId: string | null
  /** K9、Y4：结构视角下开启「代码事实」时的本层投影；否则为 null */
  facts?: LevelFacts | null
}

export interface CanvasScene {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  /** V5：运行视角隐藏了静态内容时只按这些节点适应画布；否则为 null（取全部内容） */
  visibleIds: Set<string> | null
}

/** K9：关系边的证实标记 */
const FACT_MARK: Record<EdgeFact, string> = { confirmed: '✓', partial: '◐', unconfirmed: '?' }

/** 临时线用的视图边外形；经由上层关系时取该关系的类型与同步 / 异步（P15） */
function tempEdge(idx: ModelIndex | null, id: string, from: string, to: string, relationId?: string): ViewEdge {
  const r = relationId ? idx?.relations.get(relationId) : undefined
  return { id, kind: 'direct', from, to, type: r?.type ?? 'calls', types: [], relationIds: relationId ? [relationId] : [], mode: r?.mode ?? 'sync' }
}

/** 画布场景各部分（节点、关系边、回放叠加、代码事实叠加）共用的派生 */
interface SceneContext {
  input: CanvasInput
  pv: PositionedView
  st: StageOverlay | null
  sv: ScenarioLevelView | null
  layered: boolean
  /** 结构视角下开启「代码事实」时的本层投影；运行视角为 null */
  facts: LevelFacts | null
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
}

export function canvasScene(input: CanvasInput): CanvasScene {
  if (!input.positioned) return { nodes: [], edges: [], visibleIds: null }
  const ctx = sceneContext(input, input.positioned)
  const nodes = input.index ? [...moduleNodes(ctx, input.index), ...replayNodes(ctx)] : []
  // 回放叠加只在运行视角、代码事实叠加只在结构视角，两者不同时出现
  const edges = [...structureEdges(ctx), ...replayEdges(ctx), ...factEdges(ctx)]
  return { nodes, edges: edges.filter((e): e is CanvasEdge => e !== null), visibleIds: visibleIdsOf(ctx.display) }
}

function sceneContext(input: CanvasInput, pv: PositionedView): SceneContext {
  const { stage: st, scenarioView: sv } = input
  const layered = pv.view.mode === 'layered'
  const facts = st ? null : (input.facts ?? null)
  const hoverLanding = hoverLandingOf(input.hover, sv)
  const focusId = focusOf(input, pv)
  const selectedEdgeIds = selectedEdgesOf(input, pv, facts)
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
    hoverLanding,
    focusId,
    selectedEdgeIds,
    playEdges,
    display: displayOf(input, pv, playEdges),
    emphMessages,
    emphEdges: emphEdgesOf(emphMessages, sv),
    visibleCoreEdges,
    near: nearOf(pv, layered, focusId, visibleCoreEdges),
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

function selectedEdgesOf({ selection: sel, stage: st }: CanvasInput, pv: PositionedView, facts: LevelFacts | null): Set<string> {
  if (sel?.kind === 'edge') return new Set([sel.id])
  if (sel?.kind === 'dep') return new Set((facts?.overlays ?? []).filter(o => `${o.fromModule}->${o.toModule}` === sel.id).map(o => o.id))
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
function visibleIdsOf(display: StageDisplay | null): Set<string> | null {
  if (!display || ![...display.nodes.values()].includes('hide')) return null
  return new Set([...display.nodes].filter(([, v]) => v !== 'hide').map(([id]) => id))
}

// ── 节点 ──

const visOf = (ctx: SceneContext, id: string): Visibility => ctx.display?.nodes.get(id) ?? 'show'
/** 运行视角：按舞台显示（V5、V8、V9）；结构视角：与聚焦对象无关的变淡 */
const dimmed = (ctx: SceneContext, id: string, base: boolean) => (ctx.st ? visOf(ctx, id) === 'dim' : base)
const farFromFocus = (ctx: SceneContext, id: string) => !!ctx.near && !ctx.near.has(id)

/** 运行视角下节点的回放态：当前消息的端点或内部活动、悬停预览 */
function playClass(ctx: SceneContext, id: string): string | undefined {
  if (!ctx.st) return undefined
  const cur = ctx.st.current?.at
  // P7：分层总览中同一层不同泳道之间的消息，带与两端的核心模块小块都标为活动
  const touches = (at: VisibleLanding | null | undefined) =>
    !!at && ((at.kind === 'internal' ? at.node === id : at.from === id || at.to === id) || at.lanes?.from === id || at.lanes?.to === id)
  if (touches(cur)) return cur!.kind === 'internal' ? 'play-current play-internal' : 'play-current'
  if (touches(ctx.hoverLanding)) return 'play-hover'
  return undefined
}

function placeNode(ctx: SceneContext, id: string, box: Box, type: CanvasNodeType, data: NodeData, zIndex: number): CanvasNode {
  return {
    id,
    type,
    position: { x: box.x, y: box.y },
    data,
    zIndex,
    width: box.w,
    height: box.h,
    style: { width: `${box.w}px`, height: `${box.h}px` },
    selectable: false,
    draggable: false,
    connectable: false,
    class: [playClass(ctx, id), ctx.input.fileHits?.has(id) ? 'file-hit' : ''].filter(Boolean).join(' ') || undefined,
  }
}

function diffOf(marks: ModelDiff | null, moduleId: string): Pick<NodeData, 'change' | 'changedFields' | 'touched'> {
  if (!marks) return {}
  const c = marks.module.get(moduleId)
  return {
    change: c?.kind === 'added' || c?.kind === 'changed' ? c.kind : undefined,
    changedFields: c?.fields?.map(f => FIELD_LABELS[f] ?? f).join('、'),
    touched: marks.touched.get(moduleId),
  }
}

/** 本层的模块、带、边界节点与参与者 */
function moduleNodes(ctx: SceneContext, idx: ModelIndex): CanvasNode[] {
  const { pv } = ctx
  const nodes: CanvasNode[] = []
  if (pv.frame) {
    const data = { moduleId: pv.view.parentId, name: moduleName(idx, pv.view.parentId), childCount: 0, selected: false, dim: false }
    nodes.push(placeNode(ctx, 'frame', pv.frame, 'frame', data, -1))
  }
  for (const n of pv.view.nodes) {
    const box = pv.nodes.get(n.id)
    if (!box || (ctx.st && visOf(ctx, n.id) === 'hide')) continue
    if (n.role === 'actor') nodes.push(actorNode(ctx, idx, n, box))
    else nodes.push(...moduleNode(ctx, idx, n, box))
  }
  return nodes
}

function actorNode(ctx: SceneContext, idx: ModelIndex, n: ViewNode, box: Box): CanvasNode {
  const sel = ctx.input.selection
  const a = idx.actors.get(n.moduleId)
  const data = { moduleId: n.moduleId, name: a?.name ?? n.moduleId, actor: a, actorKind: n.actorKind, childCount: 0 }
  return placeNode(
    ctx,
    n.id,
    box,
    'actor',
    { ...data, selected: sel?.kind === 'actor' && sel.id === n.moduleId, dim: dimmed(ctx, n.id, farFromFocus(ctx, n.id)) },
    2,
  )
}

function moduleNode(ctx: SceneContext, idx: ModelIndex, n: ViewNode, box: Box): CanvasNode[] {
  const sel = ctx.input.selection
  const m = idx.modules.get(n.moduleId)
  const base: NodeData = {
    moduleId: n.moduleId,
    name: m?.name ?? n.moduleId,
    module: m,
    childCount: idx.childrenOf.get(n.moduleId)?.length ?? 0,
    selected: sel?.kind === 'module' && sel.id === n.moduleId,
    // 分层总览中带不参与变淡，只有核心模块会
    dim: dimmed(ctx, n.id, farFromFocus(ctx, n.id) && !(ctx.layered && n.role === 'layer')),
    ...diffOf(ctx.input.diff, n.moduleId),
    ...(ctx.facts?.cycles.has(n.id) ? { cycle: ctx.facts.cycles.get(n.id) } : {}),
  }
  if (n.role === 'boundary') {
    const path = (idx.pathOf.get(n.moduleId) ?? []).slice(1, -1).map(id => idx.modules.get(id)?.name ?? id)
    return [placeNode(ctx, n.id, box, 'boundary', { ...base, path: path.length ? path.join(' / ') : idx.model.system.name }, 1)]
  }
  if (n.role === 'layer') return bandNodes(ctx, idx, n, box, base, m)
  return [placeNode(ctx, n.id, box, n.role === 'core' ? 'core' : 'module', base, 2)]
}

/** 分层总览的带（层）与它的 +N 占位块 */
function bandNodes(ctx: SceneContext, idx: ModelIndex, n: ViewNode, box: Box, base: NodeData, m: ModuleEntity | undefined): CanvasNode[] {
  const band = ctx.pv.view.bands?.find(b => b.layerId === n.id)
  const data: NodeData = {
    ...base,
    band: {
      abstraction: m?.abstraction,
      mayDependOn: (m?.mayDependOn ?? []).map(id => idx.modules.get(id)?.name ?? id),
      hiddenCount: band?.hiddenCount ?? 0,
    },
  }
  const out = [placeNode(ctx, n.id, box, 'band', data, 0)]
  const more = ctx.pv.nodes.get(moreChipId(n.id))
  if (more && band)
    out.push(placeNode(ctx, moreChipId(n.id), more, 'more', { ...base, selected: false, dim: !!ctx.st || !!ctx.near, hiddenCount: band.hiddenCount }, 2))
  return out
}

/** 回放叠加的节点：步骤序号（可单击指向该步）与分支预览序号（可单击选这一支） */
function replayNodes(ctx: SceneContext): CanvasNode[] {
  const { st, sv, emphMessages } = ctx
  if (!st || !sv) return []
  const blank = { moduleId: '', name: '', childCount: 0, selected: false, dim: false }
  const nodes: CanvasNode[] = []
  const current = st.current?.index
  for (const mark of st.walked.values()) {
    if (!mark.at) continue
    const steps = mark.steps.map(n => ({
      n,
      frameId: sv.messages[n - 1].frameIds[0],
      current: n - 1 === current,
      muted: !!emphMessages && !emphMessages.has(n - 1),
    }))
    nodes.push(placeNode(ctx, `step:${mark.edgeId}`, { ...mark.at, w: 1, h: 1 }, 'step', { ...blank, steps }, 6))
  }
  const pointId = ctx.input.branchPointId
  for (const p of st.previews) {
    if (!p.pos || !pointId) continue
    const preview = { pointId, option: p.option, label: p.label }
    nodes.push(placeNode(ctx, `preview:${p.option}`, { ...p.pos, w: 1, h: 1 }, 'preview', { ...blank, preview }, 7))
  }
  return nodes
}

// ── 边 ──

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
function structureEdges(ctx: SceneContext): (CanvasEdge | null)[] {
  const { pv } = ctx
  const list = pv.view.edges.filter(e => stageShown(ctx, e) && boundaryShown(ctx, e)).map(e => makeEdge(ctx, e, pv.edges.get(e.id), false))
  if (ctx.layered) list.push(...ctx.visibleCoreEdges.map(e => makeEdge(ctx, e, pv.coreEdges.get(e.id), true)))
  return list
}

/** 回放叠加的边：P11、P15 本层没有视图边的消息画临时线，不参与布局——经由上层关系为关系类型色的实线，未建模为红色虚线；分支预览同样画临时线 */
function replayEdges(ctx: SceneContext): (CanvasEdge | null)[] {
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
function factEdges(ctx: SceneContext): (CanvasEdge | null)[] {
  return (ctx.facts?.overlays ?? []).map(o => {
    const label = [o.undescribed ? `未描述 ${o.undescribed}` : '', o.violations ? `违规 ${o.violations}` : ''].filter(Boolean).join(' · ')
    const ve: ViewEdge = { id: o.id, kind: 'direct', from: o.from, to: o.to, type: 'depends', types: [], relationIds: [], mode: 'sync' }
    const route = linkRoute(ctx.pv.nodes.get(o.from), ctx.pv.nodes.get(o.to))
    return makeEdge(ctx, ve, route, false, { temp: 'code', label, overlay: o, ...(o.violations ? { violated: true } : {}) })
  })
}
