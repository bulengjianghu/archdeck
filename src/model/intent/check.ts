/**
 * 草图核验与两个对比（X2、X4、X17，ADR-0023、ADR-0025）。纯函数：输入草图定义与模型索引，页面、lint:model、命令行与 agent 接口同一份结果。
 *
 * - compareSketch(草图, 对象, 口径)：两个对比共用的一个函数——按挂载点取对象版本的同一范围（X9），按血缘（X11、X12）把差别读作
 *   新增 / 修改 / 合并 / 拆分 / 改 ID / 移动 / 删除；相对基线（baseline）比结构与写了的文字，相对当前版本（current）只比结构（X17）。
 * - sketchCheck(草图, 版本)：相对当前版本的偏差（实现还差什么）——由 compareSketch 的结果加上封闭子树、关系与接口的对应、
 *   与持久草图的矛盾得出 error / warning，带稳定键；归档门槛（X3）。
 */
import { load } from '../load'
import { ROOT_MOUNT, type ChangeKind, type ModelIndex, type ModuleDef, type ModuleEntity, type RawFile, type SketchEntity, type SketchLifetime, type SourceLoc } from '../types'
import { CHANGE_KINDS } from '../types'
import { locateAll, shortName } from './edit/locate'
import { isMergeResult, lineagePhrase, lineageSources, mapId, prefixMap, sketchLineage, unmapId, type Lineage } from './lineage'
import { looksLocal, mountScope, type MountScope } from './scope'
import type { AcceptedDeviation, SketchCheck, SketchDeviation, SketchDeviationCode, SketchSet } from './types'

/** 草图里的一个模块：父模块（undefined = 根）、写了的字段 */
export interface FlatSketchModule {
  id: string
  parentId?: string
  def: Omit<ModuleDef, 'children' | 'parent'>
  /** 草图写了的字段（没写的不约束，X2） */
  written: ReadonlySet<string>
  src?: SourceLoc
}

/** 草图定义展开为模块清单（父模块由 mount 或嵌套位置推出，根挂载的层为根）；寻址与草图编辑同一套（locateAll） */
export function flattenSketch(sketch: SketchEntity): FlatSketchModule[] {
  return locateAll(sketch.def).map(m => {
    const { children: _children, parent: _parent, from: _from, ...def } = m.node
    const written = new Set(Object.keys(def).filter(k => k !== 'id' && def[k as keyof typeof def] !== undefined))
    return { id: m.id, parentId: m.parentId, def, written, src: { file: sketch.file, path: m.path } }
  })
}

/** X3：生命周期——intent/ 下缺省 persistent，设计的草图缺省 until-implemented */
export const sketchLifetime = (s: SketchEntity): SketchLifetime => s.def.lifetime ?? (/(^|\/)intent\//.test(s.file) ? 'persistent' : 'until-implemented')

const sameSet = (a: readonly string[] | undefined, b: readonly string[] | undefined) => [...(a ?? [])].sort().join('\0') === [...(b ?? [])].sort().join('\0')
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

const deviation = (code: SketchDeviationCode, severity: 'error' | 'warning', entity: string, message: string, extra: Partial<SketchDeviation> = {}): SketchDeviation => ({
  key: `${code.slice('sketch.'.length)}:${entity}`,
  code,
  severity,
  rules: ['X4'],
  message,
  target: {},
  ...extra,
})

/**
 * X4、X10：草图与持久草图的矛盾——字段按内外归属不重叠，所以只比同挂载点：同一挂载点已有持久草图、本草图没有声明 supersedes 它即矛盾；
 * 不同挂载点互不比对。草图自己跳过。核验（error）与草图校验（warning，X14）共用这一份，稳定键 contradiction:<挂载点>。
 */
export function sketchContradictions(sketch: SketchEntity, persistent: readonly SketchEntity[]): SketchDeviation[] {
  const out: SketchDeviation[] = []
  for (const p of persistent) {
    if (p.def.id === sketch.def.id || p.file === sketch.file || sketch.def.supersedes === p.def.id || p.def.mount !== sketch.def.mount) continue
    out.push(
      deviation(
        'sketch.contradiction',
        'error',
        sketch.def.mount,
        `与持久草图「${p.def.id}」挂在同一挂载点「${sketch.def.mount}」：设计的草图要声明 supersedes: ${p.def.id}（X4、X10）`,
        { rules: ['X3', 'X4', 'X10'], target: sketch.def.mount === ROOT_MOUNT ? {} : { modules: [sketch.def.mount] }, at: { file: sketch.file, path: 'sketch.mount' } },
      ),
    )
  }
  return out
}

// ── 两个对比（X17）──

export type CompareMode = 'baseline' | 'current'

/** 一条按血缘表述的变更（X11、X17） */
export interface SketchChange {
  kind: ChangeKind
  entity: 'module' | 'relation' | 'interface'
  /** 草图里的 ID；拆分、删除为对象版本里的 ID */
  id: string
  name: string
  /** 合并 / 改 ID / 移动的基线来源 */
  from?: string[]
  /** 拆分的结果 */
  to?: string[]
  /** 修改了的字段 */
  fields?: string[]
  /** 摘要措辞：「合并 A、B 为 N」 */
  message: string
  at?: SourceLoc
}

export interface SketchComparison {
  sketch: string
  mount: string
  design?: string
  mode: CompareMode
  changes: SketchChange[]
  /** 新增 / 修改 / 合并 / 拆分 / 改 ID / 移动 / 删除 各几处 */
  counts: Record<ChangeKind, number>
  /** 被血缘吸收、不另列的模块（前缀级联的改 ID、合并结果下的移动、合并 / 降级带走的来源） */
  absorbed: string[]
  /** X16：待重连的关系 */
  pending: string[]
}

export interface CompareOptions {
  mode: CompareMode
  /** 设计的全部草图的血缘（缺省为本草图自己的） */
  lineage?: Lineage
  /** 设计里其他草图的模块名称（措辞用；缺省只看本草图与对象版本） */
  names?: ReadonlyMap<string, string>
}

const TEXT_FIELDS = ['name', 'responsibility', 'abstraction', 'includes', 'excludes', 'principle', 'codeRefs', 'docRefs', 'adrs', 'entry', 'owner', 'tags', 'status'] as const

/** 写了的字段与对象版本的差别：结构（kind、core、mayDependOn）两种口径都比；文字只在相对基线时比（X17） */
function moduleFields(k: ModuleDef, t: ModuleEntity, mode: CompareMode): string[] {
  const out: string[] = []
  if (k.kind !== undefined && k.kind !== t.kind) out.push('kind')
  if (!!k.core !== !!t.core) out.push('core')
  if (k.mayDependOn !== undefined && !sameSet(k.mayDependOn, t.mayDependOn)) out.push('mayDependOn')
  if (mode === 'baseline') for (const f of TEXT_FIELDS) if (k[f] !== undefined && !same(k[f], t[f])) out.push(f)
  return out
}

/** 对象版本里与挂载点对应的那一层：相对基线时按血缘找到挂载点在基线里的对应（合并结果没有对应） */
function targetMount(mount: string, index: ModelIndex, lineage: Lineage, mode: CompareMode): string | null {
  if (mount === ROOT_MOUNT || index.modules.has(mount) || mode === 'current') return mount
  if (isMergeResult(lineage, mount)) return null
  const from = lineage.get(mount)
  const origin = from?.length === 1 ? from[0] : unmapId(prefixMap(lineage), mount)
  return origin !== mount && index.modules.has(origin) ? origin : null
}

/** X17：一张草图相对对象版本（基线或当前版本）的变更，按挂载点取同一范围、按血缘表述 */
export function compareSketch(sketch: SketchEntity, target: ModelIndex, opts: CompareOptions): SketchComparison {
  const def = sketch.def
  const mode = opts.mode
  const lineage: Lineage = opts.lineage ?? sketchLineage([def])
  const map = prefixMap(lineage)
  const sources = lineageSources(lineage)
  const tm = targetMount(def.mount, target, lineage, mode)
  const scope: MountScope = tm ? mountScope(target, tm) : { mount: def.mount, modules: [], parentOf: new Map(), relations: [], interfaces: [], within: () => false }
  const own = locateAll(def)
  const ownIds = new Set(own.map(m => m.id))
  const name = (id: string) => own.find(m => m.id === id)?.node.name ?? opts.names?.get(id) ?? target.modules.get(id)?.name ?? id
  const changes: SketchChange[] = []
  const absorbed: string[] = []
  const at = (path: string): SourceLoc => ({ file: sketch.file, path })
  const parentOf = (id: string | undefined) => id ?? target.rootId
  /** 设计里的父 ≙ 对象版本里的父（按前缀映射） */
  const sameParent = (srcParent: string | undefined, parent: string) => srcParent !== undefined && (srcParent === parent || mapId(map, srcParent) === parent)

  // ── 模块 ──
  const splits = new Map<string, string[]>()
  for (const m of own) {
    const parent = parentOf(m.parentId)
    const actual = target.modules.get(m.id)
    if (actual) {
      const fields = moduleFields(m.node, actual, mode)
      if (actual.parentId !== parent) fields.unshift('parent')
      if (fields.length) changes.push({ kind: 'changed', entity: 'module', id: m.id, name: name(m.id), fields, message: `${lineagePhrase('changed', m.id, { name })}：${fields.join('、')}`, at: at(m.path) })
      continue
    }
    const from = (m.node.from ?? []).filter(src => mode === 'current' || target.modules.has(src))
    if (!from.length) {
      const origin = unmapId(map, m.id)
      if (mode === 'baseline' && origin !== m.id && target.modules.has(origin)) {
        absorbed.push(m.id)
        const fields = moduleFields(m.node, target.modules.get(origin)!, mode).filter(f => f !== 'name' || m.node.name !== target.modules.get(origin)!.name)
        if (fields.length) changes.push({ kind: 'changed', entity: 'module', id: m.id, name: name(m.id), fields, message: `${lineagePhrase('changed', m.id, { name })}：${fields.join('、')}`, at: at(m.path) })
        continue
      }
      changes.push({ kind: 'added', entity: 'module', id: m.id, name: name(m.id), message: lineagePhrase('added', m.id, { name }), at: at(m.path) })
      continue
    }
    if (from.length >= 2) {
      changes.push({ kind: 'merged', entity: 'module', id: m.id, name: name(m.id), from, message: lineagePhrase('merged', m.id, { from, name }), at: at(m.path) })
      continue
    }
    const src = from[0]
    const shared = [...lineage].filter(([x, f]) => f.length === 1 && f[0] === src && !target.modules.has(x)).length
    if (shared >= 2 && !ownIds.has(src)) {
      splits.set(src, [...(splits.get(src) ?? []), m.id])
      continue
    }
    const srcParent = target.modules.get(src)?.parentId ?? (src.includes('.') ? src.slice(0, src.lastIndexOf('.')) : target.rootId)
    const cascaded = shortName(src) === shortName(m.id) && srcParent !== parent && sameParent(srcParent, parent)
    // X12：前缀级联的改 ID、合并结果下的移动被吸收，不另列（只在相对基线时；相对当前版本缺了就是偏差）
    if (mode === 'baseline' && (cascaded || (m.parentId && isMergeResult(lineage, m.parentId)))) {
      absorbed.push(m.id)
      continue
    }
    const kind = sameParent(srcParent, parent) ? 'renamed' : 'moved'
    changes.push({ kind, entity: 'module', id: m.id, name: name(m.id), from, message: lineagePhrase(kind, m.id, { from, parent: m.parentId, name }), at: at(m.path) })
  }
  for (const [src, to] of splits)
    changes.push({ kind: 'split', entity: 'module', id: src, name: target.modules.get(src)?.name ?? src, to, message: lineagePhrase('split', src, { to, name }) })
  for (const x of scope.modules) {
    if (ownIds.has(x) || splits.has(x)) continue
    if (sources.has(x) || ownIds.has(mapId(map, x))) {
      absorbed.push(x)
      continue
    }
    if (mode === 'baseline') changes.push({ kind: 'removed', entity: 'module', id: x, name: target.modules.get(x)!.name, message: lineagePhrase('removed', x, { name }) })
  }

  // ── 关系 ──
  const pendingEnd = (e: string) => !ownIds.has(e) && (sources.has(e) || (def.mount !== ROOT_MOUNT && looksLocal(def.mount, e, new Set())))
  const lineageOnly = (before: string, after: string) => {
    if (before === after) return true
    const mapped = mapId(map, before)
    return mapped === after || mapped.startsWith(`${after}.`) || (lineage.get(after)?.includes(before) ?? false)
  }
  const pending: string[] = []
  const rels = def.relations ?? []
  rels.forEach((r, i) => {
    if ([r.from, r.to].some(pendingEnd)) {
      pending.push(r.id)
      return
    }
    if (mode === 'current') return
    const prev = target.relations.get(r.id)
    if (!prev) {
      const dup = scope.relations.some(id => {
        const x = target.relations.get(id)!
        return x.type === r.type && lineageOnly(x.from, r.from) && lineageOnly(x.to, r.to) && !rels.some(y => y.id === id)
      })
      if (!dup) changes.push({ kind: 'added', entity: 'relation', id: r.id, name: `${name(r.from)} → ${name(r.to)}`, message: `新增关系 ${name(r.from)} → ${name(r.to)}（${r.type}）`, at: at(`sketch.relations.${i}`) })
      return
    }
    const fields: string[] = []
    if (!lineageOnly(prev.from, r.from)) fields.push('from')
    if (!lineageOnly(prev.to, r.to)) fields.push('to')
    if (prev.type !== r.type) fields.push('type')
    for (const f of ['description', 'interface', 'via', 'mode'] as const) if (r[f] !== undefined && !same(r[f], prev[f])) fields.push(f)
    if (fields.length)
      changes.push({ kind: 'changed', entity: 'relation', id: r.id, name: `${name(r.from)} → ${name(r.to)}`, fields, message: `修改关系 ${name(r.from)} → ${name(r.to)}：${fields.join('、')}`, at: at(`sketch.relations.${i}`) })
  })
  if (mode === 'baseline')
    for (const id of scope.relations) {
      if (rels.some(r => r.id === id)) continue
      const x = target.relations.get(id)!
      const moved = [x.from, x.to].some(e => sources.has(e) || mapId(map, e) !== e)
      const kept = rels.some(r => r.type === x.type && lineageOnly(x.from, r.from) && lineageOnly(x.to, r.to))
      const [m1, m2] = [mapId(map, x.from), mapId(map, x.to)]
      const inward = m1 === m2 || m1.startsWith(`${m2}.`) || m2.startsWith(`${m1}.`)
      if (moved && (kept || inward || [x.from, x.to].every(e => sources.has(e) || mapId(map, e) !== e))) continue
      changes.push({ kind: 'removed', entity: 'relation', id, name: `${name(x.from)} → ${name(x.to)}`, message: `删除关系 ${name(x.from)} → ${name(x.to)}（${x.type}）` })
    }

  // ── 接口（写了才比）与父模块原则 ──
  if (mode === 'baseline') {
    def.interfaces?.forEach((x, i) => {
      const prev = target.interfaces.get(x.id)
      if (!prev) {
        changes.push({ kind: 'added', entity: 'interface', id: x.id, name: x.name, message: `新增接口 ${x.name}`, at: at(`sketch.interfaces.${i}`) })
        return
      }
      const fields: string[] = []
      if (x.owner !== undefined && prev.owner && !lineageOnly(prev.owner, x.owner)) fields.push('owner')
      for (const f of ['name', 'signature', 'description', 'semantics'] as const) if (x[f] !== undefined && !same(x[f], prev[f])) fields.push(f)
      if (fields.length) changes.push({ kind: 'changed', entity: 'interface', id: x.id, name: x.name, fields, message: `修改接口 ${x.name}：${fields.join('、')}`, at: at(`sketch.interfaces.${i}`) })
    })
    const host = tm && tm !== ROOT_MOUNT ? target.modules.get(tm) : undefined
    if (def.abstraction !== undefined && def.mount !== ROOT_MOUNT && (!host || !same(def.abstraction.trim(), host.abstraction?.trim())))
      changes.push({ kind: 'changed', entity: 'module', id: def.mount, name: name(def.mount), fields: ['abstraction'], message: `修改 ${name(def.mount)} 的原则`, at: at('sketch.abstraction') })
  }

  changes.sort((a, b) => CHANGE_KINDS.indexOf(a.kind) - CHANGE_KINDS.indexOf(b.kind))
  const counts = Object.fromEntries(CHANGE_KINDS.map(k => [k, changes.filter(c => c.kind === k).length])) as Record<ChangeKind, number>
  return { sketch: def.id, mount: def.mount, ...(sketch.design ? { design: sketch.design } : {}), mode, changes, counts, absorbed, pending }
}

/** X17：一个设计的全部草图对同一对象的对比（全设计 = 各张的并集，血缘按全设计算） */
export function compareDesign(sketches: readonly SketchEntity[], target: ModelIndex, mode: CompareMode): { sketches: SketchComparison[]; counts: Record<ChangeKind, number>; pending: number } {
  const lineage = sketchLineage(sketches.map(s => s.def))
  const names = new Map(sketches.flatMap(s => locateAll(s.def).map(m => [m.id, m.node.name] as const)))
  const each = sketches.map(s => compareSketch(s, target, { mode, lineage, names }))
  const counts = Object.fromEntries(CHANGE_KINDS.map(k => [k, each.reduce((n, c) => n + c.counts[k], 0)])) as Record<ChangeKind, number>
  return { sketches: each, counts, pending: each.reduce((n, c) => n + c.pending.length, 0) }
}

/** 变更摘要（交给 AI、命令行）：按血缘措辞，一行一条 */
export function changeSummary(comparisons: readonly SketchComparison[]): string {
  return comparisons
    .flatMap(c => [
      ...c.changes.map(x => `- ${x.message}`),
      ...c.pending.map(id => `- 待重连：关系「${id}」（${c.mount}）`),
    ])
    .join('\n')
}

// ── 相对当前版本的偏差（X4）──

export interface SketchCheckOptions {
  /** 持久草图（矛盾检查用，X4）；草图自己与它 supersedes 的不算 */
  persistent?: readonly SketchEntity[]
  /** 认可的偏差（design.yaml 的 accepted，X4） */
  accepted?: readonly AcceptedDeviation[]
  /** 设计的全部草图（血缘与封闭的下一层）；缺省只有本张 */
  design?: readonly SketchEntity[]
  /** 设计的基线：给了时，基线里本层有、草图删掉了、版本里还在的也是偏差 */
  baseline?: ModelIndex | null
}

export function sketchCheck(sketch: SketchEntity, index: ModelIndex, opts: SketchCheckOptions = {}): SketchCheck {
  const deviations: SketchDeviation[] = sketchContradictions(sketch, opts.persistent ?? [])
  const push = (...a: Parameters<typeof deviation>) => deviations.push(deviation(...a))
  const def = sketch.def
  const design = opts.design ?? [sketch]
  const lineage = sketchLineage(design.map(s => s.def))
  const sources = lineageSources(lineage)
  const name = (id: string) => index.modules.get(id)?.name ?? locateAll(def).find(m => m.id === id)?.node.name ?? id
  const cmp = compareSketch(sketch, index, { mode: 'current', lineage })
  const own = locateAll(def)
  const ownIds = new Set(own.map(m => m.id))
  const rootId = index.rootId
  const at = (path?: string): SourceLoc | undefined => (path ? { file: sketch.file, path } : undefined)

  // ── 模块：存在（按血缘措辞）、父模块 / kind / core / mayDependOn ──
  for (const c of cmp.changes) {
    if (c.entity !== 'module') continue
    const m = own.find(x => x.id === c.id)
    if (c.kind === 'changed') {
      const actual = index.modules.get(c.id)!
      const detail = (c.fields ?? []).map(f =>
        f === 'parent'
          ? `父模块（草图 ${m?.parentId ?? rootId}，版本 ${actual.parentId}）`
          : f === 'mayDependOn'
            ? `mayDependOn（草图 [${(m?.node.mayDependOn ?? []).join(', ')}]，版本 [${(actual.mayDependOn ?? []).join(', ')}]）`
            : `${f}（草图 ${String((m?.node as Record<string, unknown> | undefined)?.[f] ?? (f === 'core' ? false : undefined))}，版本 ${String((actual as unknown as Record<string, unknown>)[f] ?? (f === 'core' ? false : undefined))}）`,
      )
      push('sketch.field', 'error', c.id, `「${name(c.id)}」与草图不一致：${detail.join('；')}`, { target: { modules: [c.id] }, at: c.at, detail: '写了才比：草图没写的字段不约束（X2）' })
      continue
    }
    if (c.kind === 'split') {
      for (const id of c.to ?? []) {
        const n = own.find(x => x.id === id)
        push('sketch.missing-module', 'error', id, `${c.message}尚未实现：版本里没有「${id}」（${n?.node.name ?? id}）`, { rules: ['X4', 'X5', 'X11'], target: { modules: [n?.parentId ?? rootId] }, at: at(n?.path) })
      }
      continue
    }
    const lineageNote = c.kind === 'added' ? '' : `（${c.message}）`
    push('sketch.missing-module', 'error', c.id, `草图的模块「${c.id}」（${m?.node.name ?? c.id}）在版本里不存在${lineageNote}：AI 必须沿用草图的 ID，重命名或移动只能经草图`, {
      rules: c.kind === 'added' ? ['X4', 'X5'] : ['X4', 'X5', 'X11'],
      target: { modules: [m?.parentId ?? rootId] },
      at: c.at,
    })
  }

  // ── 血缘的来源仍在原处、基线里有而草图删掉的仍在（X11、X17）──
  const scope = mountScope(index, def.mount)
  const map = prefixMap(lineage)
  const base = opts.baseline ? mountScope(opts.baseline, def.mount) : null
  for (const x of scope.modules) {
    if (ownIds.has(x)) continue
    if (sources.has(x) && !design.some(s => locateAll(s.def).some(m => m.id === x))) {
      const by = [...lineage].filter(([, f]) => f.includes(x)).map(([id]) => id)
      push('sketch.not-applied', 'error', x, `「${name(x)}」按血缘已${map.has(x) ? `成为「${map.get(x)}」` : `并入 ${by.join('、')}`}，版本里还在原处`, {
        rules: ['X4', 'X11', 'X12'],
        target: { modules: [x] },
      })
    } else if (base?.modules.includes(x) && !sources.has(x))
      push('sketch.not-removed', 'error', x, `「${name(x)}」在草图里删掉了，版本里还在`, { rules: ['X4', 'X17'], target: { modules: [x] } })
  }

  // ── 封闭子树（X2）：直接子模块集合必须相等（本层的看本张，本层模块的看挂在它上的草图）──
  const parentOf = (m: { parentId?: string }) => m.parentId ?? rootId
  for (const c of def.closed ?? []) {
    const node = c === def.mount ? def.mount : c
    if (!index.modules.has(node) && node !== rootId && node !== ROOT_MOUNT) continue
    const host = node === ROOT_MOUNT ? rootId : node
    const declared = new Set([
      ...own.filter(m => parentOf(m) === host).map(m => m.id),
      ...design.filter(s => s.def.mount === host).flatMap(s => locateAll(s.def).map(m => m.id)),
    ])
    for (const kid of index.childrenOf.get(host) ?? [])
      if (!declared.has(kid) && !sources.has(kid))
        push('sketch.extra-child', 'error', kid, `「${name(host)}」在草图里是封闭的子树，版本多出了直接子模块「${kid}」（${name(kid)}）`, {
          rules: ['X2', 'X4'],
          target: { modules: [kid, host] },
          at: at(own.find(m => m.id === host)?.path ?? 'sketch.closed'),
        })
  }

  // ── 关系：按两端 + 类型，版本里两端落在草图两端子树内的同类型关系也算对应；待重连的不比 ──
  const within = (id: string, anc: string) => id === anc || !!index.pathOf.get(id)?.includes(anc)
  def.relations?.forEach((r, i) => {
    if (cmp.pending.includes(r.id)) return
    const hit = [...index.relations.values()].some(x => x.type === r.type && within(x.from, r.from) && within(x.to, r.to))
    if (!hit)
      push('sketch.missing-relation', 'warning', r.id, `草图的关系「${r.id}」（${r.type}，${name(r.from)} → ${name(r.to)}）在版本里没有对应（含两端更深层之间的）`, {
        target: { relation: r.id, modules: [r.from, r.to].filter(id => index.modules.has(id)) },
        at: { file: sketch.file, path: `sketch.relations.${i}` },
      })
  })

  // ── 接口：存在、owner（写了才比）──
  def.interfaces?.forEach((x, i) => {
    const actual = index.interfaces.get(x.id)
    const loc = { file: sketch.file, path: `sketch.interfaces.${i}` }
    if (!actual) push('sketch.missing-interface', 'warning', x.id, `草图的接口「${x.id}」（${x.name}）在版本里不存在`, { target: { interface: x.id, ...(x.owner ? { modules: [x.owner] } : {}) }, at: loc })
    else if (x.owner !== undefined && actual.owner !== x.owner)
      push('sketch.interface-owner', 'warning', x.id, `接口「${x.id}」的提供方与草图不同：草图 ${x.owner}，版本 ${actual.owner ?? '（未写）'}`, { target: { interface: x.id, modules: [x.owner] }, at: loc })
  })

  // ── 认可的偏差（X4）：只有提醒能认可，降为 info ──
  const accepted = new Map((opts.accepted ?? []).map(a => [a.deviation, a]))
  for (const d of deviations) {
    const a = accepted.get(d.key)
    if (a && d.severity === 'warning') {
      d.severity = 'info'
      d.accepted = { reason: a.reason, ...(a.at ? { at: a.at } : {}) }
    }
  }
  const counts = { error: 0, warning: 0, info: 0 }
  for (const d of deviations) counts[d.severity]++
  return {
    sketch: def.id,
    mount: def.mount,
    ...(sketch.design ? { design: sketch.design } : {}),
    lifetime: sketchLifetime(sketch),
    ...(def.supersedes ? { supersedes: def.supersedes } : {}),
    deviations,
    counts,
    consistent: counts.error === 0 && counts.warning === 0,
  }
}

/** 载荷附带的设计草图（X4）：解析成草图实体，记所属设计 */
export function parseDesignSketches(files: readonly { design: string; file: RawFile }[]): SketchEntity[] {
  return files.flatMap(({ design, file }) => load([file]).model.sketches.map(s => ({ ...s, design })))
}

/** 按设计分组 */
export function byDesign(sketches: readonly SketchEntity[]): Map<string, SketchEntity[]> {
  const out = new Map<string, SketchEntity[]>()
  for (const s of sketches) if (s.design) out.set(s.design, [...(out.get(s.design) ?? []), s])
  return out
}

/**
 * 对一个版本有约束力的草图（X3、X4）：版本自带的持久草图 + 载荷附带的设计草图（逐张，血缘与封闭按所属设计的全部草图）；
 * 版本自带的非持久草图（草图版本里打开的那些）不算——它们自己就是尺子。返回每张的核验结果；accepted 按设计给出。
 */
export function checkSketches(
  index: ModelIndex,
  designSketches: readonly SketchEntity[],
  accepted: ReadonlyMap<string, readonly AcceptedDeviation[]> = new Map(),
  baselines: ReadonlyMap<string, ModelIndex | null> = new Map(),
): SketchCheck[] {
  const persistent = index.model.sketches.filter(s => sketchLifetime(s) === 'persistent')
  const out = persistent.map(s => sketchCheck(s, index, { persistent }))
  const groups = byDesign(designSketches)
  for (const s of designSketches)
    out.push(
      sketchCheck(s, index, {
        persistent,
        accepted: s.design ? accepted.get(s.design) : undefined,
        design: s.design ? groups.get(s.design) : [s],
        baseline: s.design ? baselines.get(s.design) : undefined,
      }),
    )
  return out
}

export type { SketchSet }
