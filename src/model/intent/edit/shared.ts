/**
 * 各操作族共用的结果构造与小工具。操作在 applyEdit 给出的副本上原地修改；输入草图本身不动（X7b）。
 */
import type { ModuleDef, SketchDef } from '../../types'
import type { EditContext, EditEffects, EditRejectCode } from '../types'
import { ID_PATTERN, knownModules, locate, mountOf, subtreeIds, takenIds } from './locate'

export type OpOutcome = { effects: EditEffects } | { reject: { code: EditRejectCode; reason: string } }

export const done = (effects: Partial<EditEffects> = {}): OpOutcome => ({ effects: { created: [], renamed: [], removed: [], ...effects } })
export const reject = (code: EditRejectCode, reason: string): OpOutcome => ({ reject: { code, reason } })

/** X9：模块在编辑中可见——本草图、持久草图、挂载点或上下文给出的外部模块 */
export function isKnown(def: SketchDef, ctx: EditContext, id: string): boolean {
  return id === mountOf(def) || knownModules(def, ctx.persistent).has(id) || !!ctx.known?.(id)
}

/** 要改的模块必须在本草图里；只在持久草图里的，设计草图不能动它（X7b） */
export function ownModule(def: SketchDef, ctx: EditContext, id: string): { ok: true; node: ModuleDef } | { ok: false; out: OpOutcome } {
  const hit = locate(def, id)
  if (hit) return { ok: true, node: hit.node }
  const owner = ctx.persistent.find(p => knownModules(p.def, []).has(id))
  return owner
    ? { ok: false, out: reject('persistent', `「${id}」属于持久草图「${owner.def.id}」：要改它请编辑该持久草图，或在设计草图里声明 supersedes: ${owner.def.id}`) }
    : { ok: false, out: reject('not-found', `草图里没有模块「${id}」`) }
}

/** 显式给出的新 ID：格式、前缀（X5）、未被占用 */
export function checkNewId(def: SketchDef, ctx: EditContext, id: string, parent: string | undefined, except: readonly string[] = []): OpOutcome | null {
  if (!ID_PATTERN.test(id)) return reject('id-format', `ID「${id}」只能包含字母、数字和 . _ : -，且以字母或数字开头`)
  if (parent && !id.startsWith(`${parent}.`)) return reject('id-prefix', `ID「${id}」必须以父模块 ID「${parent}.」开头（X5）`)
  if (parent && id.length === parent.length + 1) return reject('id-format', `ID「${id}」缺少短名`)
  const taken = takenIds(def, ctx.persistent)
  for (const x of except) taken.delete(x)
  if (taken.has(id)) return reject('id-taken', `ID「${id}」已被占用`)
  return null
}

/** a 是 b 的祖先（或相同） */
export function isAncestor(def: SketchDef, ctx: EditContext, a: string, b: string): boolean {
  const all = [...knownModules(def, ctx.persistent)].map(([id, m]) => ({ id, parentId: m.parentId }))
  return subtreeIds(all, a).includes(b)
}

/** 把一组 ID 的引用按 map 改写（关系两端、接口 owner、closed、mayDependOn、parent）；返回改写的引用条数 */
export function rewriteRefs(def: SketchDef, map: ReadonlyMap<string, string>): number {
  let n = 0
  const sub = (id: string) => {
    const to = map.get(id)
    if (to === undefined) return id
    n++
    return to
  }
  for (const r of def.relations ?? []) {
    r.from = sub(r.from)
    r.to = sub(r.to)
  }
  for (const x of def.interfaces ?? []) if (x.owner) x.owner = sub(x.owner)
  if (def.closed) def.closed = def.closed.map(sub)
  // X12、X15：布局按模块 ID 记，键随之改写
  if (def.layout?.modules)
    def.layout.modules = Object.fromEntries(Object.entries(def.layout.modules).map(([id, p]) => [map.get(id) ?? id, p]))
  const walk = (list: ModuleDef[]) =>
    list.forEach(m => {
      if (m.mayDependOn) m.mayDependOn = m.mayDependOn.map(sub)
      if (m.parent) m.parent = map.get(m.parent) ?? m.parent
      if (m.children) walk(m.children)
    })
  walk(def.modules ?? [])
  return n
}
