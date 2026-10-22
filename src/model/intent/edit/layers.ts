/**
 * 层操作（C-1、C-2、C-3、C-9）：加层（按插入位置给 order，其后的层顺延）、层排序（重排 order 为 1…N）、删层（同删除模块）、可依赖的层。
 * order 只重排本草图里的层：持久草图的层在设计草图里只读（X7b）。
 */
import type { SketchDef } from '../../types'
import type { EditContext } from '../types'
import { knownModules, locateAll, moduleId, takenIds } from './locate'
import { removeModule } from './modules'
import { checkNewId, done, ownModule, reject, type OpOutcome } from './shared'

/** 本草图根下的层，按 order 排序 */
const ownLayers = (def: SketchDef) =>
  locateAll(def)
    .filter(m => m.parentId === undefined && m.node.kind === 'layer')
    .sort((a, b) => (a.node.order ?? 0) - (b.node.order ?? 0))

export function addLayer(def: SketchDef, ctx: EditContext, name: string, at: number, id?: string): OpOutcome {
  if (!name.trim()) return reject('invalid', '层名称不能为空')
  const newId = id?.trim() || moduleId(undefined, name, takenIds(def, ctx.persistent))
  const bad = checkNewId(def, ctx, newId, undefined)
  if (bad) return bad
  const layers = ownLayers(def).map(m => m.node)
  const pos = Math.max(0, Math.min(at, layers.length))
  const node = { id: newId, name: name.trim(), kind: 'layer', order: 0 }
  ;(def.modules ??= []).push(node)
  layers.splice(pos, 0, node)
  layers.forEach((l, i) => (l.order = i + 1))
  return done({ created: [newId] })
}

export function reorderLayer(def: SketchDef, ctx: EditContext, id: string, to: number): OpOutcome {
  const own = ownModule(def, ctx, id)
  if (!own.ok) return own.out
  if (own.node.kind !== 'layer') return reject('invalid', `「${id}」不是层`)
  const layers = ownLayers(def).map(m => m.node)
  const from = layers.indexOf(own.node)
  layers.splice(from, 1)
  layers.splice(Math.max(0, Math.min(to, layers.length)), 0, own.node)
  layers.forEach((l, i) => (l.order = i + 1))
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
