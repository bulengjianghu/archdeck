/**
 * 模块表面（ADR-0032）：表面元素与匹配（K18）、依赖接到元素与越过入口（C3）、元素级边的形态与档（K14、A2、A3）、表面指标 W / B 与元素扇入（K19）、
 * 越过入口（U18）与热表面未声明（U19）。表面 = 入口（G10）导出的符号（G11，再导出按 K1 / K3 穿透到声明文件）与描述声明的接口（G12）。
 * 只读代码事实、归属与描述；入口导出由调用方给出（接入层读，SurfaceSource.exportsOf），读不到时元素种类按用法推断。
 */
import { moduleName } from '../names'
import { moduleInterfaces, type ExportedSymbol } from '../source'
import type { Issue, ModelIndex } from '../types'
import { valueDeps } from './cycles'
import { within } from './facts'
import {
  ASSEMBLY_KINDS,
  DEP_FORMS,
  DEP_TIERS,
  ELEMENT_KINDS,
  type DepForm,
  type DepTier,
  type ElementKind,
  type ElementUse,
  type FileDep,
  type GovernanceReport,
  type InvokeKind,
  type ModuleDep,
  type ModuleSurface,
  type SurfaceElement,
  type SurfaceMetrics,
  type SurfaceSource,
} from './types'

/** U19：导出未声明的元素被至少这么多个模块使用时提示声明接口（C4，h5player 实测后定） */
export const HOT_SURFACE_MODULES = 3

/** K14：一组文件依赖的档——任一条有交互使用为 invokes，否则有值使用（纯值读取）为 value，其余为 type */
export const tierOf = (files: readonly FileDep[]): DepTier =>
  files.some(f => f.invokes) ? 'invokes' : files.some(f => f.uses || f.kind === 'value') ? 'value' : 'type'

/** 两档取强 */
export const strongerTier = (a: DepTier, b: DepTier): DepTier => (DEP_TIERS.indexOf(a) <= DEP_TIERS.indexOf(b) ? a : b)
/** 两种形态取强（DEP_FORMS 顺序） */
export const strongerForm = (a: DepForm, b: DepForm): DepForm => (DEP_FORMS.indexOf(a) <= DEP_FORMS.indexOf(b) ? a : b)

/** 接口名去掉括号与泛型（同 G12 的比较） */
const bareName = (name: string) => name.replace(/[(<].*$/s, '').trim()

/** C2：入口导出的种类 → 元素种类——函数、类、可调用常量、命名空间、默认与未解析的再导出为操作；interface / type 为类型；枚举与纯数据常量为数据 */
export function elementKindOf(s: Pick<ExportedSymbol, 'kind' | 'callable' | 'data'>): ElementKind {
  if (s.kind === 'interface' || s.kind === 'type') return 'type'
  if (s.kind === 'enum' || (s.kind === 'const' && s.data && !s.callable)) return 'data'
  return 'operation'
}

/** C2：入口导出没读到时按用法推断元素种类——继承子句给出的声明种类，否则只引类型为类型、交互使用为操作、纯值读取为数据 */
function guessKind(f: FileDep, name: string): ElementKind {
  const decl = f.inherits?.find(h => h.name === name)?.decl
  if (decl === 'interface' || decl === 'type') return 'type'
  if (decl === 'class' || decl === 'function') return 'operation'
  if (f.kind === 'type') return 'type'
  if (f.invokes) return 'operation'
  return f.uses ? 'data' : 'type'
}

/**
 * C3：一条文件依赖对被依赖方模块 M 的表面——经 M 的入口（或经 M 子树之外的文件，如祖先的入口再导出）的命名导入按名字接到元素（elements），
 * 不按名字的（namespace、默认、`*`、副作用）接到整模块（whole）；经由 M 子树内、不是 M 入口的文件为越过入口（bypass）；M 没有入口时不判（none）。
 */
export type SurfaceGate = 'elements' | 'whole' | 'bypass' | 'none'

export function gateOf(index: ModelIndex, src: SurfaceSource, moduleId: string, f: FileDep): SurfaceGate {
  const entry = src.entryOf(moduleId)
  if (!entry) return 'none'
  const named = !!f.names?.length
  if (f.via === entry) return named ? 'elements' : 'whole'
  if ((src.own.owners.get(f.via) ?? []).some(o => within(index, o, moduleId))) return 'bypass'
  return named ? 'elements' : 'whole'
}

/** K13：工厂函数的命名（同接入层的 FACTORY_NAME，T0 裁决 6） */
const FACTORY_NAME = /^(create|make|build)[A-Z]|(Factory|factory)$/

/** A2：组装使用落到这个元素——new 落到类（导出未读到时按首字母大写），工厂落到工厂命名的操作，注册落到任一操作 */
function assemblyFits(kinds: readonly InvokeKind[], e: SurfaceElement): boolean {
  if (e.kind !== 'operation') return false
  return kinds.some(k => (k === 'new' ? (e.exportKind ? e.exportKind === 'class' : /^[A-Z]/.test(e.name)) : k === 'factory' ? FACTORY_NAME.test(e.name) : true))
}

/**
 * K14、A2：元素级边的形态，由元素与用法决定，一条边只有一种——继承子句指向端口（或声明的接口名，K5c）→ 端口实现；extends 一个类 → 子类（K12）；
 * 组装使用（new、工厂、注册，K13）落到操作元素 → 组装；其余（调用操作、读数据、引类型）→ 使用。element 为 null（整模块、越过入口、没有入口）时按整条文件依赖判。
 * ports 为被依赖方声明的接口名（contractNames）。
 */
export function formOf(f: FileDep, element: SurfaceElement | null, ports: ReadonlySet<string> = new Set()): DepForm {
  const hs = (f.inherits ?? []).filter(h => !element || h.name === element.name)
  if (hs.some(h => ports.has(h.name) || element?.kind === 'port')) return 'implements'
  if (hs.some(h => h.clause === 'extends' && h.name !== '*' && h.decl !== 'interface' && h.decl !== 'type')) return 'subclass'
  const asm = (f.invokeKinds ?? []).filter(k => ASSEMBLY_KINDS.includes(k))
  if (asm.length && (!element || assemblyFits(asm, element))) return 'assembly'
  return 'use'
}

/** A2：一条文件依赖接到的各元素的形态；有组装使用却没有元素对得上时（名字与种类都推不出），其中的操作元素都算组装，不丢组装事实 */
export function fileForms(f: FileDep, elements: readonly SurfaceElement[], ports: ReadonlySet<string> = new Set()): DepForm[] {
  const forms = elements.map(e => formOf(f, e, ports))
  if (f.invokeKinds?.some(k => ASSEMBLY_KINDS.includes(k)) && !forms.includes('assembly'))
    elements.forEach((e, i) => {
      if (forms[i] === 'use' && e.kind === 'operation') forms[i] = 'assembly'
    })
  return forms
}

/** A3：元素级边的档——文件依赖的档，接到类型元素的只引类型、接到数据元素的至多值使用；端口元素没读到导出种类时按接口（类型）算 */
export function elementTier(f: FileDep, e: SurfaceElement | null): DepTier {
  const t = tierOf([f])
  if (!e) return t
  const typeLike = e.exportKind ? e.exportKind === 'interface' || e.exportKind === 'type' : e.kind === 'port'
  if (e.kind === 'type' || typeLike) return 'type'
  if (e.kind === 'data' && t === 'invokes') return 'value'
  return t
}

/** A1：一条元素级边的内容（两端由调用方给出） */
export interface EdgeSlot {
  element: SurfaceElement | null
  bypass: boolean
  form: DepForm
  tier: DepTier
  files: FileDep[]
}

/**
 * A1–A3、C3：一组文件依赖接到被依赖方模块 M 表面的元素级边——经入口的命名导入每个名字一条（形态由元素与用法定），整模块导入与 M 没有入口的接到模块本体，
 * 越过入口的接到模块本体并带记号；同一元素同一形态合并、档取最强。顺序：元素按名字，其后整模块、越过入口；同一元素按 DEP_FORMS。
 * ports 为每条文件依赖的被依赖方声明的接口名（contractNames）；ctx 为 null（没给表面来源）或 moduleId 为 null 时一律接到模块本体、不判越过入口。
 */
export function elementSlots(
  index: ModelIndex,
  ctx: { src: SurfaceSource; ctx: SurfaceContext } | null,
  moduleId: string | null,
  files: Iterable<{ f: FileDep; ports: ReadonlySet<string> }>,
): EdgeSlot[] {
  const slots = new Map<string, EdgeSlot>()
  const put = (key: string, element: SurfaceElement | null, bypass: boolean, form: DepForm, tier: DepTier, f: FileDep) => {
    const k = `${form}:${key}`
    const slot = slots.get(k) ?? slots.set(k, { element, bypass, form, tier, files: [] }).get(k)!
    slot.tier = strongerTier(slot.tier, tier)
    if (!slot.files.includes(f)) slot.files.push(f)
  }
  for (const { f, ports } of files) {
    const gate = ctx && moduleId ? gateOf(index, ctx.src, moduleId, f) : 'none'
    if (gate === 'elements') {
      const els = f.names!.map(n => ctx!.ctx.element(moduleId!, n, f))
      fileForms(f, els, ports).forEach((form, i) => put(els[i].name, els[i], false, form, elementTier(f, els[i]), f))
    } else put(gate === 'bypass' ? '!' : '*', null, gate === 'bypass', formOf(f, null, ports), tierOf([f]), f)
  }
  const rank = (a: EdgeSlot) => (a.element ? 0 : a.bypass ? 2 : 1)
  return [...slots.values()].sort(
    (a, b) => rank(a) - rank(b) || (a.element?.name ?? '').localeCompare(b.element?.name ?? '') || DEP_FORMS.indexOf(a.form) - DEP_FORMS.indexOf(b.form),
  )
}

/** 元素级边 ID 的元素一段：元素名，整模块为 `*`，越过入口为 `!` */
export const slotKey = (x: Pick<EdgeSlot, 'element' | 'bypass'>) => x.element?.name ?? (x.bypass ? '!' : '*')

/** 表面元素的顺序：端口、操作、类型、数据，同类按名字；声明未导出的排在最后 */
const elementOrder = (a: SurfaceElement, b: SurfaceElement) =>
  Number(a.state === 'declared-only' || a.state === 'declared') - Number(b.state === 'declared-only' || b.state === 'declared') ||
  ELEMENT_KINDS.indexOf(a.kind) - ELEMENT_KINDS.indexOf(b.kind) ||
  a.name.localeCompare(b.name)

type PortPart = Pick<GovernanceReport, 'implementers'> | null | undefined

/**
 * K18：表面的计算上下文——按模块缓存入口、入口导出与声明接口；element 给出一个被引用的名字对应的元素（导出里没有的按用法推断种类，标 guessed）。
 * 页面、命令行与 lint 共用；同一次计算里共用一份，避免重复读入口导出。
 */
export function surfaceContext(index: ModelIndex, src: SurfaceSource, report?: PortPart) {
  interface Slot {
    entry: string | null
    exports: readonly ExportedSymbol[] | null
    /** 声明接口：去掉括号与泛型的名字 → 接口 ID */
    declared: Map<string, string>
    byName: Map<string, SurfaceElement>
  }
  const slots = new Map<string, Slot>()
  const isPort = (id: string) => !!index.interfaces.get(id)?.port || !!report?.implementers.has(id)
  const slotOf = (m: string): Slot => {
    const hit = slots.get(m)
    if (hit) return hit
    const entry = src.entryOf(m)
    const exports = entry ? (src.exportsOf?.(entry) ?? null) : null
    const declared = new Map<string, string>()
    for (const id of moduleInterfaces(index, m)) {
      const x = index.interfaces.get(id)
      if (x && !declared.has(bareName(x.name))) declared.set(bareName(x.name), id)
    }
    const byName = new Map<string, SurfaceElement>()
    for (const s of exports ?? []) {
      if (s.name === 'default' || byName.has(s.name)) continue
      const id = declared.get(s.name)
      byName.set(s.name, {
        module: m,
        name: s.name,
        kind: id && isPort(id) ? 'port' : elementKindOf(s),
        state: id ? 'declared-exported' : 'exported-only',
        ...(id ? { interfaceId: id } : {}),
        exportKind: s.kind,
        file: s.from ?? entry!,
        line: s.line,
      })
    }
    const slot = { entry, exports, declared, byName }
    slots.set(m, slot)
    return slot
  }
  /** C3：经入口按名字引用的元素；导出里没有（没读到、或解析不到）时按用法推断 */
  const element = (m: string, name: string, f: FileDep): SurfaceElement => {
    const s = slotOf(m)
    const hit = s.byName.get(name)
    if (hit) return hit
    const id = s.declared.get(name)
    const e: SurfaceElement = {
      module: m,
      name,
      kind: id && isPort(id) ? 'port' : guessKind(f, name),
      state: id ? 'declared-exported' : 'exported-only',
      ...(id ? { interfaceId: id } : {}),
      file: f.to,
      guessed: true,
    }
    s.byName.set(name, e)
    return e
  }
  /** K18：模块的表面——入口导出与被引用的名字，加上没有对上的声明接口 */
  const surface = (m: string): ModuleSurface => {
    const s = slotOf(m)
    const elements = [...s.byName.values()]
    const used = new Set(elements.flatMap(e => (e.interfaceId ? [e.interfaceId] : [])))
    for (const [name, id] of s.declared) {
      if (used.has(id)) continue
      const sig = index.interfaces.get(id)?.signature ?? index.interfaces.get(id)?.name ?? ''
      elements.push({
        module: m,
        name,
        kind: isPort(id) ? 'port' : sig.includes('(') ? 'operation' : 'type',
        state: s.entry && !s.exports ? 'declared' : 'declared-only',
        interfaceId: id,
      })
    }
    return { module: m, entry: s.entry, facts: true, exports: !!s.exports, elements: elements.sort(elementOrder) }
  }
  return { element, surface, entryOf: (m: string) => slotOf(m).entry }
}

export type SurfaceContext = ReturnType<typeof surfaceContext>

/** 模块依赖里依赖方在 M 子树外、被依赖方在 M 子树内的（valuesOnly 时去掉只引类型，同 Y1） */
function depsInto(index: ModelIndex, report: Pick<GovernanceReport, 'moduleDeps'>, moduleId: string, valuesOnly = false): ModuleDep[] {
  const all = valuesOnly ? valueDeps(report.moduleDeps.values()) : [...report.moduleDeps.values()]
  return all.filter(d => within(index, d.to, moduleId) && !within(index, d.from, moduleId))
}

/**
 * K18、C8：模块的表面——入口导出（与被引用、导出里没有的名字）按 G12 与声明接口匹配，外加声明未导出的接口；
 * 没有代码事实（src 为 null，设计版本，K8）时只有声明接口，状态为 declared。不是模块为 null。
 */
export function surfaceOf(
  index: ModelIndex,
  src: SurfaceSource | null,
  moduleId: string,
  report?: Pick<GovernanceReport, 'moduleDeps' | 'implementers'> | null,
  ctx?: SurfaceContext,
): ModuleSurface | null {
  if (!index.modules.has(moduleId)) return null
  if (!src) {
    const elements: SurfaceElement[] = moduleInterfaces(index, moduleId).flatMap(id => {
      const x = index.interfaces.get(id)
      if (!x) return []
      const sig = x.signature ?? x.name
      return [{ module: moduleId, name: bareName(x.name), kind: x.port ? 'port' : sig.includes('(') ? 'operation' : 'type', state: 'declared', interfaceId: id } as SurfaceElement]
    })
    return { module: moduleId, entry: null, facts: false, exports: false, elements: elements.sort(elementOrder) }
  }
  const c = ctx ?? surfaceContext(index, src, report)
  // 被引用、导出里没有的名字一并列出（按用法推断种类）
  if (report && c.entryOf(moduleId))
    for (const d of depsInto(index, report, moduleId))
      for (const f of d.files) if (gateOf(index, src, moduleId, f) === 'elements') for (const n of f.names!) c.element(moduleId, n, f)
  return c.surface(moduleId)
}

const byFile = (a: FileDep, b: FileDep) => a.from.localeCompare(b.from) || a.line - b.line || a.to.localeCompare(b.to)

/**
 * K19：模块的表面指标——W 为被子树外引用的不同元素数，B 为越过入口的文件依赖条数，每个元素的扇入为使用它的模块数；
 * 模块没有入口时 W / B 为 null（不判）。valuesOnly 时只看值依赖（同 K16）。
 */
export function surfaceMetrics(
  index: ModelIndex,
  report: Pick<GovernanceReport, 'moduleDeps' | 'implementers'>,
  src: SurfaceSource,
  moduleId: string,
  opts: { valuesOnly?: boolean; ctx?: SurfaceContext } = {},
): SurfaceMetrics {
  const c = opts.ctx ?? surfaceContext(index, src, report)
  const entry = c.entryOf(moduleId)
  if (!entry) return { module: moduleId, entry: null, w: null, b: null, uses: [], bypasses: [], whole: 0 }
  const uses = new Map<string, { element: SurfaceElement; modules: Set<string>; files: FileDep[] }>()
  const bypasses: FileDep[] = []
  let whole = 0
  for (const d of depsInto(index, report, moduleId, opts.valuesOnly))
    for (const f of d.files) {
      const g = gateOf(index, src, moduleId, f)
      if (g === 'bypass') bypasses.push(f)
      else if (g === 'whole') whole++
      else if (g === 'elements')
        for (const n of f.names!) {
          const u = uses.get(n) ?? uses.set(n, { element: c.element(moduleId, n, f), modules: new Set(), files: [] }).get(n)!
          u.modules.add(d.from)
          if (!u.files.includes(f)) u.files.push(f)
        }
    }
  const list: ElementUse[] = [...uses.values()]
    .map(u => ({ element: u.element, modules: [...u.modules].sort(), files: u.files.sort(byFile) }))
    .sort((a, b) => b.modules.length - a.modules.length || a.element.name.localeCompare(b.element.name))
  return { module: moduleId, entry, w: list.length, b: bypasses.length, uses: list, bypasses: bypasses.sort(byFile), whole }
}

/** C3、C7：模块的越过入口清单（依赖方文件:行 → 符号），按依赖方文件、行 */
export function bypassesOf(index: ModelIndex, report: Pick<GovernanceReport, 'moduleDeps' | 'implementers'>, src: SurfaceSource, moduleId: string): FileDep[] {
  return surfaceMetrics(index, report, src, moduleId).bypasses
}

/** K19：全部模块（含父模块，按子树计）的 W / B；只列有入口的模块 */
export function surfaceWidths(
  index: ModelIndex,
  report: Pick<GovernanceReport, 'moduleDeps'>,
  src: SurfaceSource,
  opts: { valuesOnly?: boolean } = {},
): Map<string, { w: number; b: number }> {
  const names = new Map<string, Set<string>>()
  const out = new Map<string, { w: number; b: number }>()
  const deps = opts.valuesOnly ? valueDeps(report.moduleDeps.values()) : [...report.moduleDeps.values()]
  for (const d of deps) {
    const pf = index.pathOf.get(d.from) ?? []
    for (const m of index.pathOf.get(d.to) ?? []) {
      if (pf.includes(m) || m === index.rootId || !src.entryOf(m)) continue
      const slot = out.get(m) ?? out.set(m, { w: 0, b: 0 }).get(m)!
      const ns = names.get(m) ?? names.set(m, new Set()).get(m)!
      for (const f of d.files) {
        const g = gateOf(index, src, m, f)
        if (g === 'bypass') slot.b++
        else if (g === 'elements') for (const n of f.names!) ns.add(n)
      }
    }
  }
  for (const [m, ns] of names) out.get(m)!.w = ns.size
  return out
}

/** U18、U19：一条模块依赖的表面所属——被依赖方路径上（由深到浅）第一个不含依赖方、有入口的模块；都没有为 null */
export function gateModule(index: ModelIndex, src: SurfaceSource, d: Pick<ModuleDep, 'from' | 'to'>): string | null {
  const pf = index.pathOf.get(d.from) ?? []
  const pt = index.pathOf.get(d.to) ?? []
  for (let i = pt.length - 1; i >= 0; i--) {
    const m = pt[i]
    if (pf.includes(m) || m === index.rootId) break
    if (src.entryOf(m)) return m
  }
  return null
}

/** 列出至多几个，多的写「等 N 个」 */
const listNames = (xs: readonly string[], n = 3) => (xs.length > n ? `${xs.slice(0, n).join('、')} 等 ${xs.length} 个` : xs.join('、'))

/**
 * U18、U19（info，不进门禁，进问题页签）：每条模块依赖按 gateModule 定表面所属的模块 G——
 * U18 越过入口：G 有文件依赖经由它子树内、不是入口的文件（一个 G 一条，列依赖方与第一处）；
 * U19 热表面未声明：G 的入口导出里没有声明为接口的元素被至少 HOT_SURFACE_MODULES 个模块使用（一个元素一条，建议声明接口）。
 */
export function surfaceIssues(index: ModelIndex, report: Pick<GovernanceReport, 'moduleDeps'>, src: SurfaceSource, threshold = HOT_SURFACE_MODULES): Issue[] {
  const bypass = new Map<string, { files: FileDep[]; from: Set<string> }>()
  const hot = new Map<string, Map<string, Set<string>>>()
  const declared = new Map<string, Set<string>>()
  const declaredOf = (m: string) =>
    declared.get(m) ??
    declared
      .set(m, new Set(moduleInterfaces(index, m).flatMap(id => (index.interfaces.has(id) ? [bareName(index.interfaces.get(id)!.name)] : []))))
      .get(m)!
  for (const d of report.moduleDeps.values()) {
    const g = gateModule(index, src, d)
    if (!g) continue
    for (const f of d.files) {
      const k = gateOf(index, src, g, f)
      if (k === 'bypass') {
        const b = bypass.get(g) ?? bypass.set(g, { files: [], from: new Set() }).get(g)!
        b.files.push(f)
        b.from.add(d.from)
      } else if (k === 'elements')
        for (const n of f.names!) {
          if (declaredOf(g).has(n)) continue
          const byName = hot.get(g) ?? hot.set(g, new Map()).get(g)!
          ;(byName.get(n) ?? byName.set(n, new Set()).get(n)!).add(d.from)
        }
    }
  }
  const name = (id: string) => moduleName(index, id)
  const out: Issue[] = []
  for (const [g, b] of [...bypass].sort((x, y) => x[0].localeCompare(y[0]))) {
    const first = [...b.files].sort(byFile)[0]
    out.push({
      severity: 'info',
      code: 'surface.bypass',
      message: `模块「${name(g)}」有 ${b.files.length} 条文件依赖越过入口（入口 ${src.entryOf(g)}）：来自 ${listNames([...b.from].sort().map(name))}；如 ${first.from}:${first.line} → ${first.via}。改经入口导入，或把用到的符号提升到入口导出（U18）`,
      ...index.modules.get(g)?.src,
    })
  }
  for (const [g, byName] of [...hot].sort((x, y) => x[0].localeCompare(y[0])))
    for (const [n, users] of [...byName].sort((x, y) => x[0].localeCompare(y[0]))) {
      if (users.size < threshold) continue
      out.push({
        severity: 'info',
        code: 'surface.hot-undeclared',
        message: `模块「${name(g)}」入口导出的「${n}」被 ${users.size} 个模块使用（${listNames([...users].sort().map(name))}），没有声明为接口：建议在描述里声明接口（U19）`,
        ...index.modules.get(g)?.src,
      })
    }
  return out
}
