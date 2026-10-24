/**
 * 代码事实与描述的比对（K4–K7、K5c、K12、K13）：文件依赖按归属提升为模块依赖，关系与端口实现者的证实，子类与组装事实，未解释的交互。
 * 关于被描述系统的知识，页面、lint:model 与 agent 接口共用。
 */
import { isUnclassified, parseVia, type ModelIndex, type RelationEntity, type RelationType } from '../types'
import { moduleInterfaces, type SourceOwnership } from '../source'
import {
  ASSEMBLY_KINDS,
  type AssemblyFact,
  type Confirmation,
  type FileDep,
  type ImplementerFact,
  type InvokeKind,
  type Knowledge,
  type ModuleDep,
  type PortFacts,
  type SubclassFact,
} from './types'

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
export const isTarget = (index: ModelIndex, id: string) => (index.pathOf.get(id) ?? []).some(p => index.modules.get(p)?.status === 'target')

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

/** K5：模块依赖能否作为关系的依据 */
function supports(index: ModelIndex, r: RelationEntity, d: ModuleDep): 'forward' | 'reverse' | undefined {
  const dir = directionOf(index, r, d.from, d.to)
  return dir === 'forward' || (dir === 'reverse' && EITHER_WAY.includes(r.type)) ? dir : undefined
}

/** 接口名去掉括号与泛型（同 G12 的比较） */
const bareName = (name: string) => name.replace(/[(<].*$/s, '').trim()

/** K5c：模块声明的接口名（子树内 owner 指向它的接口与 provides，G12） */
export function contractNames(index: ModelIndex, moduleId: string): Set<string> {
  return new Set(moduleInterfaces(index, moduleId).flatMap(id => (index.interfaces.has(id) ? [bareName(index.interfaces.get(id)!.name)] : [])))
}

/** K5c：实现者的 ① 档证据——文件依赖引用了这些接口名，或类的 implements / extends 解析到它们（旧的只带 heritage 标记的依赖按解析到算） */
export const contractEvidence = (f: FileDep, names: ReadonlySet<string>) =>
  !!f.names?.some(n => names.has(n)) || (f.inherits ? f.inherits.some(h => names.has(h.name)) : !!f.heritage)

/** 端口的定义模块：接口的 owner；没写时取 provides 它的第一个模块 */
export function portOwner(index: ModelIndex, portId: string): string | undefined {
  const owner = index.interfaces.get(portId)?.owner
  if (owner) return owner
  return [...index.modules.values()].sort((a, b) => a.seq - b.seq).find(m => m.provides?.includes(portId))?.id
}

/** K7：交互使用中要由关系解释的部分——调用、渲染或交出；只有 extends（子类事实）或组装使用（组装事实）的不算（T0 裁决 5） */
export const plainInteraction = (f: FileDep): boolean => !!f.invokes && (!f.invokeKinds?.length || f.invokeKinds.includes('call'))

/** 证实依据的知识方向：全部同向 / 全部反向 / 两个方向都有 */
function knowledgeOf(dirs: readonly ('forward' | 'reverse')[]): Knowledge {
  const f = dirs.includes('forward')
  const b = dirs.includes('reverse')
  return f && b ? 'both' : f ? 'forward' : 'reverse'
}

/** K6：交互关系未证实时，只在两端之间连类型依赖都没有（isolated）时报警告（ADR-0029 起编译期一档移到端口实现者，见 implementerWarns） */
export const unconfirmedWarns = (_r: RelationEntity, c: Confirmation): boolean => c.status === 'unconfirmed' && !!c.isolated

/** K5c、K6：端口实现者未证实时报警告，结构性实现除外（info，只进返工清单）；证据像使用报 `fact.like-depends`，其余 `fact.unconfirmed` */
export const implementerWarns = (c: Confirmation): boolean => c.status === 'unconfirmed' && !c.structural

/** K5、K6：报警的问题代码 */
export const unconfirmedCode = (c: Confirmation) => (c.likeDepends ? 'fact.like-depends' : 'fact.unconfirmed')

/** K6：报警的未证实关系的说明，问题、返工项与面板共用 */
export const unconfirmedReason = (_r: RelationEntity, _c?: Confirmation): string => '是交互关系，但两端之间在代码中没有任何依赖（类型依赖、反向的端口注入都没有）'

/** K5c、K6：端口实现者未证实的说明 */
export const implementerReason = (c: Confirmation): string =>
  c.structural
    ? '结构性实现（代码未显式声明）：只引了定义模块的数据类型，没有引用这个接口，也没有类 implements / extends 它'
    : c.likeDepends
      ? '证据像使用：代码引用了定义模块的函数、类或变量，没有引用这个接口，也没有类 implements / extends 它；是在使用对方而不是实现它时，从 implementedBy 去掉并按交互改写（查询或委托）'
      : '在代码中没有实现者 → 定义模块的依赖'

/** K5：模块的宿主——自身或最近的、有直接归属文件的祖先；都没有为 undefined */
export function hostOf(index: ModelIndex, direct: ReadonlyMap<string, readonly string[]>, id: string): string | undefined {
  return [...(index.pathOf.get(id) ?? [id])].reverse().find(p => direct.get(p)?.length)
}

/**
 * K5：每条关系的证实状态；两端宿主相同（概念拆分，同文件）的不判定。K6：未证实的标出两端之间是否没有任何依赖（nested 为 K4 未提升的祖先后代依赖）。
 * K5b：写了 via 的按机制判定——经端口 port:<P> 时发起方对 P 的定义模块有依赖、且接收方是 P 的已证实实现者（implementers，K5c ①）即「已证实（经端口）」，
 * to 写的是定义模块时只看前一半；其余机制与未指明的不判定。
 */
export function confirmRelations(
  index: ModelIndex,
  moduleDeps: ReadonlyMap<string, ModuleDep>,
  direct: ReadonlyMap<string, readonly string[]> = new Map(),
  nested: ReadonlySet<string> = new Set(),
  implementers: ReadonlyMap<string, PortFacts> = new Map(),
): Map<string, Confirmation> {
  const out = new Map<string, Confirmation>()
  const list = [...moduleDeps.values()]
  const pairs = [...list.map(d => [d.from, d.to] as const), ...[...nested].map(k => k.split('->') as [string, string])]
  for (const r of index.relations.values()) {
    if (!judgeable(index, r)) {
      out.set(r.id, { status: 'skipped', deps: [] })
      continue
    }
    if (r.via) {
      const v = parseVia(r.via)
      const owner = v?.kind === 'port' && v.target ? portOwner(index, v.target) : undefined
      if (owner) {
        const hits = list.filter(d => related(index, d.from, r.from) && related(index, d.to, owner))
        const toOwner = related(index, r.to, owner)
        const impl = toOwner || !!implementers.get(v!.target!)?.implementers.some(i => i.status === 'confirmed' && related(index, i.module, r.to))
        if (hits.length && impl) {
          out.set(r.id, { status: 'confirmed', deps: hits.map(d => d.key), knows: 'forward', via: r.via, port: v!.target })
          continue
        }
      }
      // K5b：经总线、通道，或端口证实不了的，静态导入在原理上证实不了
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
    if (hits.length) out.set(r.id, { status: 'confirmed', deps: hits.map(h => h.d.key), knows: knowledgeOf(hits.map(h => h.dir)) })
    // K6：一对模块连着关系的两端（不论方向与种类）——反向的依赖可由端口解释；祖先与后代之间的依赖（K4 不提升，这里计入）可由注入解释
    else out.set(r.id, { status: 'unconfirmed', deps: [], ...(pairs.some(([a, b]) => directionOf(index, r, a, b)) ? {} : { isolated: true }) })
  }
  return out
}

/**
 * K5c：端口实现者的证据。描述的实现者（implementedBy）对定义模块 O 有模块依赖时按导入分档——① 引用了接口名或类 implements / extends 解析到它 → 已证实；
 * ② 只引数据类型 → 结构性实现；③ 引用了函数、类或变量 → 证据像使用；没有依赖 → 未证实（K6，isolated 表示两端之间连反向、祖先后代的依赖都没有）。
 * 代码事实里类 implements / extends 解析到该接口、而描述没写的模块列为「仅代码事实」的实现者（code: true，described: false）。
 * 实现者或定义模块是目标态、两端宿主相同的不判定。只返回有实现者的接口。
 */
export function confirmImplementers(
  index: ModelIndex,
  moduleDeps: ReadonlyMap<string, ModuleDep>,
  direct: ReadonlyMap<string, readonly string[]> = new Map(),
  nested: ReadonlySet<string> = new Set(),
): Map<string, PortFacts> {
  const out = new Map<string, PortFacts>()
  const list = [...moduleDeps.values()]
  const pairs = [...list.map(d => [d.from, d.to] as const), ...[...nested].map(k => k.split('->') as [string, string])]
  for (const x of index.interfaces.values()) {
    const owner = portOwner(index, x.id)
    const names = new Set([bareName(x.name)])
    const described = x.implementedBy ?? []
    // 代码事实：类 implements / extends 解析到这个接口名（依赖落在定义模块或其祖先后代上）
    const code = new Set<string>()
    if (owner)
      for (const d of list)
        if (related(index, d.to, owner) && d.files.some(f => f.inherits?.some(h => names.has(h.name)))) code.add(d.from)
    if (!described.length && !code.size) continue
    const implementers: ImplementerFact[] = []
    const judge = (m: string): Confirmation => {
      if (!owner || !index.modules.has(m) || isTarget(index, m) || isTarget(index, owner)) return { status: 'skipped', deps: [] }
      const host = hostOf(index, direct, m)
      if (host && host === hostOf(index, direct, owner)) return { status: 'skipped', deps: [], host }
      const hits = list.filter(d => related(index, d.from, m) && related(index, d.to, owner))
      const evidenced = hits.filter(d => d.files.some(f => contractEvidence(f, names)))
      if (evidenced.length) return { status: 'confirmed', deps: evidenced.map(d => d.key), knows: 'forward' }
      if (hits.length) {
        const uses = hits.some(d => d.files.some(f => f.uses))
        return { status: 'unconfirmed', deps: hits.map(d => d.key), ...(uses ? { likeDepends: true as const } : { structural: true as const }) }
      }
      const linked = pairs.some(([a, b]) => (related(index, a, m) && related(index, b, owner)) || (related(index, a, owner) && related(index, b, m)))
      return { status: 'unconfirmed', deps: [], ...(linked ? {} : { isolated: true as const }) }
    }
    for (const m of described) implementers.push({ module: m, described: true, code: code.has(m), ...judge(m) })
    for (const m of code) if (!described.includes(m)) implementers.push({ module: m, described: false, code: true, ...judge(m) })
    out.set(x.id, { port: x.id, ...(owner ? { owner } : {}), implementers })
  }
  return out
}

/** K5c、K7：模块 a 是不是 b 子树内（或祖先、后代）某端口的实现者（描述或「仅代码事实」） */
function implementsInto(index: ModelIndex, implementers: ReadonlyMap<string, PortFacts>, a: string, b: string): boolean {
  for (const p of implementers.values()) if (p.owner && related(index, p.owner, b) && p.implementers.some(i => related(index, i.module, a))) return true
  return false
}

/**
 * K12：子类事实——文件依赖里类 extends 的名字（K1 的 inherits，子句为 extends），声明不是接口或类型别名、也不是目标子树内描述的接口（指向端口的按 K5c 算实现者），
 * 依赖方模块即被依赖方模块的子类；按模块对聚合（K4 已去掉同一模块、祖先后代与归属冲突）。
 */
export function heritageFacts(index: ModelIndex, moduleDeps: ReadonlyMap<string, ModuleDep>): SubclassFact[] {
  const out: SubclassFact[] = []
  for (const d of moduleDeps.values()) {
    const ports = contractNames(index, d.to)
    const files = d.files.filter(f => f.inherits?.some(h => h.clause === 'extends' && h.name !== '*' && !ports.has(h.name) && h.decl !== 'interface' && h.decl !== 'type'))
    if (files.length) out.push({ key: d.key, from: d.from, to: d.to, files })
  }
  return out
}

/**
 * K13：组装事实——依赖方文件对目标做了组装使用（new、工厂命名的调用、交给容器注册调用，K1 的 invokeKinds），即依赖方模块组装被依赖方模块；按模块对聚合。
 * 组装根 = 模块级组装图中出度 ≥ 1、入度为 0 的模块（T0 裁决 6），按名称排序。
 */
export function assemblyFacts(moduleDeps: ReadonlyMap<string, ModuleDep>): { facts: AssemblyFact[]; roots: string[] } {
  const facts: AssemblyFact[] = []
  for (const d of moduleDeps.values()) {
    const files = d.files.filter(f => f.invokeKinds?.some(k => ASSEMBLY_KINDS.includes(k)))
    if (!files.length) continue
    const kinds = [...new Set(files.flatMap(f => f.invokeKinds!.filter(k => ASSEMBLY_KINDS.includes(k))))].sort() as InvokeKind[]
    facts.push({ key: d.key, from: d.from, to: d.to, kinds, files })
  }
  const targets = new Set(facts.map(f => f.to))
  const roots = [...new Set(facts.map(f => f.from))].filter(m => !targets.has(m)).sort()
  return { facts, roots }
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

/**
 * K7：未解释的交互——有交互使用（某条文件依赖调用、渲染了对方的实现，或把对方的函数、类、组件作为值交出，K1 的 invokes）
 * 却没有任何交互关系覆盖的模块依赖；只引类型（含枚举）的、纯值读取（常量、只读值、只读成员）的不算，由事实承载。
 * ADR-0029、ADR-0030：依赖方是被依赖方子树内某端口的实现者（K5c）的不算；只有 extends（子类事实，K12）或只有组装使用（组装事实，K13）的不算（T0 裁决 5）。
 */
export function undescribedDeps(index: ModelIndex, moduleDeps: ReadonlyMap<string, ModuleDep>, implementers: ReadonlyMap<string, PortFacts> = new Map()): ModuleDep[] {
  const relations = [...index.relations.values()]
  return [...moduleDeps.values()].filter(
    d => d.files.some(plainInteraction) && !relations.some(r => covers(index, r, d.from, d.to)) && !implementsInto(index, implementers, d.from, d.to),
  )
}

// ── 四类交互（ADR-0029）：未分类关系与「核心之间」（M17）——描述查询，lint:model 摘要与返工清单共用 ──

/** M17：模块自身及祖先中的核心模块（role: core）；参与者与没有核心祖先的模块为空 */
export function coresOf(index: ModelIndex, id: string): string[] {
  return (index.pathOf.get(id) ?? []).filter(p => index.modules.get(p)?.role === 'core')
}

/**
 * M17（T0 裁决 12）：核心之间——两端各自是核心模块或在核心模块的子树内，且没有一个核心模块的子树同时包含两端。
 * 架构师只确认这些线的分类（写进草图即确认，X23）。
 */
export function isCoreBetween(index: ModelIndex, r: Pick<RelationEntity, 'from' | 'to'>): boolean {
  const a = coresOf(index, r.from)
  const b = coresOf(index, r.to)
  return a.length > 0 && b.length > 0 && !a.some(x => b.includes(x))
}

/** M17：未分类（calls）的关系与其中核心之间的，按声明顺序 */
export function unclassifiedRelations(index: ModelIndex): { all: RelationEntity[]; core: RelationEntity[] } {
  const all = [...index.relations.values()].filter(r => isUnclassified(r.type)).sort((a, b) => a.seq - b.seq)
  return { all, core: all.filter(r => isCoreBetween(index, r)) }
}
