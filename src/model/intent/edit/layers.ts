/**
 * 层操作（C-1、C-2、C-3、C-9，ADR-0052）：根草图的层即根的单成员层——加层（新建根的子模块与它的层，按插入位置给 order，层序重排为 1…N）、
 * 层排序、删层（同删除模块，层随之删掉）、可依赖的层（写在 strata 的层上，按层 ID）。操作里的「层」按带寻址，即成员模块 ID。
 */
import { ROOT_MOUNT, type SketchDef } from '../../types'
import type { EditContext } from '../types'
import { migrateSketch } from '../../load'
import { moduleId, takenIds } from './locate'
import { removeModule } from './modules'
import { checkNewId, done, ownModule, reject, type OpOutcome } from './shared'
import { isRootLayer, renumberRoot, strataIn, stratumOfMember } from './strata'

/**
 * 设计草图还没写根的分层、持久草图（骨架）写了时，先整份带上（X7b、ADR-0052：同一父模块的分层草图之间后者整份覆盖前者，
 * 改层序就要写全；持久草图本身不动）
 */
function ensureRootStrata(def: SketchDef, ctx: EditContext): void {
  if (def.strata?.[ROOT_MOUNT]) return
  const from = ctx.persistent.map(p => migrateSketch(p.def)).find(d => d.mount === ROOT_MOUNT && d.strata?.[ROOT_MOUNT])?.strata?.[ROOT_MOUNT]
  if (from) (def.strata ??= {})[ROOT_MOUNT] = structuredClone(from)
}

/** 根的层带（成员模块 ID），按层序：根的分层里的成员在前，没归层的本草图顶层模块在后 */
const bandsOf = (def: SketchDef) => {
  const listed = [...strataIn(def, ROOT_MOUNT)].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity)).flatMap(s => s.members ?? [])
  const rest = (def.modules ?? []).filter(m => m.parent === undefined && !listed.includes(m.id)).map(m => m.id)
  return [...listed, ...rest]
}

/** 把带 id 放到第 pos 位，层序重排为 1…N */
function placeLayer(def: SketchDef, id: string, pos: number): void {
  const rest = bandsOf(def).filter(x => x !== id)
  rest.splice(Math.max(0, Math.min(pos, rest.length)), 0, id)
  renumberRoot(def, rest)
}

export function addLayer(def: SketchDef, ctx: EditContext, name: string, at: number, id?: string): OpOutcome {
  if (!name.trim()) return reject('invalid', '层名称不能为空')
  if (def.mount !== ROOT_MOUNT) return reject('root-only', '层的增删改排序只在根草图里做（X7）')
  const newId = id?.trim() || moduleId(undefined, name, takenIds(def, ctx.persistent))
  const bad = checkNewId(def, ctx, newId, undefined)
  if (bad) return bad
  ensureRootStrata(def, ctx)
  ;(def.modules ??= []).push({ id: newId, name: name.trim() })
  const strata = (def.strata ??= {})
  ;(strata[ROOT_MOUNT] ??= []).push({ id: newId, name: name.trim(), members: [newId] })
  placeLayer(def, newId, at)
  return done({ created: [newId] })
}

export function reorderLayer(def: SketchDef, ctx: EditContext, id: string, to: number): OpOutcome {
  const own = ownModule(def, ctx, id)
  if (!own.ok) return own.out
  ensureRootStrata(def, ctx)
  if (!isRootLayer(def, id) || !stratumOfMember(def, ROOT_MOUNT, id)) return reject('invalid', `「${id}」不是层`)
  placeLayer(def, id, to)
  return done()
}

export function setMayDependOn(def: SketchDef, ctx: EditContext, id: string, deps: readonly string[]): OpOutcome {
  const own = ownModule(def, ctx, id)
  if (!own.ok) return own.out
  ensureRootStrata(def, ctx)
  const layer = isRootLayer(def, id) ? stratumOfMember(def, ROOT_MOUNT, id) : undefined
  if (!layer) return reject('invalid', `「${id}」不是层，可依赖的层只写在层上`)
  if (deps.includes(id)) return reject('invalid', '层不能依赖自己')
  const targets = deps.map(d => ({ d, s: isRootLayer(def, d) ? stratumOfMember(def, ROOT_MOUNT, d) : undefined }))
  const missing = targets.filter(t => !t.s).map(t => t.d)
  if (missing.length) return reject('not-found', `不是草图里的层：${missing.join('、')}`)
  layer.mayDependOn = [...new Set(targets.map(t => t.s!.id))]
  return done()
}

/** C-3：删层同删除模块（连子树一起删，它的层随之删掉） */
export const removeLayer = removeModule
