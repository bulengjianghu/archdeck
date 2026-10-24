/**
 * 位置与引用节点（X15、X19、X21、X22，ADR-0025）：拖动节点、拖动关系标签、重新排列、把外部模块放上画布；挂载点的原则（X10）。
 * 引用节点不单独存：它是一端在范围外的关系的外部端点，按「与挂载点同深度的祖先」折叠显示（05 裁决 4）——同一折叠节点的多条关系在画布上
 * 合成一条显示边，数据仍记精确端点。引用节点的位置由规则算（X22：按所属层成列，草图布局 state.layout.sketch），layout 不记；
 * 还没有关系的引用在会话里以 layout.modules 的键占位（值不用），保存前由 layoutForSave 去掉全部引用的键并给出没有关系而丢掉的清单。
 * 非根草图的模块坐标相对中心区（挂载点框）的内容原点（X22）。
 * 根草图（X21）：层画成横向带，layout 对层不记位置，带内的第二级模块记 x 与 y（y 相对带顶），带高随内容增长。纯函数。
 */
import { ROOT_MOUNT, type ModuleDef, type RelationDef, type SketchDef, type SketchLayout, type SketchPoint, type SketchSpot } from '../../types'
import type { EditContext } from '../types'
import { locateAll } from './locate'
import { done, isKnown, reject, type OpOutcome } from './shared'

/** 本层网格（非根草图）：列距与行距 */
export const GRID_GAP_X = 220
export const GRID_GAP_Y = 120
/** 网格里一个模块的宽与高（与画布的模块节点同尺寸） */
const GRID_NODE_W = 168
const GRID_NODE_H = 56
/** X21：根草图层带里第一个模块的 x（左边留给带头） */
export const ROOT_BAND_X0 = 240
/** X21：根草图层带里模块之间的横向间距 */
export const ROOT_BAND_GAP = 200
/** X21（T2b 裁决 3）：根草图层带里初始布局每行的列数（多了折行） */
export const ROOT_BAND_COLS = 5
/** X21：带内第一行模块距带顶（y 相对带顶）与行距 */
export const ROOT_BAND_PAD = 28
export const ROOT_BAND_ROW = 84

/** X19、05 裁决 4：外部端点显示为「与挂载点同深度的祖先」；挂载点子树内（本层模块的后代）折叠到本层模块；根草图不折叠 */
export function foldReference(mount: string, id: string): string {
  if (mount === ROOT_MOUNT) return id
  const depth = mount.split('.').length
  const parts = id.split('.')
  const keep = id.startsWith(`${mount}.`) ? depth + 1 : depth
  return parts.length > keep ? parts.slice(0, keep).join('.') : id
}

/** 本草图一端在范围外的关系的外部端点（精确 ID） */
function externalEnds(def: SketchDef, own: ReadonlySet<string>): { rel: RelationDef; end: string; dir: 'in' | 'out' }[] {
  const out: { rel: RelationDef; end: string; dir: 'in' | 'out' }[] = []
  for (const r of def.relations ?? []) {
    if (own.has(r.from) && !own.has(r.to)) out.push({ rel: r, end: r.to, dir: 'out' })
    else if (own.has(r.to) && !own.has(r.from)) out.push({ rel: r, end: r.from, dir: 'in' })
  }
  return out
}

/**
 * X19：本张草图的引用节点（显示用 ID）——一端在范围外的关系的外部端点按挂载点深度折叠，
 * 加上布局里放上画布、还不是本草图模块、也不是某条关系精确端点的（「引用外部模块」放上来的，或折叠节点的位置）
 */
export function referenceNodes(def: SketchDef): string[] {
  const own = new Set(locateAll(def).map(m => m.id))
  const out: string[] = []
  const add = (id: string) => {
    if (!own.has(id) && !out.includes(id)) out.push(id)
  }
  const ends = externalEnds(def, own)
  for (const e of ends) add(foldReference(def.mount, e.end))
  const precise = new Set(ends.map(e => e.end))
  for (const id of Object.keys(def.layout?.modules ?? {})) if (!precise.has(id) || foldReference(def.mount, id) === id) add(id)
  return out
}

/** X19：折叠进一个引用节点的关系（精确端点仍在数据里；面板展开列出） */
export function referenceRelations(def: SketchDef, ref: string): RelationDef[] {
  const own = new Set(locateAll(def).map(m => m.id))
  return externalEnds(def, own)
    .filter(e => e.end === ref || foldReference(def.mount, e.end) === ref)
    .map(e => e.rel)
}

/** X22：中心区排网格的可用区域（画布宽 − 两侧引用列宽；高可缺省） */
export interface GridArea {
  w: number
  h?: number
}

/**
 * X15、X22：初始布局——非根草图的本层模块在中心区里排成网格（坐标相对中心区的内容原点）：给了可用区域时每行放得下几个就放几个、
 * 整块居中，没给时取近似方阵；引用节点不进 layout（位置由规则算）。
 * X21：根草图按层带——第二级模块在带内按 ROOT_BAND_COLS 列排开、多了折行（y 相对带顶），层不记位置。
 */
export function gridLayout(def: SketchDef, area?: GridArea): SketchLayout {
  const modules: Record<string, SketchSpot> = {}
  if (def.mount === ROOT_MOUNT) {
    for (const layer of def.modules ?? [])
      (layer.children ?? []).forEach(
        (kid, i) =>
          (modules[kid.id] = {
            x: ROOT_BAND_X0 + (i % ROOT_BAND_COLS) * ROOT_BAND_GAP,
            y: ROOT_BAND_PAD + Math.floor(i / ROOT_BAND_COLS) * ROOT_BAND_ROW,
          }),
      )
    return { modules }
  }
  const own = (def.modules ?? []).map(m => m.id)
  const fit = area ? Math.max(1, Math.floor((area.w - GRID_NODE_W) / GRID_GAP_X) + 1) : Math.ceil(Math.sqrt(own.length))
  const cols = Math.max(1, Math.min(own.length, fit))
  const rows = Math.ceil(own.length / cols)
  const x0 = area ? Math.max(0, Math.round((area.w - ((cols - 1) * GRID_GAP_X + GRID_NODE_W)) / 2)) : 0
  const y0 = area?.h ? Math.max(0, Math.round((area.h - ((rows - 1) * GRID_GAP_Y + GRID_NODE_H)) / 2)) : 0
  own.forEach((id, i) => (modules[id] = { x: x0 + (i % cols) * GRID_GAP_X, y: y0 + Math.floor(i / cols) * GRID_GAP_Y }))
  return { modules }
}

/** X21：根草图里一个模块在布局里记的样子——层不记，第二级记 x 与 y（y 相对带顶，不小于 0；调用方换算好） */
function spotFor(def: SketchDef, layers: ReadonlySet<string>, id: string, p: SketchPoint | SketchSpot): SketchSpot | null {
  if (def.mount !== ROOT_MOUNT) return { x: p.x, y: p.y ?? 0 }
  if (layers.has(id)) return null
  return { x: p.x, y: Math.max(0, p.y ?? ROOT_BAND_PAD) }
}

const layerIds = (def: SketchDef): Set<string> =>
  new Set(def.mount === ROOT_MOUNT ? (def.modules ?? []).filter((m: ModuleDef) => m.kind === 'layer' || m.children).map(m => m.id) : [])

const layoutOf = (def: SketchDef): SketchLayout => (def.layout ??= {})

export function moveNode(def: SketchDef, ctx: EditContext, positions: Readonly<Record<string, SketchPoint>>): OpOutcome {
  const ids = Object.keys(positions)
  if (!ids.length) return reject('invalid', '没有要移动的节点')
  const missing = ids.filter(id => !isKnown(def, ctx, id) && !referenceNodes(def).includes(id))
  if (missing.length) return reject('not-found', `画布上没有：${missing.join('、')}`)
  // X22：引用节点的位置由规则算，layout 不记
  const own = new Set(locateAll(def).map(m => m.id))
  const placed = ids.filter(id => own.has(id))
  if (!placed.length) return reject('invalid', '引用节点的位置按所属层排布，不能拖动（X22）')
  const modules = (layoutOf(def).modules ??= {})
  const layers = layerIds(def)
  for (const id of placed) {
    const spot = spotFor(def, layers, id, positions[id])
    if (spot) modules[id] = spot
  }
  if (!Object.keys(modules).length) delete def.layout!.modules
  if (!Object.keys(def.layout!).length) delete def.layout
  return done()
}

export function relabel(def: SketchDef, _ctx: EditContext, id: string, label: SketchPoint | null): OpOutcome {
  if (!def.relations?.some(r => r.id === id)) return reject('not-found', `草图里没有关系「${id}」`)
  const relations = (layoutOf(def).relations ??= {})
  if (label) relations[id] = { label: { x: label.x, y: label.y } }
  else delete relations[id]
  if (!Object.keys(relations).length) delete def.layout!.relations
  return done()
}

/**
 * X15、X22：重新排列覆盖本张的模块坐标（关系标签回到缺省位置）；area 为中心区的可用区域（宽 = 画布宽 − 两侧引用列宽）。
 * 还没有关系的引用的占位保留（它们只在会话里，保存时去掉）
 */
export function autoArrange(def: SketchDef, area?: GridArea): OpOutcome {
  const own = new Set(locateAll(def).map(m => m.id))
  const marks = Object.keys(def.layout?.modules ?? {}).filter(id => !own.has(id))
  def.layout = gridLayout(def, area)
  for (const id of marks) def.layout.modules![id] = { x: 0, y: 0 }
  return done()
}

/** X19、X22：把外部模块放上画布作为待连端点——会话里以 layout.modules 的键占位（值不用；位置按所属层排布），连上关系前保存即丢掉 */
export function addReference(def: SketchDef, ctx: EditContext, id: string): OpOutcome {
  if (locateAll(def).some(m => m.id === id)) return reject('invalid', `「${id}」是本草图的模块，不是引用`)
  if (def.mount === ROOT_MOUNT) return reject('root-only', '根草图没有外部引用：两端都是层或第二级模块（X19）')
  if (id === def.mount) return reject('invalid', '挂载点不能作为引用节点')
  if (!isKnown(def, ctx, id)) return reject('not-found', `找不到模块「${id}」`)
  const modules = (layoutOf(def).modules ??= {})
  modules[id] ??= { x: 0, y: 0 }
  return done({ created: [id] })
}

/** X19：删引用节点——折叠进它的关系与它（及其精确端点）在布局里的位置一并删 */
export function removeReference(def: SketchDef, id: string): OpOutcome {
  if (locateAll(def).some(m => m.id === id)) return reject('invalid', `「${id}」是本草图的模块，不是引用`)
  if (!referenceNodes(def).includes(id)) return reject('not-found', `画布上没有引用节点「${id}」`)
  const rels = referenceRelations(def, id)
  const gone = rels.map(r => r.id)
  const ends = new Set(rels.flatMap(r => [r.from, r.to]))
  if (def.relations) {
    def.relations = def.relations.filter(r => !gone.includes(r.id))
    if (!def.relations.length) delete def.relations
  }
  if (def.layout?.modules) {
    delete def.layout.modules[id]
    for (const e of ends) if (foldReference(def.mount, e) === id) delete def.layout.modules[e]
  }
  for (const r of gone) if (def.layout?.relations) delete def.layout.relations[r]
  if (def.layout?.modules && !Object.keys(def.layout.modules).length) delete def.layout.modules
  if (def.layout?.relations && !Object.keys(def.layout.relations).length) delete def.layout.relations
  if (def.layout && !Object.keys(def.layout).length) delete def.layout
  return done({ removed: [id, ...gone] })
}

export function setAbstraction(def: SketchDef, text: string): OpOutcome {
  if (def.mount === ROOT_MOUNT) return reject('invalid', '根挂载没有父模块原则：各层的原则写在层的 abstraction 等字段（X10）')
  if (text.trim()) def.abstraction = text.trim()
  else delete def.abstraction
  return done()
}

/**
 * X19、X22：保存前的 layout——去掉全部引用节点的键（引用的位置由规则算，旧草图里记下的坐标也在这里去掉）与已不存在的关系的标签位置；
 * 返回去掉后的草图与其中没有关系而丢掉的引用（供提示；有关系的引用只是不记坐标，关系照存）。
 */
export function layoutForSave(def: SketchDef): { sketch: SketchDef; dropped: string[] } {
  if (!def.layout) return { sketch: def, dropped: [] }
  const own = new Set(locateAll(def).map(m => m.id))
  const ends = new Set((def.relations ?? []).flatMap(r => [r.from, r.to]).flatMap(e => [e, foldReference(def.mount, e)]))
  const foreign = Object.keys(def.layout.modules ?? {}).filter(id => !own.has(id))
  const dropped = foreign.filter(id => !ends.has(id))
  const relIds = new Set((def.relations ?? []).map(r => r.id))
  const staleLabels = Object.keys(def.layout.relations ?? {}).filter(id => !relIds.has(id))
  if (!foreign.length && !staleLabels.length) return { sketch: def, dropped }
  const sketch = structuredClone(def)
  for (const id of foreign) delete sketch.layout!.modules![id]
  for (const id of staleLabels) delete sketch.layout!.relations![id]
  if (sketch.layout!.modules && !Object.keys(sketch.layout!.modules).length) delete sketch.layout!.modules
  if (sketch.layout!.relations && !Object.keys(sketch.layout!.relations).length) delete sketch.layout!.relations
  if (!Object.keys(sketch.layout!).length) delete sketch.layout
  return { sketch, dropped }
}
