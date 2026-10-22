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

/**
 * K4：文件依赖两端取归属模块，去掉同模块与祖先后代，按依赖方 → 被依赖方合并。
 * 有一端未归属或已忽略的单独计数（skipped）；有一端是归属冲突文件（G6）的不提升到任何模块，单独列出（conflicted）——冲突是描述问题，不衍生违规与未描述依赖。
 */
export function liftDeps(
  index: ModelIndex,
  own: SourceOwnership,
  deps: readonly FileDep[],
): { moduleDeps: Map<string, ModuleDep>; skipped: number; conflicted: FileDep[]; nested: Set<string> } {
  const moduleDeps = new Map<string, ModuleDep>()
  const nested = new Set<string>()
  const conflicts = new Set(own.conflicts)
  const conflicted: FileDep[] = []
  let skipped = 0
  for (const d of deps) {
    const froms = own.owners.get(d.from)
    const tos = own.owners.get(d.to)
    if (!froms || !tos) {
      skipped++
      continue
    }
    if (conflicts.has(d.from) || conflicts.has(d.to)) {
      conflicted.push(d)
      continue
    }
    const [a] = froms
    const [b] = tos
    if (related(index, a, b)) {
      if (a !== b) nested.add(depKey(a, b))
      continue
    }
    const key = depKey(a, b)
    const hit = moduleDeps.get(key)
    if (hit) hit.files.push(d)
    else moduleDeps.set(key, { key, from: a, to: b, files: [d] })
  }
  return { moduleDeps, skipped, conflicted, nested }
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

/**
 * K6：一对模块（依赖方 → 被依赖方）连着关系的两端（各自相同或互为祖先后代，同 K5），不论方向与种类。
 * 反向的依赖可由端口解释；祖先与后代之间的依赖（K4 不提升，这里计入）可由注入解释——祖先的文件组装子模块，如协调者把 dispatch 注入同步适配器。
 */
const linked = (index: ModelIndex, r: RelationEntity, from: string, to: string) =>
  (related(index, from, r.from) && related(index, to, r.to)) || (related(index, from, r.to) && related(index, to, r.from))

/** K6：未证实是否报警告 `fact.unconfirmed`——编译期关系一律报；运行时关系只在两端之间连类型依赖都没有（isolated）时报 */
export const unconfirmedWarns = (r: RelationEntity, c: Confirmation): boolean =>
  c.status === 'unconfirmed' && (r.type === 'depends' || r.type === 'implements' || !!c.isolated)

/** K6：报警的未证实关系的说明，问题、返工项与面板共用 */
export const unconfirmedReason = (r: RelationEntity): string =>
  r.type === 'depends' || r.type === 'implements' ? '在代码中没有对应的依赖' : '是运行时关系，但两端之间在代码中没有任何依赖（类型依赖、反向的端口注入都没有）'

/** K5：模块的宿主——自身或最近的、有直接归属文件的祖先；都没有为 undefined */
export function hostOf(index: ModelIndex, direct: ReadonlyMap<string, readonly string[]>, id: string): string | undefined {
  return [...(index.pathOf.get(id) ?? [id])].reverse().find(p => direct.get(p)?.length)
}

/** K5：每条关系的证实状态；两端宿主相同（概念拆分，同文件）的不判定。K6：未证实的标出两端之间是否没有任何依赖（nested 为 K4 未提升的祖先后代依赖） */
export function confirmRelations(
  index: ModelIndex,
  moduleDeps: ReadonlyMap<string, ModuleDep>,
  direct: ReadonlyMap<string, readonly string[]> = new Map(),
  nested: ReadonlySet<string> = new Set(),
): Map<string, Confirmation> {
  const out = new Map<string, Confirmation>()
  const list = [...moduleDeps.values()]
  const pairs = [...list.map(d => [d.from, d.to] as const), ...[...nested].map(k => k.split('->') as [string, string])]
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
    if (deps.length) out.set(r.id, { status: 'confirmed', deps })
    else out.set(r.id, { status: 'unconfirmed', deps, ...(pairs.some(([a, b]) => linked(index, r, a, b)) ? {} : { isolated: true }) })
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
