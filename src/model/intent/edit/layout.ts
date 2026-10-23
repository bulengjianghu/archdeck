/**
 * 位置与引用节点（X15、X19，ADR-0025）：拖动节点、拖动关系标签、重新排列（网格）、把外部模块放上画布；挂载点的原则（X10）。
 * 引用节点不单独存：它是一端在范围外的关系的外部端点，位置按它的模块 ID 记在 layout.modules；还没有关系的引用只在会话里，
 * 保存前由 dropOrphanReferences 丢弃并给出清单。纯函数。
 */
import { ROOT_MOUNT, type SketchDef, type SketchLayout, type SketchPoint } from '../../types'
import type { EditContext } from '../types'
import { locateAll } from './locate'
import { done, isKnown, reject, type OpOutcome } from './shared'

const GAP_X = 220
const GAP_Y = 140
const ORIGIN = 40

/** X19：本张草图的引用节点——一端在范围外的关系的外部端点，加上布局里放上画布、还不是本草图模块的 */
export function referenceNodes(def: SketchDef): string[] {
  const own = new Set(locateAll(def).map(m => m.id))
  const out: string[] = []
  const add = (id: string) => {
    if (!own.has(id) && !out.includes(id)) out.push(id)
  }
  for (const r of def.relations ?? []) {
    if (own.has(r.from)) add(r.to)
    else if (own.has(r.to)) add(r.from)
  }
  for (const id of Object.keys(def.layout?.modules ?? {})) add(id)
  return out
}

/** X15：网格布局——本层模块在前、引用节点在后；根挂载时每层一行（层在行首，第二级随后） */
export function gridLayout(def: SketchDef): SketchLayout {
  const modules: Record<string, SketchPoint> = {}
  const at = (col: number, row: number): SketchPoint => ({ x: ORIGIN + col * GAP_X, y: ORIGIN + row * GAP_Y })
  let rows = 0
  if (def.mount === ROOT_MOUNT) {
    ;(def.modules ?? []).forEach((layer, row) => {
      modules[layer.id] = at(0, row)
      ;(layer.children ?? []).forEach((kid, col) => (modules[kid.id] = at(col + 1, row)))
      rows = row + 1
    })
  } else {
    const own = (def.modules ?? []).map(m => m.id)
    const cols = Math.max(1, Math.ceil(Math.sqrt(own.length)))
    own.forEach((id, i) => (modules[id] = at(i % cols, Math.floor(i / cols))))
    rows = Math.ceil(own.length / cols)
  }
  referenceNodes(def).forEach((id, i) => (modules[id] = at(i, rows + 1)))
  return { modules }
}

const layoutOf = (def: SketchDef): SketchLayout => (def.layout ??= {})

export function moveNode(def: SketchDef, ctx: EditContext, positions: Readonly<Record<string, SketchPoint>>): OpOutcome {
  const ids = Object.keys(positions)
  if (!ids.length) return reject('invalid', '没有要移动的节点')
  const missing = ids.filter(id => !isKnown(def, ctx, id) && !referenceNodes(def).includes(id))
  if (missing.length) return reject('not-found', `画布上没有：${missing.join('、')}`)
  const modules = (layoutOf(def).modules ??= {})
  for (const id of ids) modules[id] = { x: positions[id].x, y: positions[id].y }
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

/** X15：重新排列覆盖本张的模块坐标（关系标签回到缺省位置） */
export function autoArrange(def: SketchDef): OpOutcome {
  def.layout = gridLayout(def)
  return done()
}

export function addReference(def: SketchDef, ctx: EditContext, id: string, at?: SketchPoint): OpOutcome {
  if (locateAll(def).some(m => m.id === id)) return reject('invalid', `「${id}」是本草图的模块，不是引用`)
  if (id === def.mount) return reject('invalid', '挂载点不能作为引用节点')
  if (!isKnown(def, ctx, id)) return reject('not-found', `找不到模块「${id}」`)
  const modules = (layoutOf(def).modules ??= {})
  if (!modules[id]) modules[id] = at ?? gridLayout(def).modules![id] ?? { x: ORIGIN, y: ORIGIN }
  return done({ created: [id] })
}

export function setAbstraction(def: SketchDef, text: string): OpOutcome {
  if (def.mount === ROOT_MOUNT) return reject('invalid', '根挂载没有父模块原则：各层的原则写在层的 abstraction 等字段（X10）')
  if (text.trim()) def.abstraction = text.trim()
  else delete def.abstraction
  return done()
}

/**
 * X19：保存前丢弃没有关系的引用节点（布局里既不是本草图模块、也不是任何关系端点的位置）与已不存在的关系的标签位置；
 * 返回丢弃后的草图与丢弃的引用（供提示）。
 */
export function dropOrphanReferences(def: SketchDef): { sketch: SketchDef; dropped: string[] } {
  if (!def.layout) return { sketch: def, dropped: [] }
  const own = new Set(locateAll(def).map(m => m.id))
  const ends = new Set((def.relations ?? []).flatMap(r => [r.from, r.to]))
  const dropped = Object.keys(def.layout.modules ?? {}).filter(id => !own.has(id) && !ends.has(id))
  const relIds = new Set((def.relations ?? []).map(r => r.id))
  const staleLabels = Object.keys(def.layout.relations ?? {}).filter(id => !relIds.has(id))
  if (!dropped.length && !staleLabels.length) return { sketch: def, dropped }
  const sketch = structuredClone(def)
  for (const id of dropped) delete sketch.layout!.modules![id]
  for (const id of staleLabels) delete sketch.layout!.relations![id]
  if (sketch.layout!.modules && !Object.keys(sketch.layout!.modules).length) delete sketch.layout!.modules
  if (sketch.layout!.relations && !Object.keys(sketch.layout!.relations).length) delete sketch.layout!.relations
  if (!Object.keys(sketch.layout!).length) delete sketch.layout
  return { sketch, dropped }
}
