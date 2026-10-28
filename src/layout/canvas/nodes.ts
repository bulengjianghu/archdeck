/**
 * 画布场景的节点（ADR-0013）：本层的模块、带与 +N 占位块、边界节点、参与者；回放叠加的步骤序号与分支预览序号。
 * 结构视角按聚焦变淡，运行视角按舞台显示（V5、V8、V9）；回放态与文件高亮（G14）写进类名。
 */
import { moduleName, type ModelDiff, type ModelIndex, type ModuleEntity, type ViewNode, type VisibleLanding } from '@/model'
import { SHELF, bandShelfTop, moreChipId, type Box, type PositionedView } from '../layout'
import type { Visibility } from '../stage'
import type { SceneContext } from './context'
import { routeMidpoint, spreadHits } from './edges'
import { restMarks } from './marks'
import { inImpact, structureNodeMarks } from './structure'
import type { CanvasNode, CanvasNodeType, NodeData, NodePorts, NodeSurface, SurfaceMark } from './types'

const visOf = (ctx: SceneContext, id: string): Visibility => ctx.display?.nodes.get(id) ?? 'show'
/** 运行视角：按舞台显示（V5、V8、V9）；结构视角：与聚焦对象无关的变淡 */
const dimmed = (ctx: SceneContext, id: string, base: boolean) => (ctx.st ? visOf(ctx, id) === 'dim' : base)
const farFromFocus = (ctx: SceneContext, id: string) => !!ctx.near && !ctx.near.has(id)

/** 运行视角下节点的回放态：当前消息的端点或内部活动、悬停预览 */
function playClass(ctx: SceneContext, id: string): string | undefined {
  if (!ctx.st) return undefined
  const cur = ctx.st.current?.at
  // P7：分层总览中同一层不同泳道之间的消息，带与两端的核心模块小块都标为活动
  // P18：一端是共用件的消息落在另一端，架上经过的共用件同样高亮（不画临时线）
  const touches = (at: VisibleLanding | null | undefined) =>
    !!at &&
    ((at.kind === 'internal' ? at.node === id || !!at.shared?.includes(id) : at.from === id || at.to === id) || at.lanes?.from === id || at.lanes?.to === id)
  if (touches(cur)) return cur!.kind === 'internal' && cur!.node === id ? 'play-current play-internal' : 'play-current'
  if (touches(ctx.hoverLanding)) return 'play-hover'
  return undefined
}

/** J5：热度角标——本层投影里有这个节点时给出档位与种类 */
function heatOf(ctx: SceneContext, id: string): Pick<NodeData, 'heat'> {
  const h = ctx.evo?.heat.get(id)
  return h ? { heat: { ...h, kind: ctx.evo!.kind } } : {}
}

/** 两框重合时系统框外扩的量（px） */
const FRAME_GAP = 16
const sameBox = (a: Box, b: Box) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
const grow = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d })

/** 浮在激活的边（EDGE_Z）之上的节点：步骤徽标、分支预览、带内「+N」占位块（单击不被线挡住） */
const OVER_EDGES = { step: 1003, preview: 1004, more: 1003, surface: 1004 } as const

export function placeNode(ctx: SceneContext, id: string, box: Box, type: CanvasNodeType, data: NodeData, zIndex: number): CanvasNode {
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

function diffOf(marks: ModelDiff | null, moduleId: string): Pick<NodeData, 'change' | 'touched'> {
  if (!marks) return {}
  const c = marks.module.get(moduleId)
  return {
    change: c?.kind === 'added' || c?.kind === 'changed' ? c.kind : undefined,
    touched: marks.touched.get(moduleId),
  }
}

/** 本层的模块、带、边界节点与参与者 */
export function moduleNodes(ctx: SceneContext, idx: ModelIndex): CanvasNode[] {
  const { pv } = ctx
  const nodes: CanvasNode[] = []
  // A7、L4：框表示边界——根层只有系统框；下钻后外框为系统边界、内框为当前父模块，边界节点在两框之间，参与者在外框之外。
  // 没有框外元素时不画框（内容即全部）；本层有共用件或折叠时画父模块框，承载共用件架与计数（O9、O11）
  const graded = levelCounts(pv)
  const hits = ctx.structure || ctx.st ? null : spreadHits(ctx)
  const frameData = (id: string): NodeData => ({ moduleId: id, name: moduleName(idx, id), childCount: 0, selected: false, dim: false })
  // O11：计数与架的字样挂在代表当前父模块的框上
  const ownFrame = (id: string): NodeData => ({
    ...frameData(id),
    ...(graded ? { counts: graded } : {}),
    ...(pv.shelf && pv.parentFrame ? { shelfAt: pv.shelf.y - pv.parentFrame.y + SHELF.h / 2 } : {}),
  })
  const root = pv.view.parentId === idx.rootId
  if (pv.frame) {
    if (root || !pv.parentFrame)
      nodes.push(placeNode(ctx, 'frame', root ? (pv.parentFrame ?? pv.frame) : pv.frame, 'frame', root ? ownFrame(idx.rootId) : frameData(idx.rootId), -2))
    else {
      // 没有边界节点时两框重合：系统框向外让出一圈，内外框都看得见
      const sys = sameBox(pv.frame, pv.parentFrame) ? grow(pv.frame, FRAME_GAP) : pv.frame
      nodes.push(placeNode(ctx, 'frame', sys, 'frame', frameData(idx.rootId), -2))
      nodes.push(placeNode(ctx, 'frame:parent', pv.parentFrame, 'frame', ownFrame(pv.view.parentId), -1))
    }
  } else if (graded && pv.parentFrame && pv.view.mode !== 'layered')
    nodes.push(placeNode(ctx, root ? 'frame' : 'frame:parent', pv.parentFrame, 'frame', ownFrame(root ? idx.rootId : pv.view.parentId), -1))
  for (const n of pv.view.nodes) {
    const box = pv.nodes.get(n.id)
    if (!box || (ctx.st && visOf(ctx, n.id) === 'hide')) continue
    if (n.role === 'actor') nodes.push(actorNode(ctx, idx, n, box))
    else nodes.push(...moduleNode(ctx, idx, n, box, surfaceOf(ctx, n, box, hits)))
  }
  return nodes
}

/** O11：普通层次的本层计数——共用件数与折叠在「+N」里的模块数；两者都为 0 时为 null（分层总览的计数在各带上） */
export function levelCounts(pv: PositionedView): { shared: number; folded: number } | null {
  if (pv.view.mode === 'layered') return null
  const shared = pv.view.shelf?.length ?? 0
  const folded = pv.view.fold && !pv.view.fold.expanded ? pv.view.fold.members.length : 0
  return shared || folded ? { shared, folded } : null
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

/**
 * C6、L20、L23（ADR-0036）：展开表面的节点上的端口点——位置取布局在收起态节点上排出的点（相对节点），种类、扇入与使用者取 surfaceInfo；
 * 结构视角画全部点（被显示偏好收起的变淡），交互视角只画被交互（或承载段）接到的点；运行视角不画。
 * L20b：有属于子模块的元素时，悬停写「属于 <子模块>」（返工：画布上不写组名）。
 */
function surfaceOf(ctx: SceneContext, n: ViewNode, box: Box, hits: Map<string, Set<string>> | null): Pick<NodeData, 'surface'> {
  const placed = ctx.pv.elements?.get(n.id)
  if (!placed?.length || ctx.st) return {}
  const info = ctx.input.surfaceInfo?.get(n.moduleId)
  const used = ctx.structure ? ctx.structure.usedElements.get(n.id) : hits?.get(n.id)
  const idx = ctx.input.index
  const items: SurfaceMark[] = placed
    .filter(p => ctx.structure || used?.has(p.name))
    .map(p => {
      const x = info?.get(p.name)
      const users = x?.users?.map(u => (idx ? moduleName(idx, u) : u))
      return {
        name: p.name,
        x: p.x - box.x,
        y: p.y - box.y,
        used: !!used?.has(p.name),
        ...(x ? { kind: x.kind, fanIn: x.fanIn } : {}),
        ...(users?.length ? { users } : {}),
      }
    })
  // L20b（ADR-0036 返工）：不写组名，所属子模块只进悬停提示（组间隙由布局按 groups 留出）
  const subOf = (name: string) => info?.get(name)?.sub ?? null
  if (items.some(m => subOf(m.name) !== null))
    for (const m of items) {
      const sub = subOf(m.name)
      m.owner = sub && idx ? `${moduleName(idx, sub)}（${shortName(n.moduleId, sub)}）` : '本体'
    }
  // 交互视角没有被接到的元素时也给（空的）记号层：入边一侧照样让出
  const more = ctx.structure ? ctx.pv.elementsMore?.get(n.id) : undefined
  const surface: NodeSurface = { side: ctx.pv.direction === 'RIGHT' ? 'left' : 'top', items, ...(more ? { more } : {}) }
  return { surface }
}

/** L20b：子模块短名——ID 去掉父模块前缀（`pipeline.latency.timers` → `timers`） */
export const shortName = (parent: string, sub: string): string => (sub.startsWith(`${parent}.`) ? sub.slice(parent.length + 1) : sub.split('.').pop()!)

/** L13：一个节点的端口超过这么多个时合成一个「端口 ×N」 */
export const PORT_MERGE = 3

/**
 * L13：节点的端口记号——画在进边一侧的后半（L11：普通层次自左向右布局时为左边，其余为顶边）；运行视角不画（ports 为空）。
 * 分层总览只画核心模块的（state 层已按层次筛好）；实现者数为描述与代码事实的并集。
 */
function portsOf(ctx: SceneContext, idx: ModelIndex, n: ViewNode): Pick<NodeData, 'ports'> {
  // 运行视角不画；结构视角也不画（端口实现画成结构边，选中端口换成其定义模块，V12）；展开表面的节点由元素记号代替（入边一侧被元素占用）
  if (ctx.st || ctx.structure || ctx.pv.elements?.has(n.id)) return {}
  const list = ctx.input.ports?.get(n.moduleId)
  if (!list?.length) return {}
  const side = !ctx.layered && n.role !== 'boundary' && ctx.pv.direction === 'RIGHT' ? 'left' : 'top'
  const sel = ctx.input.selection
  const selected = sel?.kind === 'port' && list.some(p => p.port === sel.id) ? sel.id : undefined
  const items = list.map(p => ({ id: p.port, name: idx.interfaces.get(p.port)?.name ?? p.port, implementers: p.implementers.length }))
  const ports: NodePorts =
    items.length > PORT_MERGE
      ? { side, items: [], merged: items.length, ...(selected ? { selected } : {}) }
      : { side, items, ...(selected ? { selected } : {}) }
  return { ports }
}

function moduleNode(ctx: SceneContext, idx: ModelIndex, n: ViewNode, box: Box, surface: Pick<NodeData, 'surface'> = {}): CanvasNode[] {
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
    ...heatOf(ctx, n.id),
    ...(n.sharedCount ? { sharedCount: n.sharedCount } : {}),
    ...(n.core ? { core: true } : {}),
    ...(n.rim ? { rim: n.rim } : {}),
    ...(!ctx.structure && ctx.input.assemblyRoots?.get(n.id) ? { assemblyRoot: ctx.input.assemblyRoots.get(n.id) } : {}),
    ...portsOf(ctx, idx, n),
    // ADR-0031：结构视角换成指标、影响面、常显的环与按依赖计的「共用 ×N」（L17、K15、Y4、O13）
    ...(ctx.structure ? structureNodeMarks(ctx.structure, ctx.input, n) : {}),
    ...surface,
  }
  // K15：影响面生效时闭包外的节点变淡（带也参与）
  if (ctx.structure?.impact) base.dim = !inImpact(ctx.structure, n)
  // L37：写字的注记静息态最多 REST_MARKS 个；悬停或选中该节点时全部出现（带有自己的标题栏，不受此限）
  const open = base.selected || ctx.hoverFocus === n.id
  if (n.role !== 'layer') Object.assign(base, restMarks(base, open))
  if (n.role === 'boundary') {
    const path = (idx.pathOf.get(n.moduleId) ?? []).slice(1, -1).map(id => idx.modules.get(id)?.name ?? id)
    return [placeNode(ctx, n.id, box, 'boundary', { ...base, path: path.length ? path.join(' / ') : idx.model.system.name }, 1)]
  }
  if (n.role === 'layer') return bandNodes(ctx, idx, n, box, base, m)
  // O8：普通层次的「+N」占位（单击临时展开；z 序在边之上，单击不被线挡住）
  if (n.role === 'more')
    return [
      placeNode(
        ctx,
        n.id,
        box,
        'more',
        { ...base, name: '', selected: false, dim: !!ctx.st || !!ctx.near, hiddenCount: n.hiddenCount ?? 0, expanded: n.expanded ?? 0, graphFold: true },
        OVER_EDGES.more,
      ),
    ]
  // O9：共用件架上的紧凑块；运行视角下照常显示但淡化（P18）
  if (n.role === 'shared') return [placeNode(ctx, n.id, box, 'shared', { ...base, dim: ctx.st ? !playClass(ctx, n.id) : base.dim }, 2)]
  // L20④（ADR-0036 返工）：展开表面的节点画在边之上（含悬停提到最上层的边），端口点不被扇出线的命中区盖住
  return [placeNode(ctx, n.id, box, n.role === 'core' ? 'core' : 'module', base, base.surface ? OVER_EDGES.surface : 2)]
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
      ...(ctx.input.layerStatus?.get(n.moduleId) ? { status: ctx.input.layerStatus.get(n.moduleId) } : {}),
    },
    // O11：带右上角常驻「共用件 N · 折叠 M」
    ...(band && (band.shelf?.length || band.hiddenCount) ? { counts: { shared: band.shelf?.length ?? 0, folded: band.hiddenCount } } : {}),
    ...(band && bandShelfTop(ctx.pv.nodes, band) !== undefined ? { shelfAt: bandShelfTop(ctx.pv.nodes, band)! - box.y + SHELF.h / 2 } : {}),
  }
  const out = [placeNode(ctx, n.id, box, 'band', data, 0)]
  const more = ctx.pv.nodes.get(moreChipId(n.id))
  if (more && band)
    out.push(
      placeNode(
        ctx,
        moreChipId(n.id),
        more,
        'more',
        { ...base, selected: false, dim: !!ctx.st || !!ctx.near, hiddenCount: band.hiddenCount, expanded: band.expanded ?? 0 },
        OVER_EDGES.more,
      ),
    )
  return out
}

/** 回放叠加的节点：步骤序号（可单击指向该步）与分支预览序号（可单击选这一支） */
export function replayNodes(ctx: SceneContext): CanvasNode[] {
  const { st, sv, emphMessages } = ctx
  if (!st || !sv) return []
  const blank = { moduleId: '', name: '', childCount: 0, selected: false, dim: false }
  const nodes: CanvasNode[] = []
  const current = st.current?.index
  for (const mark of st.walked.values()) {
    // 框外边的走线在画布场景里按可见集分配了轨道：序号跟着画出来的线
    const allocated = ctx.routes.get(mark.edgeId)
    const at = allocated ? routeMidpoint(allocated) : mark.at
    if (!at) continue
    const steps = mark.steps.map(n => ({
      n,
      frameId: sv.messages[n - 1].frameIds[0],
      current: n - 1 === current,
      muted: !!emphMessages && !emphMessages.has(n - 1),
    }))
    nodes.push(placeNode(ctx, `step:${mark.edgeId}`, { ...at, w: 1, h: 1 }, 'step', { ...blank, steps }, OVER_EDGES.step))
  }
  const pointId = ctx.input.branchPointId
  for (const p of st.previews) {
    const allocated = p.at?.kind === 'edge' ? ctx.routes.get(p.at.edgeId) : undefined
    const pos = allocated ? routeMidpoint(allocated) : p.pos
    if (!pos || !pointId) continue
    const preview = { pointId, option: p.option, label: p.label }
    nodes.push(placeNode(ctx, `preview:${p.option}`, { ...pos, w: 1, h: 1 }, 'preview', { ...blank, preview }, OVER_EDGES.preview))
  }
  return nodes
}
