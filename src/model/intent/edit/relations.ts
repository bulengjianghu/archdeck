/**
 * 关系与接口操作（C-8、C-10、P-3、P-4，X7b、X7c）：连关系（同一对模块同类型已有时拒绝，连祖先与后代拒绝）、改、删；
 * 接口的增删改（owner 固定为所在模块，删接口时去掉关系上对它的引用）。
 */
import type { RelationType, SketchDef } from '../../types'
import type { EditContext } from '../types'
import { interfaceId, knownModules, relationId, takenIds } from './locate'
import { done, isAncestor, reject, type OpOutcome } from './shared'

const allRelations = (def: SketchDef, ctx: EditContext) => [...(def.relations ?? []), ...ctx.persistent.flatMap(p => p.def.relations ?? [])]

function checkPair(def: SketchDef, ctx: EditContext, from: string, to: string, type: RelationType, except?: string): OpOutcome | null {
  const known = knownModules(def, ctx.persistent)
  for (const x of [from, to]) if (!known.has(x)) return reject('not-found', `草图里没有模块「${x}」`)
  if (from === to || isAncestor(def, ctx, from, to) || isAncestor(def, ctx, to, from)) return reject('ancestor', '关系不能连自己、祖先或后代（M6）')
  if (allRelations(def, ctx).some(r => r.id !== except && r.from === from && r.to === to && r.type === type))
    return reject('duplicate-relation', `「${from}」→「${to}」的 ${type} 关系已经有了（C-8）`)
  return null
}

export function connect(def: SketchDef, ctx: EditContext, from: string, to: string, type: RelationType, description?: string, iface?: string): OpOutcome {
  const bad = checkPair(def, ctx, from, to, type)
  if (bad) return bad
  const id = relationId(from, to, type, takenIds(def, ctx.persistent))
  ;(def.relations ??= []).push({ id, from, to, type, ...(description?.trim() ? { description: description.trim() } : {}), ...(iface ? { interface: iface } : {}) })
  return done({ created: [id] })
}

export function updateRelation(def: SketchDef, ctx: EditContext, id: string, patch: { type?: RelationType; description?: string; interface?: string }): OpOutcome {
  const r = def.relations?.find(x => x.id === id)
  if (!r) return reject('not-found', `草图里没有关系「${id}」`)
  if (patch.type && patch.type !== r.type) {
    const bad = checkPair(def, ctx, r.from, r.to, patch.type, id)
    if (bad) return bad
    r.type = patch.type
  }
  for (const k of ['description', 'interface'] as const)
    if (k in patch) {
      const v = patch[k]?.trim()
      if (v) r[k] = v
      else delete r[k]
    }
  return done()
}

export function removeRelation(def: SketchDef, _ctx: EditContext, id: string): OpOutcome {
  if (!def.relations?.some(r => r.id === id)) return reject('not-found', `草图里没有关系「${id}」`)
  def.relations = def.relations.filter(r => r.id !== id)
  return done({ removed: [id] })
}

export function addInterface(def: SketchDef, ctx: EditContext, owner: string, name: string, signature?: string): OpOutcome {
  if (!name.trim()) return reject('invalid', '接口名称不能为空')
  if (!knownModules(def, ctx.persistent).has(owner)) return reject('not-found', `草图里没有模块「${owner}」`)
  const id = interfaceId(owner, name, takenIds(def, ctx.persistent))
  ;(def.interfaces ??= []).push({ id, name: name.trim(), owner, ...(signature?.trim() ? { signature: signature.trim() } : {}) })
  return done({ created: [id] })
}

export function updateInterface(def: SketchDef, _ctx: EditContext, id: string, patch: { name?: string; signature?: string }): OpOutcome {
  const x = def.interfaces?.find(i => i.id === id)
  if (!x) return reject('not-found', `草图里没有接口「${id}」`)
  if (patch.name !== undefined) {
    if (!patch.name.trim()) return reject('invalid', '接口名称不能为空')
    x.name = patch.name.trim()
  }
  if (patch.signature !== undefined) {
    if (patch.signature.trim()) x.signature = patch.signature
    else delete x.signature
  }
  return done()
}

export function removeInterface(def: SketchDef, _ctx: EditContext, id: string): OpOutcome {
  if (!def.interfaces?.some(x => x.id === id)) return reject('not-found', `草图里没有接口「${id}」`)
  def.interfaces = def.interfaces.filter(x => x.id !== id)
  for (const r of def.relations ?? []) if (r.interface === id) delete r.interface
  return done({ removed: [id] })
}
