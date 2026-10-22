/**
 * 层操作（C-1、C-2、C-3、C-9）：加层（按插入位置给 order，其后的层顺延）、层排序（重排 order 为 1…N）、删层（同删除模块）、可依赖的层。
 * order：层全是本草图的（编辑持久草图本身）时重排为 1…N；设计草图里有持久草图的层（只读，X7b）时，新加或移动的层取前后两层 order 的中点，不动别的层。
 */
import type { ModuleDef, SketchDef } from '../../types'
import type { EditContext } from '../types'
import { knownModules, locateAll, moduleId, takenIds } from './locate'
import { removeModule } from './modules'
import { checkNewId, done, ownModule, reject, type OpOutcome } from './shared'

/** 编辑中可见的全部层（本草图 ∪ 持久草图，根下），按 order 排序；own 表示在本草图里 */
const allLayers = (def: SketchDef, ctx: EditContext) => {
  const own = new Set(locateAll(def).filter(m => m.parentId === undefined && m.node.kind === 'layer').map(m => m.node))
  return [...knownModules(def, ctx.persistent).values()]
    .filter(m => m.parentId === undefined && m.node.kind === 'layer')
    .map(m => ({ node: m.node, own: own.has(m.node) }))
    .sort((a, b) => (a.node.order ?? 0) - (b.node.order ?? 0))
}

/** 把 node 放到全部层里的第 pos 位：全是本草图的层时重排 1…N，否则取前后两层的中点 */
function placeLayer(def: SketchDef, ctx: EditContext, node: ModuleDef, pos: number): void {
  const rest = allLayers(def, ctx).filter(l => l.node !== node)
  const at = Math.max(0, Math.min(pos, rest.length))
  if (rest.every(l => l.own)) {
    rest.splice(at, 0, { node, own: true })
    rest.forEach((l, i) => (l.node.order = i + 1))
    return
  }
  const before = rest[at - 1]?.node.order
  const after = rest[at]?.node.order
  node.order = before === undefined ? (after ?? 1) - 1 : after === undefined ? before + 1 : (before + after) / 2
}

export function addLayer(def: SketchDef, ctx: EditContext, name: string, at: number, id?: string): OpOutcome {
  if (!name.trim()) return reject('invalid', '层名称不能为空')
  const newId = id?.trim() || moduleId(undefined, name, takenIds(def, ctx.persistent))
  const bad = checkNewId(def, ctx, newId, undefined)
  if (bad) return bad
  const node = { id: newId, name: name.trim(), kind: 'layer', order: 0 }
  ;(def.modules ??= []).push(node)
  placeLayer(def, ctx, node, at)
  return done({ created: [newId] })
}

export function reorderLayer(def: SketchDef, ctx: EditContext, id: string, to: number): OpOutcome {
  const own = ownModule(def, ctx, id)
  if (!own.ok) return own.out
  if (own.node.kind !== 'layer') return reject('invalid', `「${id}」不是层`)
  placeLayer(def, ctx, own.node, to)
  return done()
}

export function setMayDependOn(def: SketchDef, ctx: EditContext, id: string, deps: readonly string[]): OpOutcome {
  const own = ownModule(def, ctx, id)
  if (!own.ok) return own.out
  if (own.node.kind !== 'layer') return reject('invalid', `「${id}」不是层，可依赖的层只写在层上`)
  if (deps.includes(id)) return reject('invalid', '层不能依赖自己')
  const known = knownModules(def, ctx.persistent)
  const missing = deps.filter(d => known.get(d)?.node.kind !== 'layer')
  if (missing.length) return reject('not-found', `不是草图里的层：${missing.join('、')}`)
  own.node.mayDependOn = [...new Set(deps)]
  return done()
}

/** C-3：删层同删除模块（连子树一起删） */
export const removeLayer = removeModule
