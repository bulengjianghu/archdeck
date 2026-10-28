/**
 * 草图布局（state.layout.sketch，X15、X19、X21、X22，ADR-0025）：草图画布要画的节点与边——不走 elk、不走分层投影。
 * 非根草图（X22）：画布是一块系统框，尺寸随草图画布的可用区域（area：画布容器的实际尺寸，流坐标 = 像素）自适应，没量到时取 SKETCH_CANVAS_FALLBACK；外部引用按所属层在骨架里的 order 从左到右排成列，挂载点所在层的位置是中心区
 * （挂载点框），与挂载点同层的引用在中心区右侧单列一列「同层」；每列单列不换列，放不下时整列按比例缩小；引用的位置只由规则算，不写回。
 * 中心区可用宽度 = 画布宽 − 两侧引用列宽，本层模块的位置取 layout（相对中心区的内容原点），没有 layout 时按可用宽度排一次网格
 * （gridLayout，只用于显示、不写回，「需初始布局」），只缺几个位置的（新建、推出的模块）放到不与已有节点重叠的空位；隐藏外部引用时中心区占满画布宽。
 * 引用节点按「与挂载点同深度的祖先」折叠（05 裁决 4）：同一对（本层模块、折叠节点）同方向的多条关系合成一条显示边并标条数。
 * 根草图（X21）：层画成横向带（按 order），第二级模块在所属带内，位置取 layout（y 相对带顶），带高随内容增长。
 * 本层之间的边是两端中心之间的直线，同一对节点的多条线平移错开；标签位置取 layout.relations，没写时在中点。
 * 引用线（X22）从模块朝引用列的一侧端口进出（左侧列进左端口、右侧列进右端口）。纯函数，草图画布只把结果写入 Vue Flow。
 */
import {
  foldReference,
  gridLayout,
  locateAll,
  referenceNodes,
  referenceRelations,
  ROOT_BAND_COLS,
  ROOT_BAND_GAP,
  ROOT_BAND_PAD,
  ROOT_BAND_ROW,
  ROOT_BAND_X0,
  ROOT_MOUNT,
  SKETCH_SOFT_LIMIT,
  isSharedRole,
  isCallbackVia,
  mechanismCounts as mechs,
  type Mechanism,
  parseVia,
  type ChangeKind,
  type GridArea,
  type ModuleDef,
  type ModuleRole,
  type SketchDef,
  type SketchPoint,
} from '@/model'

export const SKETCH_NODE = { w: 168, h: 56 } as const
/** SK-22（ADR-0027）：核心模块画成大块；共用件（shared / bus）画成本层框底部一行「共用件」架上的紧凑块 */
export const SKETCH_CORE = { w: 188, h: 64 } as const
export const SKETCH_SHELF = { w: 132, h: 28, gap: 8, label: 56, top: 16 } as const
/** X22：可用区域还没量到（单测、首帧）时的缺省尺寸；画布量到容器尺寸后系统框按实际可用区域排 */
export const SKETCH_CANVAS_FALLBACK = { w: 1760, h: 860 } as const
/** X22：紧凑的引用节点（一行：名字 + ID，高度约为模块节点一半）与列内间距 */
export const SKETCH_REF = { w: 196, h: 28, gap: 6 } as const
/** X22：引用列的宽、列间距与列内上下留白（列名在框线上） */
export const SKETCH_COLUMN = { w: 220, gap: 18, pad: 16 } as const
/** X22：系统框与中心区（挂载点框）的内边距 */
export const SKETCH_FRAME_PAD = 28
export const SKETCH_CENTER_PAD = 32
/** X22：中心区的最小宽度（两列网格）：可用区域连它都放不下时画布按视口的宽高比放大，适应画布时整体缩小 */
export const SKETCH_CENTER_MIN_W = 2 * SKETCH_CENTER_PAD + 220 + SKETCH_NODE.w
/** X21：层带的高度、带间距与带头宽度 */
export const SKETCH_BAND = { h: 112, gap: 14, head: 200, minW: 1100 } as const
/** 兼容：层在非带布局下的尺寸 */
export const SKETCH_LAYER = { w: 168, h: 56 } as const
/** 同一对节点的多条线之间的间距 */
export const SKETCH_PARALLEL_GAP = 16
const ORIGIN = 40

export type SketchNodeKind = 'module' | 'reference' | 'layer' | 'frame'

/** X22：框线——最外的系统框、中心区（挂载点框）、引用列 */
export type SketchFrameKind = 'system' | 'center' | 'column' | 'shelf'

export interface SketchNodeData {
  id: string
  kind: SketchNodeKind
  name: string
  /** ADR-0027：核心大块、共用件收进架（SK-22） */
  role?: ModuleRole
  /** SK-22：在本层框底部的共用件架上（位置由规则算，不随 layout） */
  shelf?: boolean
  /** 有下一层（设计里有挂在它身上的草图，或基线里有子模块）：双击下钻有内容 */
  deeper?: boolean
  /** 图上标出变更时的角标 */
  change?: ChangeKind
  selected?: boolean
  /** 引用节点：折叠进来的关系条数（精确端点仍在数据里） */
  relations?: number
  /** 引用节点：折叠进来的精确端点（不止它自己时） */
  members?: string[]
  /** 层带（X21）：抽象原则、带内模块数、超七 */
  abstraction?: string
  count?: number
  over?: boolean
  /** X22：框线的种类；引用列的标注（「同层」） */
  frame?: SketchFrameKind
  tag?: string
  /** X22：引用节点所在列的缩放（列高放不下时整列按比例缩小；1 为原大） */
  scale?: number
  /** X22：引用节点在中心区的哪一侧 */
  side?: 'left' | 'right'
  /** X24：本草图里这个模块定义的接口（端口记号，同 L13）——拖线到记号即声明实现者；implementers 为 implementedBy 的条数 */
  ports?: { id: string; name: string; implementers: number }[]
  w: number
  h: number
}

export interface SketchNode {
  id: string
  position: SketchPoint
  data: SketchNodeData
}

export interface SketchEdgeData {
  /** 显示边对应的关系（聚合边为第一条） */
  relationId: string
  /** 聚合边（05 裁决 4）：合进来的全部关系；单条关系时不给 */
  relationIds?: string[]
  /** 聚合边的引用端（显示 ID） */
  reference?: string
  type: string
  description?: string
  /** 平移量（px，垂直于连线）：同一对节点的第 i 条 */
  offset: number
  /** 标签位置：人拖过的为 layout 里的位置，否则 null（在中点） */
  label: SketchPoint | null
  /** 端点之一已不在本层（待重连，X16） */
  pending?: boolean
  /** L12、X23：边上有一条经端口（via: port:）的关系——终点画插座 */
  port?: boolean
  /** L24：经回调（标签位写「回调」，L35 机制族） */
  callback?: boolean
  /** L35：机制 → 带该机制的关系条数（标签位按 L26② 组装）；没有机制时不给 */
  mechs?: Partial<Record<Mechanism, number>>
  change?: ChangeKind
  selected?: boolean
  /** X22：引用线——引用在中心区的哪一侧（模块从这一侧的端口进出），引用是起点还是终点 */
  external?: 'left' | 'right'
  refEnd?: 'source' | 'target'
}

export interface SketchEdge {
  id: string
  source: string
  target: string
  data: SketchEdgeData
}

export interface SketchSceneInput {
  def: SketchDef
  /** 引用节点的名称（取自当前版本或设计的其他草图） */
  nameOf: (id: string) => string | undefined
  /** 模块是否有下一层 */
  deeper?: (id: string) => boolean
  /** 变更角标（图上标出变更时给出） */
  changes?: ReadonlyMap<string, ChangeKind> | null
  selected?: ReadonlySet<string>
  /** 待重连的关系 */
  pending?: readonly string[]
  /** X22：骨架里的层（按 order）与一个模块所属的层；没给时引用都放在「外部」一列 */
  layers?: readonly { id: string; name: string }[]
  layerOf?: (id: string) => string | undefined
  /** X22：系统框的标题（项目名）与中心区的标题（挂载点名） */
  system?: string
  mountName?: string
  /** X22：隐藏外部引用——引用列与引用线都不画，中心区占满画布宽 */
  hideReferences?: boolean
  /** X22：草图画布的可用区域（画布容器的实际宽高，缩放 1 时流坐标 = 像素）；没给时取 SKETCH_CANVAS_FALLBACK */
  area?: { w: number; h: number }
}

/** X22：一列引用（按层；与挂载点同层的标「同层」；不在任何层的为「外部」） */
export interface SketchColumn {
  id: string
  name: string
  side: 'left' | 'right'
  tag?: string
  refs: string[]
}

export interface SketchRect {
  x: number
  y: number
  w: number
  h: number
}

/** X21：根草图的一条层带 */
export interface SketchBand {
  id: string
  y: number
  h: number
}

export interface SketchScene {
  nodes: SketchNode[]
  edges: SketchEdge[]
  /** X21：根草图的层带（按 order，自上而下）；非根草图为空 */
  bands: SketchBand[]
  /** 草图没有 layout：显示的是一次初始布局，不写回（X15） */
  needsLayout: boolean
  /** 本层模块数（根草图为第二级模块数之和不计层） */
  count: number
  /** X22：中心区（挂载点框）的矩形，拖出它松手 = 升级；根草图为 null */
  center: SketchRect | null
  /** X22：layout 里本层模块坐标的原点（中心区的内容原点）；根草图为 (0, 0) */
  origin: SketchPoint
  /** X22：中心区排网格的可用区域（初始布局与「重新排列」）；根草图为 undefined */
  gridArea?: GridArea
  /** X22：引用列（隐藏外部引用时为空） */
  columns: SketchColumn[]
}

/** 聚合边的 ID（05 裁决 4） */
export const aggregateEdgeId = (source: string, target: string): string => `agg:${source}>${target}`

/** X21：根草图的层，按 order（没写的按出现顺序排在后面） */
export function rootLayers(def: SketchDef): ModuleDef[] {
  const layers = (def.modules ?? []).map((m, i) => ({ m, i }))
  return layers.sort((a, b) => (a.m.order ?? 1e6 + a.i) - (b.m.order ?? 1e6 + b.i)).map(x => x.m)
}

/**
 * X21（T2b 裁决 3）：根草图的层带几何与带内模块位置——layout 里有的照用（y 相对带顶；旧草图只记 x 的取第一行），
 * 缺的按带内网格（ROOT_BAND_COLS 列，多了折行）找不重叠的空位；带高随内容增长（不小于缺省带高）
 */
function bandLayout(def: SketchDef): { bands: SketchBand[]; pos: Record<string, SketchPoint>; width: number } {
  const given = def.layout?.modules ?? {}
  const pos: Record<string, SketchPoint> = {}
  const bands: SketchBand[] = []
  let right: number = SKETCH_BAND.minW
  let top = ORIGIN
  for (const layer of rootLayers(def)) {
    const taken: SketchPoint[] = []
    // SK-22：共用件不占网格，排在带底的共用件架
    const shelf = (layer.children ?? []).filter(k => isSharedRole(k.role))
    const kids = (layer.children ?? []).filter(k => !isSharedRole(k.role))
    for (const k of kids)
      if (given[k.id]) {
        pos[k.id] = { x: given[k.id].x, y: top + Math.max(0, given[k.id].y ?? ROOT_BAND_PAD) }
        taken.push(pos[k.id])
      }
    const clash = (p: SketchPoint) => taken.some(q => Math.abs(q.x - p.x) < SKETCH_NODE.w + 8 && Math.abs(q.y - p.y) < SKETCH_NODE.h + 8)
    let slot = 0
    for (const k of kids) {
      if (pos[k.id]) continue
      let p: SketchPoint
      do {
        p = { x: ROOT_BAND_X0 + (slot % ROOT_BAND_COLS) * ROOT_BAND_GAP, y: top + ROOT_BAND_PAD + Math.floor(slot / ROOT_BAND_COLS) * ROOT_BAND_ROW }
        slot++
      } while (clash(p) && slot < 1000)
      pos[k.id] = p
      taken.push(p)
    }
    const bottom = Math.max(0, ...taken.map(p => p.y + SKETCH_NODE.h - top))
    const shelfY = top + bottom + SKETCH_SHELF.top
    shelf.forEach((k, i) => (pos[k.id] = { x: ROOT_BAND_X0 + SKETCH_SHELF.label + i * (SKETCH_SHELF.w + SKETCH_SHELF.gap), y: shelfY }))
    for (const k of shelf) right = Math.max(right, pos[k.id].x + SKETCH_SHELF.w + 60)
    const h = Math.max(SKETCH_BAND.h, bottom + (shelf.length ? SKETCH_SHELF.top + SKETCH_SHELF.h : 0) + ROOT_BAND_PAD)
    bands.push({ id: layer.id, y: top, h })
    for (const p of taken) right = Math.max(right, p.x + SKETCH_NODE.w + 60)
    top += h + SKETCH_BAND.gap
  }
  return { bands, pos, width: right }
}

/**
 * X21：根草图里把画布上的位置（绝对坐标）换成 layout 里记的样子——第二级模块的 y 相对所属层带的顶（不小于 0）；层原样（layout 不记层）。
 * 所属层取 ID 的第一段（移入时传目标层）；非根草图原样返回。
 */
export function bandRelative(def: SketchDef, positions: Readonly<Record<string, SketchPoint>>, layerOf?: (id: string) => string): Record<string, SketchPoint> {
  if (def.mount !== ROOT_MOUNT) return { ...positions }
  const tops = new Map(bandLayout(def).bands.map(b => [b.id, b.y]))
  return Object.fromEntries(
    Object.entries(positions).map(([id, p]) => {
      const top = id.includes('.') ? tops.get(layerOf?.(id) ?? id.split('.')[0]) : undefined
      return [id, top === undefined ? p : { x: Math.round(p.x), y: Math.max(0, Math.round(p.y - top)) }]
    }),
  )
}

/**
 * 显示用的位置（非根草图为本层模块，相对中心区的内容原点）：layout 里有的照用；缺的放到初始布局（按中心区可用区域 area 排的网格）的位置，
 * 与已有节点重叠时往下找空位。引用节点不在这里（X22：位置由规则算）
 */
export function sketchPositions(def: SketchDef, ids: readonly string[], area?: GridArea): Record<string, SketchPoint> {
  if (def.mount === ROOT_MOUNT) return bandLayout(def).pos
  const grid = gridLayout(def, area).modules ?? {}
  const given = def.layout?.modules ?? {}
  const out: Record<string, SketchPoint> = {}
  const taken: SketchPoint[] = []
  for (const id of ids) {
    const p = given[id]
    if (p && p.y !== undefined) {
      out[id] = { x: p.x, y: p.y }
      taken.push(out[id])
    }
  }
  const clash = (p: SketchPoint) => taken.some(q => Math.abs(q.x - p.x) < SKETCH_NODE.w && Math.abs(q.y - p.y) < SKETCH_NODE.h + 8)
  for (const id of ids) {
    if (out[id]) continue
    const g = grid[id]
    let p: SketchPoint = g && g.y !== undefined ? { x: g.x, y: g.y } : { x: 0, y: 0 }
    for (let i = 0; i < 200 && clash(p); i++) p = { x: p.x, y: p.y + SKETCH_NODE.h + 24 }
    out[id] = p
    taken.push(p)
  }
  return out
}

/**
 * X22：引用列——按所属层在骨架里的 order 从左到右：比挂载点所在层靠前的在左，同层的紧贴中心区右侧单列一列（标「同层」），靠后的在右；
 * 不在任何层的（外部参与者等）在最右一列「外部」。只列有引用的列；列内的顺序由调用方排
 */
export function referenceColumns(
  refs: readonly string[],
  mountLayer: string | undefined,
  layers: readonly { id: string; name: string }[],
  layerOf: (id: string) => string | undefined,
): SketchColumn[] {
  const at = (id: string | undefined) => (id === undefined ? -1 : layers.findIndex(l => l.id === id))
  const home = at(mountLayer)
  const cols = new Map<string, SketchColumn & { rank: number }>()
  for (const ref of refs) {
    const i = at(layerOf(ref))
    const key = i < 0 ? 'other' : layers[i].id
    let col = cols.get(key)
    if (!col) {
      col =
        i < 0
          ? { id: 'other', name: '外部', side: 'right', refs: [], rank: 1e6 }
          : i === home
            ? { id: layers[i].id, name: layers[i].name, side: 'right', tag: '同层', refs: [], rank: home + 0.5 }
            : { id: layers[i].id, name: layers[i].name, side: i < home ? 'left' : 'right', refs: [], rank: i }
      cols.set(key, col)
    }
    col.refs.push(ref)
  }
  return [...cols.values()].sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...c }) => c)
}

/**
 * X22：可用区域——量到的画布尺寸，太小时取下限（中心区至少放得下一个模块、两侧各一列引用），没量到时取缺省
 */
export function canvasArea(area?: { w: number; h: number }): { w: number; h: number } {
  if (!area || !(area.w > 0) || !(area.h > 0)) return { ...SKETCH_CANVAS_FALLBACK }
  const minW = 2 * SKETCH_FRAME_PAD + 2 * SKETCH_CENTER_PAD + SKETCH_NODE.w
  const minH = 2 * SKETCH_FRAME_PAD + 2 * SKETCH_CENTER_PAD + SKETCH_NODE.h
  return { w: Math.max(minW, Math.round(area.w)), h: Math.max(minH, Math.round(area.h)) }
}

/** X22：非根草图的框与引用列的几何——中心区按可用宽度与本层模块的范围取大，引用列在两侧，列内单列、放不下整列按比例缩小 */
function boundaryLayout(
  input: SketchSceneInput,
  own: readonly string[],
  refs: readonly string[],
  shelf: readonly string[] = [],
): {
  frames: SketchNode[]
  references: Map<string, { position: SketchPoint; w: number; h: number; scale: number; side: 'left' | 'right' }>
  pos: Record<string, SketchPoint>
  center: SketchRect
  origin: SketchPoint
  gridArea: GridArea
  columns: SketchColumn[]
} {
  const { def } = input
  const layers = input.layers ?? []
  const layerOf = input.layerOf ?? (() => undefined)
  const columns = input.hideReferences ? [] : referenceColumns(refs, layerOf(def.mount) ?? def.mount.split('.')[0], layers, layerOf)
  const left = columns.filter(c => c.side === 'left')
  const right = columns.filter(c => c.side === 'right')
  const step = SKETCH_COLUMN.w + SKETCH_COLUMN.gap
  const fixedW = 2 * SKETCH_FRAME_PAD + (left.length + right.length) * step
  // SK-22：共用件架在中心区底部一行，中心区为它留出高度
  const shelfH = shelf.length ? SKETCH_SHELF.top + SKETCH_SHELF.h : 0
  /** 按一块画布尺寸排：中心区可用区域、本层模块位置（相对内容原点）与内容范围、需要的画布尺寸 */
  const measure = (canvas: { w: number; h: number }) => {
    const availW = canvas.w - fixedW
    const gridArea = { w: availW - 2 * SKETCH_CENTER_PAD, h: canvas.h - 2 * SKETCH_FRAME_PAD - 2 * SKETCH_CENTER_PAD }
    const rel = sketchPositions(def, own, gridArea)
    const ps = Object.values(rel)
    const box = {
      minX: Math.min(0, ...ps.map(p => p.x)),
      minY: Math.min(0, ...ps.map(p => p.y)),
      maxX: Math.max(0, ...ps.map(p => p.x + SKETCH_NODE.w)),
      maxY: Math.max(0, ...ps.map(p => p.y + SKETCH_NODE.h)),
    }
    const needW = fixedW + Math.max(SKETCH_CENTER_MIN_W, box.maxX - box.minX + 2 * SKETCH_CENTER_PAD)
    const needH = 2 * SKETCH_FRAME_PAD + box.maxY - box.minY + 2 * SKETCH_CENTER_PAD + shelfH
    return { canvas, availW, gridArea, rel, ...box, needW, needH }
  }
  // 可用区域放不下（引用列 + 最小中心区，或人摆的本层模块）时，按视口的宽高比放大画布再排：适应画布后系统框仍占满视口，不留空白带
  const base = canvasArea(input.area)
  let m = measure(base)
  const k = Math.max(1, m.needW / base.w, m.needH / base.h)
  if (k > 1) m = measure({ w: Math.ceil(base.w * k), h: Math.ceil(base.h * k) })
  const { canvas, availW, gridArea, rel, minX, minY, maxX, maxY } = m
  const h = Math.max(canvas.h - 2 * SKETCH_FRAME_PAD, maxY - minY + 2 * SKETCH_CENTER_PAD + shelfH)
  const shelfW = SKETCH_SHELF.label + shelf.length * (SKETCH_SHELF.w + SKETCH_SHELF.gap)
  const center: SketchRect = {
    x: SKETCH_FRAME_PAD + left.length * step,
    y: SKETCH_FRAME_PAD,
    w: Math.max(availW, maxX - minX + 2 * SKETCH_CENTER_PAD, shelfW + 2 * SKETCH_CENTER_PAD),
    h,
  }
  const origin = { x: center.x + SKETCH_CENTER_PAD - minX, y: center.y + SKETCH_CENTER_PAD - minY }
  const pos = Object.fromEntries(Object.entries(rel).map(([id, p]) => [id, { x: p.x + origin.x, y: p.y + origin.y }]))
  shelf.forEach(
    (id, i) =>
      (pos[id] = {
        x: center.x + SKETCH_CENTER_PAD + SKETCH_SHELF.label + i * (SKETCH_SHELF.w + SKETCH_SHELF.gap),
        y: center.y + center.h - SKETCH_CENTER_PAD - SKETCH_SHELF.h,
      }),
  )

  // 列内顺序：按相连的本层模块的平均高度（重心），线少交叉；没有关系的按 ID 排在后面
  const ownSet = new Set(own)
  const ys = new Map<string, number[]>()
  for (const r of def.relations ?? []) {
    const ends = ownSet.has(r.from) && !ownSet.has(r.to) ? [r.from, r.to] : ownSet.has(r.to) && !ownSet.has(r.from) ? [r.to, r.from] : null
    if (!ends) continue
    const [inside, outside] = ends
    const ref = foldReference(def.mount, outside)
    ys.set(ref, [...(ys.get(ref) ?? []), pos[inside].y])
  }
  const bary = (id: string) => {
    const v = ys.get(id)
    return v ? v.reduce((a, b) => a + b, 0) / v.length : Infinity
  }
  const references = new Map<string, { position: SketchPoint; w: number; h: number; scale: number; side: 'left' | 'right' }>()
  const frames: SketchNode[] = []
  const frame = (id: string, kind: SketchFrameKind, name: string, r: SketchRect, extra: Partial<SketchNodeData> = {}): SketchNode => ({
    id: `frame:${id}`,
    position: { x: r.x, y: r.y },
    data: { id: `frame:${id}`, kind: 'frame', frame: kind, name, ...extra, w: r.w, h: r.h },
  })
  const place = (col: SketchColumn, x: number) => {
    const rect: SketchRect = { x, y: center.y, w: SKETCH_COLUMN.w, h }
    frames.push(frame(`col:${col.id}`, 'column', col.name, rect, col.tag ? { tag: col.tag } : {}))
    col.refs.sort((a, b) => bary(a) - bary(b) || (a < b ? -1 : a > b ? 1 : 0))
    const room = h - 2 * SKETCH_COLUMN.pad
    const full = col.refs.length * SKETCH_REF.h + (col.refs.length - 1) * SKETCH_REF.gap
    const scale = full > room ? room / full : 1
    const top = rect.y + SKETCH_COLUMN.pad + (room - full * scale) / 2
    const w = SKETCH_REF.w * scale
    col.refs.forEach((id, i) =>
      references.set(id, {
        position: { x: rect.x + (SKETCH_COLUMN.w - w) / 2, y: top + i * (SKETCH_REF.h + SKETCH_REF.gap) * scale },
        w,
        h: SKETCH_REF.h * scale,
        scale,
        side: col.side,
      }),
    )
  }
  left.forEach((c, i) => place(c, SKETCH_FRAME_PAD + i * step))
  right.forEach((c, i) => place(c, center.x + center.w + SKETCH_COLUMN.gap + i * step))
  const width = center.x + center.w + right.length * step + SKETCH_FRAME_PAD
  frames.unshift(
    frame('system', 'system', input.system ?? '系统', { x: 0, y: 0, w: width, h: h + 2 * SKETCH_FRAME_PAD }),
    frame('center', 'center', input.mountName ?? def.mount, center),
  )
  // SK-22：共用件架——中心区底部一行的浅框，标「共用件」
  if (shelf.length)
    frames.push(
      frame('shelf', 'shelf', '共用件', {
        x: center.x + SKETCH_CENTER_PAD - 8,
        y: center.y + center.h - SKETCH_CENTER_PAD - SKETCH_SHELF.h - 8,
        w: shelfW + 16 - SKETCH_SHELF.gap,
        h: SKETCH_SHELF.h + 16,
      }),
    )
  return { frames, references, pos, center, origin, gridArea, columns }
}

export function sketchScene(input: SketchSceneInput): SketchScene {
  const { def } = input
  const root = def.mount === ROOT_MOUNT
  const own = locateAll(def)
  const ownIds = new Set(own.map(m => m.id))
  const allRefs = root ? [] : referenceNodes(def)
  const refs = input.hideReferences ? [] : allRefs
  const band = root ? bandLayout(def) : null
  // SK-22：本层的共用件（根草图为层的直接子模块）收进架
  const shelf = new Set(own.filter(m => isSharedRole(m.node.role) && (root ? m.parentId !== undefined : !m.nested)).map(m => m.id))
  const bounds = root
    ? null
    : boundaryLayout(
        input,
        own.filter(m => !shelf.has(m.id)).map(m => m.id),
        allRefs,
        [...shelf],
      )
  const pos = band ? band.pos : bounds!.pos
  const sel = input.selected ?? new Set<string>()
  const layers: SketchNode[] = (band?.bands ?? []).map(b => {
    const layer = own.find(m => m.id === b.id)!.node
    // X13：七的软限只数非共用件
    const count = (layer.children ?? []).filter(k => !isSharedRole(k.role)).length
    return {
      id: b.id,
      position: { x: 0, y: b.y },
      data: {
        id: b.id,
        kind: 'layer' as const,
        name: layer.name || b.id,
        ...(layer.abstraction ? { abstraction: layer.abstraction } : {}),
        count,
        ...(count > SKETCH_SOFT_LIMIT ? { over: true } : {}),
        ...(input.changes?.get(b.id) ? { change: input.changes.get(b.id) } : {}),
        ...(sel.has(b.id) ? { selected: true } : {}),
        w: band!.width,
        h: b.h,
      },
    }
  })
  const modules: SketchNode[] = own
    .filter(m => !(root && m.parentId === undefined))
    .map(m => ({
      id: m.id,
      position: pos[m.id],
      data: {
        id: m.id,
        kind: 'module' as const,
        name: m.node.name || m.id,
        ...(m.node.role ? { role: m.node.role } : {}),
        ...(input.deeper?.(m.id) ? { deeper: true } : {}),
        ...(input.changes?.get(m.id) ? { change: input.changes.get(m.id) } : {}),
        ...(sel.has(m.id) ? { selected: true } : {}),
        ...(shelf.has(m.id) ? { shelf: true } : {}),
        ...portMarks(def, m.id),
        ...(shelf.has(m.id)
          ? { w: SKETCH_SHELF.w, h: SKETCH_SHELF.h }
          : m.node.role === 'core'
            ? { w: SKETCH_CORE.w, h: SKETCH_CORE.h }
            : { w: SKETCH_NODE.w, h: SKETCH_NODE.h }),
      },
    }))
  const references: SketchNode[] = refs.map(id => {
    const rels = referenceRelations(def, id)
    const members = [...new Set(rels.map(r => (ownIds.has(r.from) ? r.to : r.from)))]
    const at = bounds!.references.get(id)!
    return {
      id,
      position: at.position,
      data: {
        id,
        kind: 'reference' as const,
        name: input.nameOf(id) ?? id,
        ...(rels.length ? { relations: rels.length } : {}),
        ...(members.some(x => x !== id) ? { members } : {}),
        ...(sel.has(id) ? { selected: true } : {}),
        scale: at.scale,
        side: at.side,
        w: at.w,
        h: at.h,
      },
    }
  })
  const nodes = [...(bounds?.frames ?? []), ...layers, ...modules, ...references]
  const sideOf = new Map(references.map(n => [n.id, n.data.side!]))

  // 边：本层之间的关系一条一条画；一端是引用的按（显示起点、显示终点）聚合
  const shown = new Set([...layers, ...modules, ...references].map(n => n.id))
  const display = (id: string) => (ownIds.has(id) ? id : foldReference(def.mount, id))
  const pending = new Set(input.pending ?? [])
  type Group = { source: string; target: string; rels: NonNullable<SketchDef['relations']> }
  const groups: Group[] = []
  const agg = new Map<string, Group>()
  for (const r of def.relations ?? []) {
    const [a, b] = [display(r.from), display(r.to)]
    if (!shown.has(a) || !shown.has(b) || a === b) continue
    const external = !ownIds.has(r.from) || !ownIds.has(r.to)
    if (!external) {
      groups.push({ source: a, target: b, rels: [r] })
      continue
    }
    const key = `${a}\0${b}`
    const hit = agg.get(key)
    if (hit) hit.rels.push(r)
    else {
      const g = { source: a, target: b, rels: [r] }
      agg.set(key, g)
      groups.push(g)
    }
  }
  const pairKey = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`)
  const edgeId = (g: Group) => (g.rels.length === 1 ? g.rels[0].id : aggregateEdgeId(g.source, g.target))
  const pairs = new Map<string, string[]>()
  for (const g of groups) pairs.set(pairKey(g.source, g.target), [...(pairs.get(pairKey(g.source, g.target)) ?? []), edgeId(g)])
  const edges: SketchEdge[] = groups.map(g => {
    const id = edgeId(g)
    const group = pairs.get(pairKey(g.source, g.target))!
    const i = group.indexOf(id)
    // 方向统一按字典序较小的一端为起点算平移，反向的线取负号，同一对的线才真正错开
    const sign = g.source < g.target ? 1 : -1
    const offset = (i - (group.length - 1) / 2) * SKETCH_PARALLEL_GAP * sign
    const r = g.rels[0]
    const many = g.rels.length > 1
    const types = [...new Set(g.rels.map(x => x.type))]
    const change = g.rels.map(x => input.changes?.get(x.id)).find(Boolean)
    return {
      id,
      source: g.source,
      target: g.target,
      data: {
        relationId: r.id,
        ...(many ? { relationIds: g.rels.map(x => x.id), reference: ownIds.has(g.source) ? g.target : g.source } : {}),
        type: types.length === 1 ? types[0] : 'mixed',
        ...(!many && r.description ? { description: r.description } : {}),
        offset,
        label: many ? null : (def.layout?.relations?.[r.id]?.label ?? null),
        ...(g.rels.some(x => pending.has(x.id)) ? { pending: true } : {}),
        ...(g.rels.some(x => parseVia(x.via)?.kind === 'port') ? { port: true } : {}),
        ...(g.rels.some(x => isCallbackVia(x.via)) ? { callback: true } : {}),
        ...(Object.keys(mechs(g.rels)).length ? { mechs: mechs(g.rels) } : {}),
        ...(change ? { change } : {}),
        ...(sel.has(id) || (!many && sel.has(r.id)) ? { selected: true } : {}),
        ...(sideOf.has(g.source) ? { external: sideOf.get(g.source), refEnd: 'source' as const } : {}),
        ...(sideOf.has(g.target) ? { external: sideOf.get(g.target), refEnd: 'target' as const } : {}),
      },
    }
  })
  const count = (root ? own.filter(m => m.parentId !== undefined) : own).filter(m => !shelf.has(m.id)).length
  return {
    nodes,
    edges,
    bands: band?.bands ?? [],
    needsLayout: !own.some(m => def.layout?.modules?.[m.id]),
    count,
    center: bounds?.center ?? null,
    origin: bounds?.origin ?? { x: 0, y: 0 },
    ...(bounds ? { gridArea: bounds.gridArea } : {}),
    columns: bounds?.columns ?? [],
  }
}

/** X24：草图里模块定义的接口——端口记号（接口写在定义模块所在的草图，X10；草图里写了即可声明实现者） */
function portMarks(def: SketchDef, id: string): Pick<SketchNodeData, 'ports'> {
  const list = (def.interfaces ?? []).filter(x => x.owner === id)
  return list.length ? { ports: list.map(x => ({ id: x.id, name: x.name, implementers: x.implementedBy?.length ?? 0 })) } : {}
}

/** X22：拖动的落点离开了中心区（挂载点框）——松手 = 升级到上一层；根草图没有中心区 */
export function outsideCenter(scene: Pick<SketchScene, 'center'>, p: SketchPoint): boolean {
  const c = scene.center
  return !!c && (p.x < c.x || p.x > c.x + c.w || p.y < c.y || p.y > c.y + c.h)
}

/** X21：根草图里一个点落在哪条层带（不在任何带上为 null） */
export function bandAt(bands: readonly SketchBand[], y: number): string | null {
  return bands.find(b => y >= b.y && y <= b.y + b.h)?.id ?? null
}

/** 直线边的几何：两中心连线平移 offset 后，裁到两端节点的边框；返回起点、终点与中点 */
export function straightEdge(
  a: SketchPoint,
  b: SketchPoint,
  sizeA: { w: number; h: number },
  sizeB: { w: number; h: number },
  offset = 0,
): { from: SketchPoint; to: SketchPoint; mid: SketchPoint } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const a2 = { x: a.x + nx * offset, y: a.y + ny * offset }
  const b2 = { x: b.x + nx * offset, y: b.y + ny * offset }
  /** 从中心 c 沿方向 (ux, uy) 到半宽 hw、半高 hh 的矩形边框的距离 */
  const reach = (hw: number, hh: number, ux: number, uy: number) => Math.min(ux ? hw / Math.abs(ux) : Infinity, uy ? hh / Math.abs(uy) : Infinity)
  const ux = dx / len
  const uy = dy / len
  const ra = Math.min(reach(sizeA.w / 2, sizeA.h / 2, ux, uy), len / 2)
  const rb = Math.min(reach(sizeB.w / 2, sizeB.h / 2, ux, uy), len / 2)
  const from = { x: a2.x + ux * ra, y: a2.y + uy * ra }
  const to = { x: b2.x - ux * rb, y: b2.y - uy * rb }
  return { from, to, mid: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } }
}
