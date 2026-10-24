/**
 * 代码事实与描述的比对（K4–K7）：文件依赖按归属提升为模块依赖，关系的证实，未解释的交互。
 * 关于被描述系统的知识，页面、lint:model 与 agent 接口共用。
 */
import type { ModelIndex, RelationEntity, RelationType } from '../types'
import { moduleInterfaces, type SourceOwnership } from '../source'
import type { Confirmation, FileDep, Knowledge, ModuleDep } from './types'

export const depKey = (from: string, to: string) => `${from}->${to}`

/** a 是否在 b 的子树内（含 b 自身） */
export const within = (index: ModelIndex, a: string, b: string): boolean => !!index.pathOf.get(a)?.includes(b)

/** a 与 b 相同或互为祖先后代 */
export const related = (index: ModelIndex, a: string, b: string): boolean => within(index, a, b) || within(index, b, a)

/**
 * K4：文件依赖两端取归属模块，去掉同模块与祖先后代，按依赖方 → 被依赖方合并。
 * 有一端未归属或已忽略的单独计数（skipped）；有一端是归属冲突文件（G6）的不提升到任何模块，单独列出（conflicted）——冲突是描述问题，不衍生违规与未解释的交互。
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

/** K5、K7：两个方向的依赖都算的类型——通知的知识方向通常与箭头相反（订阅者导入发布者），流由第三方接线（ADR-0022） */
const EITHER_WAY: readonly RelationType[] = ['notifies', 'streams']

/**
 * K5：依赖的方向——依赖方与 from、被依赖方与 to 各自相同或互为祖先后代为同向，反过来为反向；不相干为 undefined。
 * 端点是祖先的情况：代码经祖先的文件进出（统一入口，如 useDesk() 所在的文件归 DeskState；或概念子模块的代码在祖先的文件里），依赖落在祖先上也算。
 */
function directionOf(index: ModelIndex, r: RelationEntity, from: string, to: string): 'forward' | 'reverse' | undefined {
  if (related(index, from, r.from) && related(index, to, r.to)) return 'forward'
  if (related(index, from, r.to) && related(index, to, r.from)) return 'reverse'
  return undefined
}

/** K5：模块依赖能否作为关系的依据（不看 implements 的证据收窄） */
function supports(index: ModelIndex, r: RelationEntity, d: ModuleDep): 'forward' | 'reverse' | undefined {
  const dir = directionOf(index, r, d.from, d.to)
  return dir === 'forward' || (dir === 'reverse' && EITHER_WAY.includes(r.type)) ? dir : undefined
}

/** 接口名去掉括号与泛型（同 G12 的比较） */
const bareName = (name: string) => name.replace(/[(<].*$/s, '').trim()

/** K5：to 模块声明的接口名（子树内 owner 指向它的接口与 provides，G12） */
export function contractNames(index: ModelIndex, moduleId: string): Set<string> {
  return new Set(moduleInterfaces(index, moduleId).flatMap(id => (index.interfaces.has(id) ? [bareName(index.interfaces.get(id)!.name)] : [])))
}

/** K5：implements 的证据——文件依赖引用了 to 声明的接口名，或类的 implements / extends 解析到它 */
export const contractEvidence = (f: FileDep, names: ReadonlySet<string>) => !!f.heritage || !!f.names?.some(n => names.has(n))

/** 证实依据的知识方向：全部同向 / 全部反向 / 两个方向都有 */
function knowledgeOf(dirs: readonly ('forward' | 'reverse')[]): Knowledge {
  const f = dirs.includes('forward')
  const b = dirs.includes('reverse')
  return f && b ? 'both' : f ? 'forward' : 'reverse'
}

/** K6：未证实是否报警告——编译期关系（ADR-0026 起只有 implements）一律报，结构性实现除外（info，只进返工清单；证据像使用的报 `fact.like-depends`，其余 `fact.unconfirmed`）；运行时关系只在两端之间连类型依赖都没有（isolated）时报 */
export const unconfirmedWarns = (r: RelationEntity, c: Confirmation): boolean =>
  c.status === 'unconfirmed' && !c.structural && (r.type === 'implements' || !!c.isolated)

/** K5、K6：报警的问题代码 */
export const unconfirmedCode = (c: Confirmation) => (c.likeDepends ? 'fact.like-depends' : 'fact.unconfirmed')

/** K6：报警的未证实关系的说明，问题、返工项与面板共用 */
export const unconfirmedReason = (r: RelationEntity, c?: Confirmation): string =>
  c?.structural
    ? '结构性实现（代码未显式声明）：只引了目标模块的数据类型，没有引用它声明的接口，也没有类 implements / extends 它'
    : c?.likeDepends
    ? '证据像使用：代码引用了目标模块的函数、类或变量，没有引用它声明的接口，也没有类 implements / extends 它；有交互时改为 calls，只是知道时删除关系（由代码事实承载）'
    : r.type === 'implements'
      ? '在代码中没有对应的依赖'
      : '是运行时关系，但两端之间在代码中没有任何依赖（类型依赖、反向的端口注入都没有）'

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
    // K5b：经 HTTP、HMR、注入、路由或回调传递的关系，静态导入证实不了
    if (r.via) {
      out.set(r.id, { status: 'skipped', deps: [], via: r.via })
      continue
    }
    const host = hostOf(index, direct, r.from)
    if (host && host === hostOf(index, direct, r.to)) {
      out.set(r.id, { status: 'skipped', deps: [], host })
      continue
    }
    const hits = list.flatMap(d => {
      const dir = supports(index, r, d)
      return dir ? [{ d, dir }] : []
    })
    // K5：implements 的证据收窄为接口名或 implements / extends 子句
    const names = r.type === 'implements' ? contractNames(index, r.to) : undefined
    const evidenced = names ? hits.filter(h => h.d.files.some(f => contractEvidence(f, names))) : hits
    if (evidenced.length) out.set(r.id, { status: 'confirmed', deps: evidenced.map(h => h.d.key), knows: knowledgeOf(evidenced.map(h => h.dir)) })
    // 没有契约证据时按导入分档：引用了实现（函数、类、变量）为证据像使用，只引数据类型为结构性实现
    else if (hits.length) {
      const uses = hits.some(h => h.d.files.some(f => f.uses))
      out.set(r.id, { status: 'unconfirmed', deps: hits.map(h => h.d.key), ...(uses ? { likeDepends: true as const } : { structural: true as const }) })
    }
    // K6：一对模块连着关系的两端（不论方向与种类）——反向的依赖可由端口解释；祖先与后代之间的依赖（K4 不提升，这里计入）可由注入解释
    else out.set(r.id, { status: 'unconfirmed', deps: [], ...(pairs.some(([a, b]) => directionOf(index, r, a, b)) ? {} : { isolated: true }) })
  }
  return out
}

/** K7：关系是否覆盖模块依赖——端点相同或互为祖先后代、方向一致（notifies、streams 不论方向），四类交互都算 */
export function covers(index: ModelIndex, r: RelationEntity, from: string, to: string): boolean {
  if (!index.modules.has(r.from) || !index.modules.has(r.to)) return false
  const dir = directionOf(index, r, from, to)
  return dir === 'forward' || (dir === 'reverse' && EITHER_WAY.includes(r.type))
}

/** K7：被某条关系覆盖的依赖；返回覆盖它的关系 ID（没有则空） */
export function coveringRelations(index: ModelIndex, from: string, to: string): string[] {
  return [...index.relations.values()].filter(r => covers(index, r, from, to)).map(r => r.id)
}

/** K7：未解释的交互——有值使用（某条文件依赖引用了对方的函数、类或变量，K1 的 uses）却没有任何交互关系覆盖的模块依赖；只引类型（含枚举）的不算 */
export function undescribedDeps(index: ModelIndex, moduleDeps: ReadonlyMap<string, ModuleDep>): ModuleDep[] {
  const relations = [...index.relations.values()]
  return [...moduleDeps.values()].filter(d => d.files.some(f => f.uses) && !relations.some(r => covers(index, r, d.from, d.to)))
}
