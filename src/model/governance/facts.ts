/**
 * 代码事实与描述的比对（K4–K7）：文件依赖按归属提升为模块依赖，关系的证实，未描述依赖。
 * 关于被描述系统的知识，页面、lint:model 与 agent 接口共用。
 */
import type { ModelIndex, RelationEntity } from '../types'
import type { SourceOwnership } from '../source'
import type { Confirmation, FileDep, ModuleDep } from './types'

export const depKey = (from: string, to: string) => `${from}->${to}`

/** a 是否在 b 的子树内（含 b 自身） */
export const within = (index: ModelIndex, a: string, b: string): boolean => !!index.pathOf.get(a)?.includes(b)

/** a 与 b 相同或互为祖先后代 */
export const related = (index: ModelIndex, a: string, b: string): boolean => within(index, a, b) || within(index, b, a)

/** K4：文件依赖两端取归属模块（冲突时每个都算），去掉同模块与祖先后代，按依赖方 → 被依赖方合并 */
export function liftDeps(index: ModelIndex, own: SourceOwnership, deps: readonly FileDep[]): { moduleDeps: Map<string, ModuleDep>; skipped: number } {
  const moduleDeps = new Map<string, ModuleDep>()
  let skipped = 0
  for (const d of deps) {
    const froms = own.owners.get(d.from)
    const tos = own.owners.get(d.to)
    if (!froms || !tos) {
      skipped++
      continue
    }
    for (const a of froms)
      for (const b of tos) {
        if (related(index, a, b)) continue
        const key = depKey(a, b)
        const hit = moduleDeps.get(key)
        if (hit) hit.files.push(d)
        else moduleDeps.set(key, { key, from: a, to: b, files: [d] })
      }
  }
  return { moduleDeps, skipped }
}

/** 模块或其祖先是目标态 */
const isTarget = (index: ModelIndex, id: string) => (index.pathOf.get(id) ?? []).some(p => index.modules.get(p)?.status === 'target')

/** K5：关系能否被判定（两端都是模块且都不是目标态） */
export const judgeable = (index: ModelIndex, r: RelationEntity) =>
  index.modules.has(r.from) && index.modules.has(r.to) && !isTarget(index, r.from) && !isTarget(index, r.to)

/**
 * K5：依赖方与 from、被依赖方与 to 各自相同或互为祖先后代；dataflow 两个方向都算。
 * 端点是祖先的情况：代码经祖先的文件进出（统一入口，如 useDesk() 所在的文件归 DeskState；或概念子模块的代码在祖先的文件里），依赖落在祖先上也算证实。
 */
const supports = (index: ModelIndex, r: RelationEntity, d: ModuleDep) =>
  (related(index, d.from, r.from) && related(index, d.to, r.to)) || (r.type === 'dataflow' && related(index, d.from, r.to) && related(index, d.to, r.from))

/** K5：模块的宿主——自身或最近的、有直接归属文件的祖先；都没有为 undefined */
export function hostOf(index: ModelIndex, direct: ReadonlyMap<string, readonly string[]>, id: string): string | undefined {
  return [...(index.pathOf.get(id) ?? [id])].reverse().find(p => direct.get(p)?.length)
}

/** K5：每条关系的证实状态；两端宿主相同（概念拆分，同文件）的不判定 */
export function confirmRelations(
  index: ModelIndex,
  moduleDeps: ReadonlyMap<string, ModuleDep>,
  direct: ReadonlyMap<string, readonly string[]> = new Map(),
): Map<string, Confirmation> {
  const out = new Map<string, Confirmation>()
  const list = [...moduleDeps.values()]
  for (const r of index.relations.values()) {
    if (!judgeable(index, r)) {
      out.set(r.id, { status: 'skipped', deps: [] })
      continue
    }
    const host = hostOf(index, direct, r.from)
    if (host && host === hostOf(index, direct, r.to)) {
      out.set(r.id, { status: 'skipped', deps: [], host })
      continue
    }
    const deps = list.filter(d => supports(index, r, d)).map(d => d.key)
    out.set(r.id, { status: deps.length ? 'confirmed' : 'unconfirmed', deps })
  }
  return out
}

/** K7：关系是否覆盖模块依赖——端点相同或互为祖先后代、方向一致（dataflow 不论方向），类型不限 */
export function covers(index: ModelIndex, r: RelationEntity, from: string, to: string): boolean {
  if (!index.modules.has(r.from) || !index.modules.has(r.to)) return false
  if (related(index, r.from, from) && related(index, r.to, to)) return true
  return r.type === 'dataflow' && related(index, r.from, to) && related(index, r.to, from)
}

/** K7：被某条关系覆盖的依赖；返回覆盖它的关系 ID（没有则空） */
export function coveringRelations(index: ModelIndex, from: string, to: string): string[] {
  return [...index.relations.values()].filter(r => covers(index, r, from, to)).map(r => r.id)
}

/** K7：未描述依赖；只引用类型的（全部文件依赖都是 type）不算 */
export function undescribedDeps(index: ModelIndex, moduleDeps: ReadonlyMap<string, ModuleDep>): ModuleDep[] {
  const relations = [...index.relations.values()]
  return [...moduleDeps.values()].filter(d => d.files.some(f => f.kind === 'value') && !relations.some(r => covers(index, r, d.from, d.to)))
}
