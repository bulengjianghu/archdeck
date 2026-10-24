/**
 * 关系与接口操作（C-8、C-10、P-3、P-4，X7b、X7c）：连关系（同一对模块同类型已有时拒绝，连祖先与后代拒绝）、改、删；
 * 接口的增删改（owner 固定为所在模块，删接口时去掉关系上对它的引用）。
 */
import { relationMode, type RelationDef, type RelationType, type SketchDef } from '../../types'
import type { EditContext, RelationModifiers } from '../types'
import { interfaceId, locateAll, relationId, takenIds } from './locate'
import { done, isAncestor, isKnown, reject, type OpOutcome } from './shared'

const allRelations = (def: SketchDef, ctx: EditContext) => [...(def.relations ?? []), ...ctx.persistent.flatMap(p => p.def.relations ?? [])]

function checkPair(def: SketchDef, ctx: EditContext, from: string, to: string, type: RelationType, except?: string): OpOutcome | null {
  for (const x of [from, to]) if (!isKnown(def, ctx, x)) return reject('not-found', `草图里没有模块「${x}」`)
  // X19：两端都是引用节点（都不在本草图）的关系不能建
  const own = new Set(locateAll(def).map(m => m.id))
  if (def.mount && !own.has(from) && !own.has(to)) return reject('invalid', '两端都是引用节点的关系不能建：关系只写本层（X9、X19）')
  if (from === to || isAncestor(def, ctx, from, to) || isAncestor(def, ctx, to, from)) return reject('ancestor', '关系不能连自己、祖先或后代（M6）')
  if (allRelations(def, ctx).some(r => r.id !== except && r.from === from && r.to === to && r.type === type))
    return reject('duplicate-relation', `「${from}」→「${to}」的 ${type} 关系已经有了（C-8）`)
  return null
}

/**
 * X23：写修饰——via 空串为直接（去掉）；mode 只留在查询 / 委托（含未分类）上、写 async 才记（同步缺省）；pull 只留在流上；
 * 改了类型后不再适用的修饰一并去掉（M13）。
 */
function applyModifiers(r: RelationDef, m: RelationModifiers) {
  if (m.via !== undefined) {
    const v = m.via.trim()
    if (v) r.via = v
    else delete r.via
  }
  if (m.mode !== undefined) {
    if (m.mode === 'async') r.mode = 'async'
    else delete r.mode
  }
  if (m.pull !== undefined) {
    if (m.pull) r.pull = true
    else delete r.pull
  }
  const t = r.type as RelationType
  if (t === 'notifies' || t === 'streams') delete r.mode
  if (t !== 'streams') delete r.pull
  if (r.mode && relationMode({ type: t, mode: r.mode }) === 'sync') delete r.mode
}

export function connect(def: SketchDef, ctx: EditContext, from: string, to: string, type: RelationType, description?: string, iface?: string, mods: RelationModifiers = {}): OpOutcome {
  const bad = checkPair(def, ctx, from, to, type)
  if (bad) return bad
  const id = relationId(from, to, type, takenIds(def, ctx.persistent))
  const r: RelationDef = { id, from, to, type, ...(description?.trim() ? { description: description.trim() } : {}), ...(iface ? { interface: iface } : {}) }
  applyModifiers(r, mods)
  ;(def.relations ??= []).push(r)
  return done({ created: [id] })
}

export function updateRelation(def: SketchDef, ctx: EditContext, id: string, patch: { type?: RelationType; description?: string; interface?: string } & RelationModifiers): OpOutcome {
  const r = def.relations?.find(x => x.id === id)
  if (!r) return reject('not-found', `草图里没有关系「${id}」`)
  if (patch.type && patch.type !== r.type) {
    const bad = checkPair(def, ctx, r.from, r.to, patch.type, id)
    if (bad) return bad
    r.type = patch.type
  }
  applyModifiers(r, patch)
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
  if (def.layout?.relations) delete def.layout.relations[id]
  return done({ removed: [id] })
}

export function addInterface(def: SketchDef, ctx: EditContext, owner: string, name: string, signature?: string): OpOutcome {
  if (!name.trim()) return reject('invalid', '接口名称不能为空')
  if (!isKnown(def, ctx, owner)) return reject('not-found', `草图里没有模块「${owner}」`)
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

/**
 * X24：声明 / 撤销端口的实现者——写进本草图接口的 implementedBy（接口属定义模块对外的一面，写在定义模块所在的草图，X10）；
 * 实现者是本层模块或引用节点（已知的模块），不能是定义模块自己。底稿不复制接口，要钉住的端口在草图里重写。
 */
export function implement(def: SketchDef, ctx: EditContext, iface: string, module: string, remove = false): OpOutcome {
  const x = def.interfaces?.find(i => i.id === iface)
  if (!x) return reject('not-found', `草图里没有接口「${iface}」：要声明实现者，先在定义模块上写这个接口（X24）`)
  if (remove) {
    if (!x.implementedBy?.includes(module)) return reject('not-found', `「${module}」不是接口「${iface}」的实现者`)
    x.implementedBy = x.implementedBy.filter(m => m !== module)
    if (!x.implementedBy.length) delete x.implementedBy
    return done()
  }
  if (!isKnown(def, ctx, module)) return reject('not-found', `草图里没有模块「${module}」`)
  if (module === x.owner) return reject('invalid', '定义模块不能实现自己的端口')
  if (x.implementedBy?.includes(module)) return reject('duplicate-relation', `「${module}」已经是接口「${iface}」的实现者`)
  ;(x.implementedBy ??= []).push(module)
  return done()
}

export function removeInterface(def: SketchDef, _ctx: EditContext, id: string): OpOutcome {
  if (!def.interfaces?.some(x => x.id === id)) return reject('not-found', `草图里没有接口「${id}」`)
  def.interfaces = def.interfaces.filter(x => x.id !== id)
  for (const r of def.relations ?? []) if (r.interface === id) delete r.interface
  return done({ removed: [id] })
}
