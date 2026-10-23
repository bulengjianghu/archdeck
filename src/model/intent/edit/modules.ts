/**
 * 模块操作（C-4、C-6、C-7、P-2，X7b、X7e）：新建、改字段、标封闭、删除（级联子树、两端落在子树内的关系、owner 在子树内的接口、closed 与 mayDependOn 中的引用）。
 */
import type { ModuleDef, SketchDef } from '../../types'
import type { EditContext, ModulePatch } from '../types'
import { locate, locateAll, moduleId, mountOf, subtreeIds, takenIds } from './locate'
import { checkNewId, done, isKnown, ownModule, reject, type OpOutcome } from './shared'

/** 新模块跟随父模块的写法：父模块在本草图里就嵌进它的 children，否则平铺并写 parent */
export function placeModule(def: SketchDef, node: ModuleDef, parent: string | undefined): void {
  const host = parent ? locate(def, parent) : undefined
  // X9：非根草图的模块挂在 mount 下，不写 parent
  if (parent && parent === mountOf(def)) {
    delete node.parent
    ;(def.modules ??= []).push(node)
  } else if (host) {
    delete node.parent
    ;(host.node.children ??= []).push(node)
  } else {
    if (parent) node.parent = parent
    else delete node.parent
    ;(def.modules ??= []).push(node)
  }
}

export function addModule(def: SketchDef, ctx: EditContext, parent: string, name: string, id?: string, kind?: string): OpOutcome {
  if (!name.trim()) return reject('invalid', '模块名称不能为空')
  if (!isKnown(def, ctx, parent)) return reject('not-found', `父模块「${parent}」不在草图里`)
  const given = id?.trim()
  // X7c：给的是短名时补上父 ID 前缀
  const newId = given ? (given.startsWith(`${parent}.`) || !given.length || given.includes('.') ? given : `${parent}.${given}`) : moduleId(parent, name, takenIds(def, ctx.persistent))
  const bad = checkNewId(def, ctx, newId, parent)
  if (bad) return bad
  placeModule(def, { id: newId, name: name.trim(), ...(kind ? { kind } : {}) }, parent)
  return done({ created: [newId] })
}

const EMPTY = (v: unknown) => v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

export function updateModule(def: SketchDef, ctx: EditContext, id: string, patch: ModulePatch): OpOutcome {
  const own = ownModule(def, ctx, id)
  if (!own.ok) return own.out
  if (patch.name !== undefined && !patch.name.trim()) return reject('invalid', '模块名称不能为空')
  const node = own.node as unknown as Record<string, unknown>
  for (const [k, v] of Object.entries(patch)) {
    if (EMPTY(v) || v === false) delete node[k]
    else node[k] = typeof v === 'string' ? v.trim() : v
  }
  return done()
}

export function setClosed(def: SketchDef, ctx: EditContext, id: string, closed: boolean): OpOutcome {
  if (!isKnown(def, ctx, id)) return reject('not-found', `草图里没有模块「${id}」`)
  const list = (def.closed ?? []).filter(x => x !== id)
  if (closed) list.push(id)
  if (list.length) def.closed = list
  else delete def.closed
  return done()
}

/** X7e：删除模块与它的子树，级联删除引用 */
export function removeModule(def: SketchDef, ctx: EditContext, id: string): OpOutcome {
  const own = ownModule(def, ctx, id)
  if (!own.ok) return own.out
  const all = locateAll(def)
  const gone = new Set(subtreeIds(all, id))
  // 平铺写的后代与嵌套的一起删：先删最深的，避免下标错位
  for (const m of [...all].reverse()) if (gone.has(m.id) && !(m.nested && gone.has(m.parentId!))) m.list.splice(m.index, 1)
  const removed = [...gone]
  const relations = (def.relations ?? []).filter(r => gone.has(r.from) || gone.has(r.to))
  const interfaces = (def.interfaces ?? []).filter(x => x.owner && gone.has(x.owner))
  if (def.relations) def.relations = def.relations.filter(r => !relations.includes(r))
  if (def.interfaces) def.interfaces = def.interfaces.filter(x => !interfaces.includes(x))
  const lost = new Set(interfaces.map(x => x.id))
  for (const r of def.relations ?? []) if (r.interface && lost.has(r.interface)) delete r.interface
  if (def.closed) def.closed = def.closed.filter(x => !gone.has(x))
  if (def.closed?.length === 0) delete def.closed
  for (const m of locateAll(def)) if (m.node.mayDependOn) m.node.mayDependOn = m.node.mayDependOn.filter(x => !gone.has(x))
  // X7e：它的布局一并删
  if (def.layout?.modules) for (const x of gone) delete def.layout.modules[x]
  if (def.layout?.relations) for (const r of relations) delete def.layout.relations[r.id]
  return done({ removed: [...removed, ...relations.map(r => r.id), ...interfaces.map(x => x.id)] })
}
