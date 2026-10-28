/**
 * 手工走线与边界：参与者排布与曲线（A7）、边的标签与线宽档、平行边错开（L10），边界边的判定（L4）。
 */
import { MECHANISMS, bundleHandles, moduleName, type BundleHandles, type LevelView, type ModelIndex, type RelationType, type ViewEdge } from '@/model'
import { NODE_SIZE, type Box, type EdgeRoute, type Point, type PositionedView } from './geometry'
import { tierTextBoxes } from './tiers'
import { composePill, pillWidth, type TagPart } from './labels'
import { ARRIVE, BusyLines, allocateTracks, clampStub, detour, frameLines, placeLabelBoxes, type PortAt } from './routing'

// ── 外部参与者（A7）────────────────────────────────────────────

export const isActorNode = (view: LevelView, id: string) => view.nodes.some(n => n.id === id && n.role === 'actor')
export const hasActors = (view: LevelView) => view.nodes.some(n => n.role === 'actor')
export const ACTOR_GAP = 72

/**
 * 参与者排布（A7）：用户类在边界框上方一行，外部系统与时间类在左侧一列（离边界框 sideGap）；
 * 按所连内部节点的位置排序以减少交叉。
 */
export function placeActors(view: LevelView, nodes: Map<string, Box>, frame: Box, sideGap = ACTOR_GAP) {
  const actors = view.nodes.filter(n => n.role === 'actor')
  if (actors.length === 0) return
  const kindOf = (id: string) => view.nodes.find(n => n.id === id)?.actorKind ?? 'system'
  const anchor = (id: string, axis: 'x' | 'y') => {
    const vs = view.edges
      .filter(e => e.from === id || e.to === id)
      .map(e => nodes.get(e.from === id ? e.to : e.from))
      .filter((b): b is Box => !!b)
      .map(b => (axis === 'x' ? b.x + b.w / 2 : b.y + b.h / 2))
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : axis === 'x' ? frame.x + frame.w / 2 : frame.y + frame.h / 2
  }
  const { w, h } = NODE_SIZE.actor
  const gap = 20
  const users = actors.filter(a => kindOf(a.id) === 'user').sort((a, b) => anchor(a.id, 'x') - anchor(b.id, 'x'))
  const others = actors.filter(a => kindOf(a.id) !== 'user').sort((a, b) => anchor(a.id, 'y') - anchor(b.id, 'y'))
  let x = frame.x + frame.w / 2 - (users.length * w + (users.length - 1) * gap) / 2
  for (const a of users) {
    nodes.set(a.id, { x, y: frame.y - ACTOR_GAP - h, w, h })
    x += w + gap
  }
  let y = frame.y + frame.h / 2 - (others.length * h + (others.length - 1) * gap) / 2
  for (const a of others) {
    nodes.set(a.id, { x: frame.x - sideGap - w, y, w, h })
    y += h + gap
  }
}

/** 两个盒子之间的曲线：上下错开时从上下边出发，否则从侧边出发（参与者的边、回放中的临时线） */
export function linkRoute(a?: Box, b?: Box): EdgeRoute | undefined {
  return actorRoute(a, b)
}

/** 参与者与内部节点之间的曲线：上方的参与者从底边出发，左侧的从右边出发 */
export function actorRoute(a?: Box, b?: Box): EdgeRoute | undefined {
  if (!a || !b) return undefined
  const port = (box: Box, other: Box): Point => {
    if (other.y + other.h <= box.y) return { x: box.x + box.w / 2, y: box.y }
    if (other.y >= box.y + box.h) return { x: box.x + box.w / 2, y: box.y + box.h }
    return other.x >= box.x + box.w ? { x: box.x + box.w, y: box.y + box.h / 2 } : { x: box.x, y: box.y + box.h / 2 }
  }
  const p1 = port(a, b)
  const p2 = port(b, a)
  const side = p1.y !== a.y && p1.y !== a.y + a.h
  return { points: [p1, p2], curve: side ? 'h' : true, label: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } }
}

/** L10：标签只标聚合条数——含多条关系的边为 `×N`，其余为空；类型名不进标签（靠颜色、图例与面板） */
export function edgeLabel(e: ViewEdge): string {
  const n = e.relationIds.length
  return n > 1 ? `×${n}` : ''
}

/** L23b：悬停列表里的关系种类（与图例、面板的关系类型名同一套） */
const TYPE_NAMES: Record<RelationType, string> = { queries: '查询', commands: '委托', notifies: '通知', streams: '流', calls: '未分类' }

/** L23b：交互束的把手角标与悬停分组（ADR-0033） */
export interface HandleBadge {
  /** 角标：`×N · M 把手`；M 为 0 时只写 `×N`；N 为 1 时为空 */
  label: string
  /** 悬停：束的两端与 N / M，各组「子模块（条数）」与各条「接口名 · 所属子模块 · 种类」 */
  title: string
  handles: BundleHandles
}

/** L23b：角标文本——N 为 1 不写（同 L10 的 ×N），M 为 0 不写把手段 */
export function handleLabel(n: number, m: number): string {
  if (n <= 1) return ''
  return m > 0 ? `×${n} · ${m} 把手` : `×${n}`
}

/**
 * L23b：一条交互视图边的把手角标与悬停分组——接收方为边的 to 节点对应的模块（分层总览提升到层时为层模块）；
 * 接收方不是模块（参与者）时为 null。只读描述，与代码事实无关。
 */
export function handleBadge(index: ModelIndex, view: LevelView, e: ViewEdge): HandleBadge | null {
  const to = view.nodes.find(n => n.id === e.to)
  if (!to || !index.modules.has(to.moduleId)) return null
  const h = bundleHandles(index, to.moduleId, e.relationIds)
  const from = view.nodes.find(n => n.id === e.from)
  const name = (id: string) => (index.modules.has(id) ? moduleName(index, id) : id)
  const subName = (sub: string | null) => (sub ? name(sub) : '本体')
  const head = `${from ? name(from.moduleId) : e.from} → ${name(to.moduleId)} · ${TYPE_NAMES[e.type]} ×${h.relations}${h.handles ? ` · ${h.handles} 把手` : ''}（L23b）`
  const lines = h.groups.flatMap(g => [
    `${subName(g.sub)}（${g.items.length} 条）`,
    ...g.items.map(
      it => `  ${it.name ?? '（没写接口）'} · ${subName(g.sub)} · ${TYPE_NAMES[it.type]}${it.name && !it.handle ? '（接口不在接收方表面上，接到本体）' : ''}`,
    ),
  ])
  return { label: handleLabel(h.relations, h.handles), title: [head, ...lines].join('\n'), handles: h }
}

export { labelWidth } from './labels'
import { labelWidth } from './labels'

/** L35②：视图边的机制标签（按词表次序，聚合边带条数；全部都带时省略） */
export const mechTags = (mechs: ViewEdge['mechs'], total: number): TagPart[] =>
  MECHANISMS.filter(m => mechs?.[m]).map(tag => ({ tag, count: mechs![tag], total }))

/**
 * L33：交给 elk 的标签槽——只按把手角标「×N · M 把手」（M = N）估：槽决定 elk 的直段长度与走线，机制标签不改走线（ADR-0041：节点与线不动，只挪标签）；
 * 只有一条关系的边不占槽
 */
export function slotSize(e: ViewEdge): { w: number; h: number } | null {
  const n = e.relationIds.length
  return n > 1 ? { w: labelWidth(handleLabel(n, n)), h: 18 } : null
}

/**
 * L33（ADR-0041）：布局时给标签留的尺寸——按画布实际写的文字：把手角标「×N · M 把手」（L23b；布局时不知道 M，按 M = N 估）或 ×N，
 * 加机制与「混合」（L35、L23），照 L26② 的上限与分段估宽；只随代码事实或分层出现的异常不进估宽。什么都不写的边不占位。
 */
export function labelSize(e: ViewEdge): { w: number; h: number } | null {
  const n = e.relationIds.length
  const pill = composePill(n > 1 ? handleLabel(n, n) : '', [...mechTags(e.mechs, n), e.mode === 'mixed' && { tag: '混合' }])
  return pill.segments.length ? { w: pillWidth(pill.segments), h: 18 } : null
}

/** L10：线宽档位——聚合条数 1 / 2–4 / ≥5 */
export function edgeWeight(e: ViewEdge): 1 | 2 | 3 {
  const n = e.relationIds.length
  return n >= 5 ? 3 : n >= 2 ? 2 : 1
}

/** 平行边的错开量（px） */
export const PARALLEL_GAP = 10
/** 点是否落在折线包围盒向外扩 pad 的范围内 */
export function nearPoints(p: Point, pts: readonly Point[], pad: number): boolean {
  const xs = pts.map(q => q.x)
  const ys = pts.map(q => q.y)
  return p.x >= Math.min(...xs) - pad && p.x <= Math.max(...xs) + pad && p.y >= Math.min(...ys) - pad && p.y <= Math.max(...ys) + pad
}
/** elk 标签槽的最小尺寸：放得下「?」或「×N」 */
export const LABEL_SLOT = { w: 24, h: 18 }

/**
 * L10：同一对节点之间（不论方向）的多条边按序号对称错开，序号按边在视图中的顺序；只有一条的为 0。
 * elk 排的边各有端口、自行错开，这里用于分层总览的曲线（参与者的边、核心跨层边）。
 */
export function parallelOffsets(edges: readonly ViewEdge[]): Map<string, number> {
  const groups = new Map<string, string[]>()
  for (const e of edges) {
    const k = e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`
    groups.set(k, [...(groups.get(k) ?? []), e.id])
  }
  const out = new Map<string, number>()
  for (const ids of groups.values()) ids.forEach((id, i) => out.set(id, (i - (ids.length - 1) / 2) * PARALLEL_GAP))
  return out
}

/**
 * 平行边（同一对节点，L5）的终点锚点沿目标节点边缘错开 PARALLEL_GAP，箭头不叠压。
 * 只动终点重合的边：最后一段竖直时横移最后两点，水平时纵移——前一段仍保持正交。
 */
export function spreadEnds(viewEdges: readonly ViewEdge[], edges: Map<string, EdgeRoute>) {
  const groups = new Map<string, string[]>()
  for (const e of viewEdges) {
    const r = edges.get(e.id)
    if (!r || r.points.length < 2) continue
    const end = r.points[r.points.length - 1]
    const k = `${e.to}|${Math.round(end.x)},${Math.round(end.y)}`
    groups.set(k, [...(groups.get(k) ?? []), e.id])
  }
  for (const ids of groups.values()) {
    if (ids.length < 2) continue
    ids.forEach((id, i) => {
      const d = (i - (ids.length - 1) / 2) * PARALLEL_GAP
      const r = edges.get(id)!
      const pts = r.points.map(p => ({ ...p }))
      const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]]
      const vertical = Math.abs(a.x - b.x) < 0.5
      for (const p of [a, b]) {
        if (vertical) p.x += d
        else p.y += d
      }
      edges.set(id, { ...r, points: pts })
    })
  }
}

/** 曲线整体错开：上下出发的曲线横移，侧边出发的（'h'）纵移 */
export function shifted(route: EdgeRoute, d: number): EdgeRoute {
  if (!d) return route
  const mv = (p: Point): Point => (route.curve === 'h' ? { x: p.x, y: p.y + d } : { x: p.x + d, y: p.y })
  return { ...route, points: route.points.map(mv), ...(route.label ? { label: mv(route.label) } : {}) }
}

const isBoundary = (id: string) => id.startsWith('boundary:')

/** 内部边（两端都不是边界节点）交给 elk；边界边另行绘制 */
export function isBoundaryEdge(e: ViewEdge): boolean {
  return isBoundary(e.from) || isBoundary(e.to)
}

// ── 框外的元素：方位表示角色（A7、L4）──────────────────────────

/** 父模块框到边界节点行（放得下进边界节点的 ARRIVE 短桩与错开量）；边界节点行到系统框（px） */
export const BOUNDARY_GAP = 72
export const SYSTEM_PAD = 44

/**
 * 方位（A7）：用户在系统框上方，外部系统与时间在系统框左侧，边界节点在父模块框下方、系统框之内，其余在父模块框内。
 * 方位固定在屏幕上，不随普通层次的布局方向（自上而下 / 自左向右）改变。右侧只留分层总览的层间关系线（侧边通道、核心车道）。
 */
export type Compass = 'top' | 'left' | 'bottom' | 'inner' | 'rim-top' | 'rim-left'

/**
 * L14：普通层次的边界角色——port 在父模块框上边（rim-top）、adapter 在左边（rim-left，随外部系统）：不交给 elk，布局后压在框线上（placeRims），
 * 边与框外元素的边一样按需正交走线、常显。分层总览里它们是带内的块（role 为 core），不走这里。
 */
export function compassOf(n: { role?: string; actorKind?: string; rim?: string }): Compass {
  if (n.role === 'boundary') return 'bottom'
  if (n.role === 'actor') return n.actorKind === 'user' ? 'top' : 'left'
  if (n.role === 'module' && n.rim) return n.rim === 'port' ? 'rim-top' : 'rim-left'
  return 'inner'
}

/** L14：边界角色节点之间、框线上的间距（px） */
export const RIM_GAP = 32

/**
 * L14：普通层次的边界角色压在父模块框线上——port 一行横跨上边（中心在框线上），adapter 一列横跨左边；按所连节点的位置排序以减少交叉。
 * 框线先向外让出半个节点加 RIM_GAP，框内的节点与走线不被压住。返回让出后的框。
 */
export function placeRims(view: LevelView, nodes: Map<string, Box>, frame: Box): Box {
  const rims = view.nodes.filter(n => compassOf(n) === 'rim-top' || compassOf(n) === 'rim-left')
  if (!rims.length) return frame
  const anchor = (id: string, axis: 'x' | 'y') => {
    const vs = view.edges
      .filter(e => e.from === id || e.to === id)
      .map(e => nodes.get(e.from === id ? e.to : e.from))
      .filter((b): b is Box => !!b)
      .map(b => (axis === 'x' ? b.x + b.w / 2 : b.y + b.h / 2))
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : axis === 'x' ? frame.x + frame.w / 2 : frame.y + frame.h / 2
  }
  const { w, h } = NODE_SIZE.module
  const ports = rims.filter(n => compassOf(n) === 'rim-top').sort((a, b) => anchor(a.id, 'x') - anchor(b.id, 'x'))
  const adapters = rims.filter(n => compassOf(n) === 'rim-left').sort((a, b) => anchor(a.id, 'y') - anchor(b.id, 'y'))
  let f = frame
  if (ports.length) {
    const top = f.y - h / 2 - RIM_GAP
    const rowW = ports.length * w + (ports.length - 1) * RIM_GAP
    const x0 = Math.max(f.x + RIM_GAP, f.x + f.w / 2 - rowW / 2)
    ports.forEach((n, i) => nodes.set(n.id, { x: x0 + i * (w + RIM_GAP), y: top - h / 2, w, h }))
    f = { x: f.x, y: top, w: Math.max(f.w, x0 + rowW + RIM_GAP - f.x), h: f.y + f.h - top }
  }
  if (adapters.length) {
    const left = f.x - w / 2 - RIM_GAP
    const colH = adapters.length * h + (adapters.length - 1) * RIM_GAP
    const y0 = Math.max(f.y + h / 2 + RIM_GAP, f.y + f.h / 2 - colH / 2)
    adapters.forEach((n, i) => nodes.set(n.id, { x: left - w / 2, y: y0 + i * (h + RIM_GAP), w, h }))
    f = { x: left, y: f.y, w: f.x + f.w - left, h: Math.max(f.h, y0 + colH + RIM_GAP - f.y) }
  }
  return f
}

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
const expand = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d })

/**
 * 给定父模块框（已包住内部节点与走线），摆放框外的元素：边界节点在它下方一行（按视图顺序，即层次顺序），
 * 系统框包住父模块框与边界节点行（有边界节点时留 SYSTEM_PAD，没有时与父模块框重合）；参与者按方位放在系统框外（placeActors）。
 * 没有边界节点也没有参与者时不给系统框。sideGap 为外部系统离系统框的距离。
 */
export function placeOutside(view: LevelView, nodes: Map<string, Box>, parentFrame: Box, sideGap = ACTOR_GAP): Box | undefined {
  const bs = view.nodes.filter(n => n.role === 'boundary')
  if (!bs.length && !hasActors(view)) return undefined
  let frame = parentFrame
  if (bs.length) {
    const { w, h } = NODE_SIZE.boundary
    const gap = 20
    const rowW = bs.length * w + (bs.length - 1) * gap
    const x0 = parentFrame.x + parentFrame.w / 2 - rowW / 2
    const y = parentFrame.y + parentFrame.h + BOUNDARY_GAP
    bs.forEach((n, i) => nodes.set(n.id, { x: x0 + i * (w + gap), y, w, h }))
    frame = expand(union(parentFrame, { x: x0, y, w: rowW, h }), SYSTEM_PAD)
  }
  placeActors(view, nodes, frame, sideGap)
  return frame
}

// ── 框外元素的边按需走线（A7、L4、L11）──────────────────────────

/** 同一节点同一侧多条边的短桩逐条加长量（px） */
const LANE_GAP = 6
/** 加长量的上限：短桩不超出层间空隙（72）的一半 */
const MAX_LANE = 22

/** L14：普通层次压在框线上的边界角色节点 */
const isRimNode = (view: LevelView, id: string) => view.nodes.some(n => n.id === id && (compassOf(n) === 'rim-top' || compassOf(n) === 'rim-left'))

/** 框外元素的边（参与者的边、边界边、L14 边界角色的边）：普通层次不参与布局，要画时才走线 */
export const isOutsideEdge = (view: LevelView, e: ViewEdge) =>
  isBoundaryEdge(e) || isActorNode(view, e.from) || isActorNode(view, e.to) || isRimNode(view, e.from) || isRimNode(view, e.to)

/** 走线按节点布局记忆：同一份布局里每条边只算一次（布局本身另按视图内容缓存） */
const outsideMemo = new WeakMap<Map<string, Box>, Map<string, EdgeRoute | undefined>>()

/**
 * 一条边的走线：布局给出的直接用；普通层次中框外元素的边不参与布局，第一次要画时按方位与端口方向正交绕行（不穿节点，从目标的入口侧进入）。
 */
export function edgeRoute(pv: PositionedView, e: ViewEdge): EdgeRoute | undefined {
  const laid = pv.edges.get(e.id)
  if (laid || pv.view.mode === 'layered' || !isOutsideEdge(pv.view, e)) return laid
  let memo = outsideMemo.get(pv.nodes)
  if (!memo) outsideMemo.set(pv.nodes, (memo = new Map()))
  // 走线依赖同一节点上其他框外边的序号：视图的这类边（如关系类型筛选后）不同则另算
  const key = `${e.id}|${pv.view.edges
    .filter(x => isOutsideEdge(pv.view, x))
    .map(x => x.id)
    .join(',')}`
  if (!memo.has(key)) memo.set(key, outsideRoute(pv, e))
  return memo.get(key)
}

/**
 * 端口按方位：用户在底边朝下、外部系统在右边朝右（A7：它在系统框左侧）、边界节点在顶边朝上；内部节点进边在入口侧（自上而下为顶边，自左向右为左边）、
 * 出边在出口侧（底边 / 右边，L11）；front 时落在该侧的前半（有端口记号的节点，进边一侧的后半留给记号 L13）。
 * 同一节点同一侧的多条边沿该边错开 PARALLEL_GAP，短桩逐条加长。
 */
export function portFor(
  box: Box,
  compass: Compass,
  end: 'in' | 'out',
  direction: 'DOWN' | 'RIGHT',
  slot: { i: number; n: number },
  stub?: number,
  front?: boolean,
): PortAt {
  // L11：front 时端口落在该侧的前半（顶边 / 底边的左半、左边 / 右边的上半），在半边内错开；否则在整条边上错开。
  // L31：放不下 PARALLEL_GAP 时等分压缩，不在边缘堆成一点
  const along = (len: number) => {
    const span = front ? len / 4 : len / 2
    const center = front ? -len / 4 : 0
    const step = Math.min(PARALLEL_GAP, (2 * span - 16) / Math.max(1, slot.n - 1))
    return center + (slot.i - (slot.n - 1) / 2) * step
  }
  const lane = Math.min(slot.i * LANE_GAP, MAX_LANE)
  const side =
    compass === 'top' || compass === 'rim-top'
      ? 'bottom'
      : compass === 'left' || compass === 'rim-left'
        ? 'right'
        : compass === 'bottom'
          ? 'top'
          : direction === 'DOWN'
            ? end === 'in'
              ? 'top'
              : 'bottom'
            : end === 'in'
              ? 'left'
              : 'right'
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const base = { lane, ...(stub !== undefined ? { stub } : {}) }
  if (side === 'top') return { x: cx + along(box.w), y: box.y, dir: -1, ...base }
  if (side === 'bottom') return { x: cx + along(box.w), y: box.y + box.h, dir: 1, ...base }
  if (side === 'left') return { x: box.x, y: cy + along(box.h), dir: -1, axis: 'h', ...base }
  return { x: box.x + box.w, y: cy + along(box.h), dir: 1, axis: 'h', ...base }
}

/** 终点短桩再按起点上的序号加长：同一起点出发、去往同一行的几条边各走一条横线，不重叠 */
export const withSourceLane = (p: PortAt, from: { i: number }): PortAt => ({ ...p, lane: Math.min((p.lane ?? 0) + from.i * LANE_GAP, MAX_LANE) })

/** 同一节点上（同一类）边的序号，用于错开 */
export function slotOf(edges: readonly Pick<ViewEdge, 'id' | 'from' | 'to'>[], node: string, id: string): { i: number; n: number } {
  const mine = edges.filter(x => x.from === node || x.to === node)
  return {
    i: Math.max(
      0,
      mine.findIndex(x => x.id === id),
    ),
    n: mine.length,
  }
}

/** 按可见集分配轨道的结果按节点布局与可见集记忆 */
const trackMemo = new WeakMap<Map<string, Box>, Map<string, Map<string, EdgeRoute>>>()

/**
 * L11：当前可见的框外边（悬停 / 选中相邻节点、全显、违规，以及常驻的参与者的边）一起走线并分配轨道——
 * 端口错开只在这一组里算，走廊里重合的横段、竖段按边 ID 依次错开 PARALLEL_GAP（allocateTracks），同一对节点的平行边与同走廊的不同边一样处理。
 * 不对本层全部框外边预分配（会把走廊撑开），不影响内部布局与缓存键。分层总览的框外边在排布时已走好，这里不给。
 */
export function outsideRoutes(
  pv: PositionedView,
  visible: readonly ViewEdge[],
  sizes?: ReadonlyMap<string, { w: number; h: number }>,
  /** L44：先走好的另一组线（只占不动，分轨与标签避开它们）——叠加线在框外边之后分轨，不挪已有的线 */
  after?: ReadonlyMap<string, EdgeRoute>,
): Map<string, EdgeRoute> {
  if (pv.view.mode === 'layered') return new Map()
  const group = visible.filter(e => isOutsideEdge(pv.view, e)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  if (!group.length) return new Map()
  let memo = trackMemo.get(pv.nodes)
  if (!memo) trackMemo.set(pv.nodes, (memo = new Map()))
  // 层带文字区在布局最后才有（tierGeometry）：同一份节点表上布局中途按没有层带算过的不复用
  // L33：结构视角的标签按实际文字估宽（sizes），尺寸不同的同一组线不复用
  const key = `${pv.tiers ? 't' : '-'}|${group.map(e => `${e.id}${sizes?.has(e.id) ? `:${sizes.get(e.id)!.w}` : ''}`).join(',')}|${[...(after?.keys() ?? [])].join(',')}`
  const hit = memo.get(key)
  if (hit) return hit
  // L32：选通道时避开内部边与同组已走好的线
  const fixed = [
    ...pv.view.edges.flatMap(e => {
      const r = pv.edges.get(e.id)
      return r && !isOutsideEdge(pv.view, e) ? [{ id: e.id, points: r.points }] : []
    }),
    ...[...(after ?? [])].map(([id, r]) => ({ id, points: r.points })),
  ]
  const busy = new BusyLines()
  for (const l of fixed) busy.add(l.points)
  const base = group.flatMap(e => {
    const r = outsideRoute(pv, e, group, busy)
    return r ? [{ id: e.id, points: r.points }] : []
  })
  // L32：elk 排好的内部边只占不动，分轨时避开它们、框线与节点
  // L30：层带的层号、环组框的环编号也是障碍
  const texts = tierTextBoxes(pv.tiers)
  const tracks = allocateTracks(base, PARALLEL_GAP, {
    fixed: [...fixed, ...frameLines([pv.parentFrame, pv.frame])],
    obstacles: [...pv.nodes.values(), ...texts],
  })
  // L33：标签按实际尺寸放在各自的轨道上，不压节点、内部边的标签与彼此
  const byId = new Map(group.map(e => [e.id, e]))
  const innerLabels = [
    ...pv.view.edges.flatMap(e => {
      const r = pv.edges.get(e.id)
      const size = labelSize(e)
      return r?.label && size && !isOutsideEdge(pv.view, e) ? [{ x: r.label.x - size.w / 2, y: r.label.y - size.h / 2, ...size }] : []
    }),
    // L44：先走好的那组线的标签（按 ×N 估宽）
    ...[...(after ?? [])].flatMap(([, r]) => (r.label ? [{ x: r.label.x - 12, y: r.label.y - 9, w: 24, h: 18 }] : [])),
  ]
  const labels = placeLabelBoxes(
    [...tracks].map(([id, points]) => ({ id, points, size: sizes?.get(id) ?? labelSize(byId.get(id)!) ?? { w: 24, h: 18 } })),
    { obstacles: [...pv.nodes.values(), ...innerLabels, ...texts] },
  )
  const result = new Map([...tracks].map(([id, points]) => [id, { points, label: labels.get(id)! }]))
  memo.set(key, result)
  return result
}

/**
 * L14：框线上的边界角色朝对端出入——port 对端在它上方（用户）时走顶边、否则走底边；adapter 对端在它左侧（外部系统）时走左边、否则走右边。
 * 其余节点按方位（portFor）。
 */
function rimPort(
  box: Box,
  other: Box,
  compass: Compass,
  end: 'in' | 'out',
  dir: 'DOWN' | 'RIGHT',
  slot: { i: number; n: number },
  stub?: number,
  front?: boolean,
): PortAt {
  if (compass === 'rim-top' && other.y + other.h <= box.y) return portFor(box, 'bottom', end, dir, slot, stub, front)
  if (compass === 'rim-left' && other.x + other.w <= box.x) return portFor(box, 'inner', 'in', 'RIGHT', slot, stub, front)
  return portFor(box, compass, end, dir, slot, stub, front)
}

function outsideRoute(pv: PositionedView, e: ViewEdge, group?: readonly ViewEdge[], busy?: BusyLines): EdgeRoute | undefined {
  const a = pv.nodes.get(e.from)
  const b = pv.nodes.get(e.to)
  const na = pv.view.nodes.find(n => n.id === e.from)
  const nb = pv.view.nodes.find(n => n.id === e.to)
  if (!a || !b || !na || !nb) return undefined
  const dir = pv.direction ?? 'DOWN'
  // L11：有端口记号的节点（L13）关系边在前半错开、后半留给记号；L31：没有端口记号的（参与者、边界节点、边界角色、没有端口的模块）用整条边
  const front = (n: { id: string }) => !!pv.marked?.has(n.id)
  const outside = group ?? pv.view.edges.filter(x => isOutsideEdge(pv.view, x))
  const fs = slotOf(outside, e.from, e.id)
  // 内部节点那一端用 elk 排出的占位端口（与内部边的端口一起排在前半）；没有时按半边错开
  const at = (p: PortAt, id: string): PortAt => {
    const q = pv.ports?.get(id)
    return q ? { ...p, x: q.x, y: q.y } : p
  }
  const from = at(rimPort(a, b, compassOf(na), 'out', dir, fs, undefined, front(na)), `${e.id}#out`)
  // 终点短桩加长到 ARRIVE：箭头前留出直段，拐弯不贴着箭头
  const to = at(withSourceLane(rimPort(b, a, compassOf(nb), 'in', dir, slotOf(outside, e.to, e.id), ARRIVE, front(nb)), fs), `${e.id}#in`)
  // 两端自身也是障碍：中间三段（横、竖通道、横）都在两端的短桩之外，不能穿过它们；L32：短桩不伸进对面的节点
  const boxes = [...pv.nodes.values()]
  return { points: detour(clampStub(from, boxes), clampStub(to, boxes), boxes, busy) }
}
