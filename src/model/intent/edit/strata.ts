/**
 * 草图里的分层（ADR-0052）：层是父模块对子模块的分类，写在草图的 strata 上（根草图写 root），成员用 members 或子模块的 stratum。
 * 根草图的「层」即根的单成员层：带就是它的成员（根的子模块），层的 ID 缺省同成员 ID。各操作族共用这一套寻址与级联。纯函数。
 */
import { ROOT_MOUNT, type ModuleDef, type SketchDef, type StratumDef } from '../../types'
import { locateAll } from './locate'

/** 草图里一个父模块的分层的键：根草图的顶层写 root，其余为父模块 ID */
export const strataKey = (def: Pick<SketchDef, 'mount'>, parent: string | undefined): string => parent ?? (def.mount === ROOT_MOUNT ? ROOT_MOUNT : def.mount)

/** 根草图的顶层模块（根的子模块，即根层的成员；平铺写了 parent 的不算） */
export const isRootLayer = (def: SketchDef, id: string): boolean => def.mount === ROOT_MOUNT && (def.modules ?? []).some(m => m.id === id && m.parent === undefined)

/** 父模块的层（草图里写的顺序） */
export const strataIn = (def: SketchDef, key: string): StratumDef[] => def.strata?.[key] ?? []

/** 子模块在父模块（键）下所属的层：层的 members 或子模块自己的 stratum */
export function stratumOfMember(def: SketchDef, key: string, id: string, node?: ModuleDef): StratumDef | undefined {
  const list = strataIn(def, key)
  const own = node ?? locateAll(def).find(m => m.id === id)?.node
  return list.find(s => s.members?.includes(id)) ?? (own?.stratum !== undefined ? list.find(s => s.id === own.stratum) : undefined)
}

/** 根草图里一个顶层模块的层序（没有时 undefined） */
export const rootOrderOf = (def: SketchDef, id: string): number | undefined => stratumOfMember(def, ROOT_MOUNT, id)?.order

/** 删掉一组模块后：从各层的成员里去掉；只以它们为成员的层一并删掉，并从其他层的 mayDependOn 里去掉 */
export function dropFromStrata(def: SketchDef, gone: ReadonlySet<string>): void {
  if (!def.strata) return
  for (const key of Object.keys(def.strata)) {
    if (gone.has(key)) {
      delete def.strata[key]
      continue
    }
    const list = def.strata[key]
    const dead = new Set(list.filter(s => s.members?.length && s.members.every(m => gone.has(m))).map(s => s.id))
    def.strata[key] = list
      .filter(s => !dead.has(s.id))
      .map(s => ({
        ...s,
        ...(s.members ? { members: s.members.filter(m => !gone.has(m)) } : {}),
        ...(s.mayDependOn ? { mayDependOn: s.mayDependOn.filter(d => !dead.has(d)) } : {}),
      }))
  }
}

/** 改 ID 的级联：父模块键与成员按 map 改写；返回改写的引用条数 */
export function renameInStrata(def: SketchDef, map: ReadonlyMap<string, string>): number {
  if (!def.strata) return 0
  let n = 0
  const next: Record<string, StratumDef[]> = {}
  for (const [key, list] of Object.entries(def.strata)) {
    const to = map.get(key)
    if (to !== undefined) n++
    next[to ?? key] = list.map(s => {
      if (!s.members) return s
      return {
        ...s,
        members: s.members.map(m => {
          const x = map.get(m)
          if (x === undefined) return m
          n++
          return x
        }),
      }
    })
  }
  def.strata = next
  return n
}

/**
 * 级联（ADR-0052）：合并、降级、升级、移入、拆分把模块挪走后，原层里不再列它——成员在本草图里却已不是该父模块的直接子模块，
 * 或哪里都没有了（known 为假：本设计的草图、持久草图与当前版本里都找不到），就从成员里去掉；成员只在持久草图里的照留。
 * 层本身不删（空层留给人决定删或补成员）。
 */
export function pruneStrata(def: SketchDef, known: (id: string) => boolean): void {
  if (!def.strata) return
  const all = locateAll(def)
  const at = new Map(all.map(m => [m.id, m.parentId]))
  for (const [key, list] of Object.entries(def.strata)) {
    const here = (m: string) => (key === ROOT_MOUNT ? def.mount === ROOT_MOUNT && at.get(m) === undefined : at.get(m) === key)
    const keep = (m: string) => (at.has(m) ? here(m) : known(m))
    def.strata[key] = list.map(s => (s.members && !s.members.every(keep) ? { ...s, members: s.members.filter(keep) } : s))
  }
}

/** 根草图的层按序重排为 1…N（顺序即给出的成员顺序） */
export function renumberRoot(def: SketchDef, members: readonly string[]): void {
  const list = strataIn(def, ROOT_MOUNT)
  members.forEach((id, i) => {
    const s = list.find(x => x.members?.includes(id))
    if (s) s.order = i + 1
  })
  def.strata![ROOT_MOUNT] = [...list].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
}
