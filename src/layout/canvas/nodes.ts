/**
 * 画布场景的节点（ADR-0013）：本层的模块、带与 +N 占位块、边界节点、参与者；回放叠加的步骤序号与分支预览序号。
 * 结构视角按聚焦变淡，运行视角按舞台显示（V5、V8、V9）；回放态与文件高亮（G14）写进类名。
 */
import { moduleName, type ModelDiff, type ModelIndex, type ModuleEntity, type ViewNode, type VisibleLanding } from '@/model'
import { moreChipId, type Box } from '../layout'
import type { Visibility } from '../stage'
import type { SceneContext } from './context'
import { routeMidpoint } from './edges'
import type { CanvasNode, CanvasNodeType, NodeData } from './types'

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
const OVER_EDGES = { step: 1003, preview: 1004, more: 1003 } as const

/** X7：编辑态下模块、核心模块小块与带可拖动、可连线 */
const EDITABLE: readonly CanvasNodeType[] = ['module', 'core', 'band']

export function placeNode(ctx: SceneContext, id: string, box: Box, type: CanvasNodeType, data: NodeData, zIndex: number): CanvasNode {
  const editable = !!ctx.input.editing && EDITABLE.includes(type)
  return {
    id,
    type,
    position: { x: box.x, y: box.y },
    data: editable ? { ...data, editing: true } : data,
    zIndex,
    width: box.w,
    height: box.h,
    style: { width: `${box.w}px`, height: `${box.h}px` },
    selectable: false,
    draggable: editable,
    connectable: editable,
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
  // 没有框外元素时不画框（内容即全部）
  if (pv.frame) {
    const frameData = (id: string) => ({ moduleId: id, name: moduleName(idx, id), childCount: 0, selected: false, dim: false })
    const root = pv.view.parentId === idx.rootId
    if (root || !pv.parentFrame) nodes.push(placeNode(ctx, 'frame', root ? (pv.parentFrame ?? pv.frame) : pv.frame, 'frame', frameData(idx.rootId), -2))
    else {
      // 没有边界节点时两框重合：系统框向外让出一圈，内外框都看得见
      const sys = sameBox(pv.frame, pv.parentFrame) ? grow(pv.frame, FRAME_GAP) : pv.frame
      nodes.push(placeNode(ctx, 'frame', sys, 'frame', frameData(idx.rootId), -2))
      nodes.push(placeNode(ctx, 'frame:parent', pv.parentFrame, 'frame', frameData(pv.view.parentId), -1))
    }
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
    ...heatOf(ctx, n.id),
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
