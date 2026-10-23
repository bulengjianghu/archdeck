/**
 * 移动与改 ID（C-5、P-2，X7d）：移动 = 改父 + 改 ID，一个操作；新 ID 缺省为新父 ID + 原短名；
 * 级联改写后代 ID、关系两端、接口 owner、closed 与 mayDependOn 中的引用；关系与接口自身的 ID 不变。
 * 改 ID（renameModule）是父不变的移动。当前版本里的旧 ID 不在这里改（AI 生成的文件，交给 AI 重新生成），只在 idImpact 里给出条数。
 */
import type { ModelIndex, ModuleDef, SketchDef, Step } from '../../types'
import type { EditContext, IdImpact } from '../types'
import { knownModules, locate, locateAll, shortName, subtreeIds } from './locate'
import { placeModule } from './modules'
import { checkNewId, done, isAncestor, ownModule, reject, rewriteRefs, type OpOutcome } from './shared'

export function moveModule(def: SketchDef, ctx: EditContext, id: string, parent: string, newId?: string): OpOutcome {
  const own = ownModule(def, ctx, id)
  if (!own.ok) return own.out
  if (own.node.kind === 'layer') return reject('invalid', '层不能移动到其他模块下；层的先后用排序')
  if (!knownModules(def, ctx.persistent).has(parent)) return reject('not-found', `父模块「${parent}」不在草图里`)
  if (isAncestor(def, ctx, id, parent)) return reject('ancestor', `不能把「${id}」移到它自己或它的后代之下`)
  const target = newId?.trim() || `${parent}.${shortName(id)}`
  const all = locateAll(def)
  const subtree = subtreeIds(all, id)
  if (target !== id) {
    const bad = checkNewId(def, ctx, target, parent, subtree)
    if (bad) return bad
  } else if (locate(def, id)?.parentId === parent) return done()
  // 新 ID：自身换成 target，ID 以旧 ID 为前缀的后代换前缀，其余（不守前缀的）不改
  const map = new Map<string, string>()
  for (const x of subtree) {
    const to = x === id ? target : x.startsWith(`${id}.`) ? `${target}${x.slice(id.length)}` : x
    if (to !== x) map.set(x, to)
  }
  const clash = [...map.values()].find(to => !subtree.includes(to) && knownModules(def, ctx.persistent).has(to))
  if (clash) return reject('id-taken', `移动后后代的 ID「${clash}」已被占用`)
  // 从原位置摘下（连同嵌套的子模块），改 ID 与引用，再按新父模块的写法安放
  const hit = locate(def, id)!
  // 父不变（改 ID）：原地改写，位置与写法不动；换父：摘下后按新父模块的写法安放
  if (hit.parentId === parent) {
    renameAll(def, map)
    return done({ renamed: [...map] })
  }
  hit.list.splice(hit.index, 1)
  renameAll(def, map, [hit.node])
  placeModule(def, hit.node, parent)
  return done({ renamed: [...map] })
}

/** 草图里（含已摘下的 extra 子树）全部模块按 map 改 ID，并改写引用 */
function renameAll(def: SketchDef, map: ReadonlyMap<string, string>, extra: ModuleDef[] = []): void {
  for (const m of [...locateAll(def), ...locateAll({ id: def.id, mount: def.mount, modules: extra })]) m.node.id = map.get(m.node.id) ?? m.node.id
  rewriteRefs(def, map)
}

export function renameModule(def: SketchDef, ctx: EditContext, id: string, newId: string): OpOutcome {
  const own = ownModule(def, ctx, id)
  if (!own.ok) return own.out
  const parent = locate(def, id)!.parentId
  if (parent && !newId.startsWith(`${parent}.`)) return reject('id-prefix', `ID「${newId}」必须以父模块 ID「${parent}.」开头；要换父请用「所属父」或拖动（X7d）`)
  if (!parent) {
    // 根下的层改 ID：没有父，直接改写
    const bad = checkNewId(def, ctx, newId, undefined, subtreeIds(locateAll(def), id))
    if (bad) return bad
    const map = new Map<string, string>()
    for (const x of subtreeIds(locateAll(def), id)) map.set(x, x === id ? newId : x.startsWith(`${id}.`) ? `${newId}${x.slice(id.length)}` : x)
    renameAll(def, map)
    return done({ renamed: [...map].filter(([a, b]) => a !== b) })
  }
  return moveModule(def, ctx, id, parent, newId)
}

/** X7d：移动前的影响——草图内改写的 ID 与引用条数、当前版本里仍引用旧 ID 的实体条数 */
export function idImpact(def: SketchDef, ctx: EditContext, id: string, parent: string, newId?: string, current?: ModelIndex | null): IdImpact {
  const copy = structuredClone(def)
  const out = parent === locate(def, id)?.parentId && newId ? renameModule(copy, ctx, id, newId) : moveModule(copy, ctx, id, parent, newId)
  const empty = { modules: 0, relations: 0, interfaces: 0, messages: 0 }
  if ('reject' in out) return { renamed: [], references: 0, outside: empty, rejected: out.reject.reason }
  const renamed = out.effects.renamed
  const old = new Set(renamed.map(([a]) => a))
  const probe = structuredClone(def)
  const references = rewriteRefs(probe, new Map(renamed))
  const outside = { ...empty }
  if (current) {
    const under = (x: string) => [...old].some(o => x === o || x.startsWith(`${o}.`))
    for (const m of current.modules.keys()) if (under(m)) outside.modules++
    for (const r of current.relations.values()) if (under(r.from) || under(r.to)) outside.relations++
    for (const x of current.interfaces.values()) if (x.owner && under(x.owner)) outside.interfaces++
    for (const sc of current.scenarios.values()) outside.messages += countMessages(sc.steps, under)
  }
  return { renamed, references, outside }
}

/** 场景里端点落在旧 ID 子树内的消息条数（规整后的步骤树） */
function countMessages(steps: readonly Step[], under: (id: string) => boolean): number {
  let n = 0
  for (const s of steps) {
    if ('msg' in s) n += under(s.msg.from) || under(s.msg.to) ? 1 : 0
    else if (s.kind === 'alt' || s.kind === 'par') for (const b of s.branches) n += countMessages(b.steps, under)
    else if (s.kind === 'loop') n += countMessages(s.steps, under)
  }
  return n
}
