/**
 * 草图寻址与 ID 生成（X7c，ADR-0024）：在嵌套或平铺写法的草图里按 ID 找到模块、带位置平铺；新 ID 的生成。
 * 各操作族、草图校验与核验（flattenSketch）共用这一套。纯函数。
 */
import type { ModuleDef, SketchDef, SketchEntity } from '../../types'

/** 描述里 ID 的写法（与 schema 的 pattern 一致） */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

/** 平铺后的一个模块：父模块（undefined = 根）、在草图里的位置 */
export interface LocatedModule {
  id: string
  parentId?: string
  node: ModuleDef
  /** 所在列表（草图的 modules 或某个模块的 children） */
  list: ModuleDef[]
  index: number
  /** 嵌在父模块的 children 里（否则平铺，父模块由 parent 字段给出或为根） */
  nested: boolean
  /** 草图里的位置，如 sketch.modules.2.children.0 */
  path: string
}

/** 草图的模块按写的顺序平铺（嵌套位置决定父模块，平铺的取 parent 字段） */
export function locateAll(def: SketchDef): LocatedModule[] {
  const out: LocatedModule[] = []
  const walk = (list: ModuleDef[], parentId: string | undefined, nested: boolean, path: string) =>
    list.forEach((node, index) => {
      const at = `${path}.${index}`
      out.push({ id: node.id, parentId: nested ? parentId : node.parent, node, list, index, nested, path: at })
      if (node.children) walk(node.children, node.id, true, `${at}.children`)
    })
  if (def.modules) walk(def.modules, undefined, false, 'sketch.modules')
  return out
}

export function locate(def: SketchDef, id: string): LocatedModule | undefined {
  return locateAll(def).find(m => m.id === id)
}

/** 模块与它在草图里的全部后代（按父链，不按 ID 前缀） */
export function subtreeIds(all: readonly { id: string; parentId?: string }[], id: string): string[] {
  const kids = new Map<string, string[]>()
  for (const m of all) if (m.parentId !== undefined) kids.set(m.parentId, [...(kids.get(m.parentId) ?? []), m.id])
  const out: string[] = []
  const walk = (x: string) => {
    out.push(x)
    for (const k of kids.get(x) ?? []) if (!out.includes(k)) walk(k)
  }
  walk(id)
  return out
}

/** 编辑中可见的全部模块：本草图 + 持久草图（同一 ID 以本草图为准） */
export function knownModules(def: SketchDef, persistent: readonly SketchEntity[]): Map<string, { parentId?: string; node: ModuleDef; own: boolean }> {
  const out = new Map<string, { parentId?: string; node: ModuleDef; own: boolean }>()
  for (const p of persistent) for (const m of locateAll(p.def)) if (!out.has(m.id)) out.set(m.id, { parentId: m.parentId, node: m.node, own: false })
  for (const m of locateAll(def)) out.set(m.id, { parentId: m.parentId ?? out.get(m.id)?.parentId, node: m.node, own: true })
  return out
}

/** 本草图 ∪ 持久草图里全部已用的 ID（模块、关系、接口、数据结构） */
export function takenIds(def: SketchDef, persistent: readonly SketchEntity[]): Set<string> {
  const out = new Set<string>()
  for (const d of [def, ...persistent.map(p => p.def)]) {
    for (const m of locateAll(d)) out.add(m.id)
    for (const x of [...(d.relations ?? []), ...(d.interfaces ?? []), ...(d.dataStructures ?? [])]) out.add(x.id)
  }
  return out
}

/** ID 的最后一段 */
export const shortName = (id: string): string => id.slice(id.lastIndexOf('.') + 1)

/** 名称转 kebab-case 短名：只留 ASCII 字母数字，空白与分隔符成 -；无可转写时为空串 */
export function kebab(name: string): string {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const unique = (base: string, taken: ReadonlySet<string>): string => {
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`
}

/** X7c：模块 ID = 父 ID + 名称的 kebab-case 短名；无可转写时为 m1、m2…；parent 为空时是根下的层 */
export function moduleId(parent: string | undefined, name: string, taken: ReadonlySet<string>): string {
  const prefix = parent ? `${parent}.` : ''
  const short = kebab(name)
  if (short) return unique(`${prefix}${short}`, taken)
  for (let i = 1; ; i++) if (!taken.has(`${prefix}m${i}`)) return `${prefix}m${i}`
}

/** X7c：关系 ID = rel.<from 短名>-<to 短名>；已被占用（同一对模块已有别的类型的关系，L5）时加类型后缀，仍冲突再加序号 */
export function relationId(from: string, to: string, type: string, taken: ReadonlySet<string>): string {
  const base = `rel.${shortName(from)}-${shortName(to)}`
  if (!taken.has(base)) return base
  return unique(`${base}-${type}`, taken)
}

/** X7c：接口 ID = if.<owner 短路径>.<名称>；owner 短路径为去掉第一段（层）的 owner ID */
export function interfaceId(owner: string, name: string, taken: ReadonlySet<string>): string {
  const path = owner.includes('.') ? owner.slice(owner.indexOf('.') + 1) : owner
  const n = name.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'api'
  return unique(`if.${path}.${n}`, taken)
}
