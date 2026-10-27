/**
 * 交互的承载链（ADR-0032 D）：每条交互的承载是结构图上由元素级结构边组成的一条路径，按交互方式有模板（K20），判定齐全 / 缺段 / 无承载（K5d），
 * 元素匹配不上而模块依赖在时回退到 K5 的模块级；通道没写契约模块时为外部承载（M21）。另给交互束按接收方表面散开的数据（D7）与束内修饰不一致（D8），
 * 以及束的把手（ADR-0033，L23b）与表面元素所属的子模块（L20b）。
 * 只读代码事实、归属与描述；页面、lint 与 agent 共用。
 */
import { moduleName } from '../names'
import type { SourceOwnership } from '../source'
import { parseVia, type ModelIndex, type RelationEntity, type RelationType } from '../types'
import { contractNames, judgeable, portOwner, related } from './facts'
import { elementSlots, gateModule, slotKey, surfaceContext, type SurfaceContext } from './surface'
import {
  CARRIER_ROLE_TEXT,
  CARRIER_TEMPLATE_LABELS,
  type Carrier,
  type CarrierRole,
  type CarrierSegment,
  type CarrierTemplate,
  type CarrierVerdict,
  type ElementEdge,
  type GovernanceReport,
  type InteractionBundle,
  type ModuleSurface,
  type SurfaceElement,
  type SurfaceSource,
} from './types'

type ReportPart = Pick<GovernanceReport, 'moduleDeps' | 'implementers' | 'relations'>

/**
 * K20：模块级的元素级边——每条模块依赖的文件依赖按 gateModule 定的表面接到元素（同 levelDeps 的口径，两端为模块）；
 * 没有表面所属的模块（路径上都没有入口）时接到模块本体。顺序同模块依赖、文件依赖。
 */
export function moduleElementEdges(index: ModelIndex, report: Pick<GovernanceReport, 'moduleDeps' | 'implementers'>, src: SurfaceSource, ctx?: SurfaceContext): ElementEdge[] {
  const c = ctx ?? surfaceContext(index, src, report)
  const out: ElementEdge[] = []
  for (const d of report.moduleDeps.values()) {
    const g = gateModule(index, src, d)
    const ports = contractNames(index, d.to)
    const slots = elementSlots(index, g ? { src, ctx: c } : null, g, d.files.map(f => ({ f, ports })))
    for (const x of slots)
      out.push({
        id: `el:${d.key}:${x.form}:${slotKey(x)}`,
        bundle: `bundle:${d.key}`,
        from: d.from,
        to: d.to,
        fromModule: d.from,
        toModule: d.to,
        element: x.element,
        ...(x.bypass ? { bypass: true as const } : {}),
        form: x.form,
        tier: x.tier,
        files: x.files,
      })
  }
  return out
}

/** 接口名去掉括号与泛型（同 G12） */
const bareName = (name: string) => name.replace(/[(<].*$/s, '').trim()

/** K20：关系的模板；端口 / 总线未指明（M20）与不合四形态的为 null（不判定） */
export function carrierTemplate(r: Pick<RelationEntity, 'type' | 'via'>): CarrierTemplate | null {
  if (r.via !== undefined) {
    const v = parseVia(r.via)
    if (!v?.target) return null
    return v.kind
  }
  return r.type === 'notifies' ? 'callback' : 'direct'
}

/**
 * K5d、K20：一条交互的承载——按模板在模块级的元素级边里找各段：
 * 直接：发起方 → 接收方的操作元素（写了接口时须是它；streams 不论方向，同 K5）；回调注册：接收方 → 发起方的注册操作（没有时发起方直接调接收方也算）；
 * 经端口 port:<P>：发起方 → P 的定义模块的端口元素、接收方实现 P（端口实现形态）、有模块组装接收方（to 写的是定义模块时只看第一段）；
 * 经总线 bus:<B>：发起方 → B 的发布操作、接收方 → B 的订阅操作（事件类型可选，不核）；经通道：两端各自依赖契约模块（M21，没写契约为外部承载）。
 * 判定：各段都接到元素为齐全；都在而有的只在模块级（边接到模块本体或别的元素）为「已证实（模块级）」（K5 回退）；缺一部分为缺段；全缺为无承载。
 * 两端在同一组文件里、一端是参与者或目标态、端口 / 总线未指明的不判定（null）。
 */
export function carrierOf(index: ModelIndex, report: ReportPart, edges: readonly ElementEdge[], r: RelationEntity): Carrier | null {
  if (!judgeable(index, r) || report.relations.get(r.id)?.host) return null
  const template = carrierTemplate(r)
  if (!template) return null
  const v = parseVia(r.via)
  const between = (x: string, y: string) => edges.filter(e => related(index, e.fromModule, x) && related(index, e.toModule, y))
  const isOp = (e: ElementEdge) => !!e.element && (e.element.kind === 'port' || (e.element.kind === 'operation' && e.tier !== 'type'))
  const named = (id: string | undefined) => {
    const x = id ? index.interfaces.get(id) : undefined
    return x ? (e: ElementEdge) => !!e.element && (e.element.interfaceId === id || e.element.name === bareName(x.name)) : isOp
  }
  const seg = (role: CarrierRole, from: string, to: string, want: (e: ElementEdge) => boolean, element?: string): CarrierSegment => {
    const base = { role, from, to, ...(element ? { element } : {}) }
    // 一端在另一端子树内（同一组代码）：这一段不需要边
    if (related(index, from, to)) return { ...base, edge: null }
    const cands = between(from, to)
    const hit = cands.find(want)
    if (hit) return { ...base, edge: hit }
    if (cands.length) return { ...base, edge: cands[0], moduleLevel: true }
    return { ...base, edge: null, missing: true }
  }
  const ifName = r.interface ? bareName(index.interfaces.get(r.interface)?.name ?? r.interface) : undefined
  const segments: CarrierSegment[] = []
  if (template === 'direct') {
    const fwd = seg('call', r.from, r.to, named(r.interface), ifName)
    const back = r.type === 'streams' && (fwd.missing || fwd.moduleLevel) ? seg('register', r.to, r.from, isOp) : null
    segments.push(back && !back.missing && !(back.moduleLevel && !fwd.missing) ? back : fwd)
  } else if (template === 'callback') {
    const reg = seg('register', r.to, r.from, isOp)
    const call = reg.missing || reg.moduleLevel ? seg('call', r.from, r.to, named(r.interface), ifName) : null
    segments.push(call && !call.missing && !(call.moduleLevel && !reg.missing) ? call : reg)
  } else if (template === 'port') {
    const port = v!.target!
    const owner = portOwner(index, port)
    const pname = bareName(index.interfaces.get(port)?.name ?? port)
    if (!owner) return null
    segments.push(seg('use-port', r.from, owner, e => !!e.element && (e.element.interfaceId === port || e.element.name === pname), pname))
    if (!related(index, r.to, owner)) {
      segments.push(seg('implement', r.to, owner, e => e.form === 'implements' && (!e.element || e.element.name === pname || e.element.interfaceId === port), pname))
      const asm = edges.filter(e => related(index, e.toModule, r.to) && !related(index, e.fromModule, r.to) && e.form === 'assembly')
      const hit = asm.find(e => e.element) ?? asm[0]
      segments.push(hit ? { role: 'assemble', from: hit.fromModule, to: r.to, edge: hit, ...(hit.element ? {} : { moduleLevel: true as const }) } : { role: 'assemble', from: '*', to: r.to, edge: null, missing: true })
    }
  } else if (template === 'bus') {
    const bus = v!.target!
    segments.push(seg('publish', r.from, bus, isOp), seg('subscribe', r.to, bus, isOp))
  } else {
    if (!v?.contract) return { relation: r.id, template, segments: [], verdict: 'external' }
    const any = (e: ElementEdge) => !!e.element
    segments.push(seg('contract-from', r.from, v.contract, any), seg('contract-to', r.to, v.contract, any))
  }
  const missing = segments.filter(s => s.missing).length
  const verdict: CarrierVerdict =
    missing === segments.length ? 'none' : missing ? 'partial' : segments.some(s => s.moduleLevel) ? 'module-level' : 'complete'
  return { relation: r.id, template, segments, verdict }
}

/** K5d：全部交互的承载（不判定的不在其中），按描述顺序 */
export function carriersOf(index: ModelIndex, report: ReportPart, src: SurfaceSource, ctx?: SurfaceContext): Map<string, Carrier> {
  const edges = moduleElementEdges(index, report, src, ctx)
  const out = new Map<string, Carrier>()
  for (const r of [...index.relations.values()].sort((a, b) => a.seq - b.seq)) {
    const c = carrierOf(index, report, edges, r)
    if (c) out.set(r.id, c)
  }
  return out
}

/** D6：缺段的说明（追加在 fact.unconfirmed 等消息之后）；没有缺段为空串 */
export function carrierGap(index: ModelIndex, c: Carrier | null | undefined): string {
  if (!c) return ''
  const miss = c.segments.filter(s => s.missing)
  if (!miss.length) return ''
  const name = (id: string) => (id === '*' ? '某模块' : moduleName(index, id))
  return `；承载（${CARRIER_TEMPLATE_LABELS[c.template]}）缺 ${miss.map(s => CARRIER_ROLE_TEXT[s.role](name(s.from), name(s.to))).join('、')}`
}

/** K5d、D6：carrier.gap 的说明——外部承载，或无承载 / 缺段与缺的段 */
export function carrierNote(index: ModelIndex, c: Carrier): string {
  const t = CARRIER_TEMPLATE_LABELS[c.template]
  if (c.verdict === 'external') return `承载（${t}）为外部承载：通道没写契约模块（channel:<名>@<模块 ID>），静态导入核不了`
  const name = (id: string) => (id === '*' ? '某模块' : moduleName(index, id))
  const miss = c.segments.filter(s => s.missing).map(s => CARRIER_ROLE_TEXT[s.role](name(s.from), name(s.to)))
  return `承载（${t}）${c.verdict === 'none' ? '无承载' : '缺段'}${miss.length ? `：缺 ${miss.join('、')}` : ''}`
}

// ── D7、D8：交互束按接收方表面散开 ──

/** D7、D8：交互束的散开——receiver 为接收方节点模块的表面（结构视角展开它时给出；没有时一律接到模块本体） */
export function interactionBundle(index: ModelIndex, receiver: ModuleSurface | null, relationIds: readonly string[]): InteractionBundle {
  const rs = relationIds.flatMap(id => (index.relations.has(id) ? [index.relations.get(id)!] : []))
  const items = rs.map(r => ({ relation: r.id, element: (r.interface && receiver?.elements.find(e => e.interfaceId === r.interface)) || null }))
  const modes = new Set(rs.filter(r => r.type !== 'notifies' && r.type !== 'streams').map(r => r.mode ?? 'sync'))
  const vias = new Set(rs.map(r => r.via ?? ''))
  const mixed = { ...(modes.size > 1 ? { mode: true as const } : {}), ...(vias.size > 1 ? { via: true as const } : {}) }
  return { items, ...(mixed.mode || mixed.via ? { mixed } : {}), unnamed: rs.filter(r => !r.interface).length }
}

// ── 把手（ADR-0033）：一条交互束落在接收方表面的哪几处、各属接收方的哪个子模块 ──
//   L23b：束内关系的 `interface` 去重后、属于接收方表面（K18：接口 owner 在接收方子树内或接收方 provides）的个数为把手数 M；没写接口的不计；
//         各条按所属子模块（接口 owner 在接收方之下的那一级；owner 即接收方、或接口不在接收方表面上的为「本体」）分组，组按条数降序。
//   L20b：展开节点的元素按所属子模块分组——元素的 owner 为匹配的接口 owner，否则为声明文件的归属模块（G3）。
// 只读描述（与文件归属），不要代码事实：分层总览与普通层次同一口径。

/** 接口的所属模块：写了 owner 取 owner，否则取 provides 它的第一个模块 */
export function interfaceOwner(index: ModelIndex, interfaceId: string): string | null {
  const x = index.interfaces.get(interfaceId)
  if (!x) return null
  if (x.owner && index.modules.has(x.owner)) return x.owner
  for (const m of index.modules.values()) if (m.provides?.includes(interfaceId)) return m.id
  return null
}

/** owner 在 receiver 之下的那一级子模块；owner 即 receiver、不在 receiver 子树内或未知时为 null（本体） */
export function subUnder(index: ModelIndex, receiver: string, owner: string | null | undefined): string | null {
  if (!owner || owner === receiver) return null
  const path = index.pathOf.get(owner) ?? []
  const i = path.indexOf(receiver)
  return i >= 0 && i + 1 < path.length ? path[i + 1] : null
}

/** L20b：表面元素的所属模块——匹配的接口 owner，否则为声明文件的归属模块（冲突时取第一个）；都没有为 null */
export function elementOwner(index: ModelIndex, own: Pick<SourceOwnership, 'owners'> | null | undefined, el: SurfaceElement): string | null {
  if (el.interfaceId) {
    const o = interfaceOwner(index, el.interfaceId)
    if (o) return o
  }
  return (el.file && own?.owners.get(el.file)?.[0]) || null
}

/** L20b：表面元素在接收方之下所属的子模块；本体为 null */
export const elementSub = (index: ModelIndex, own: Pick<SourceOwnership, 'owners'> | null | undefined, receiver: string, el: SurfaceElement): string | null =>
  subUnder(index, receiver, elementOwner(index, own, el))

/** L23b：束内一条交互落在哪个把手 */
export interface HandleItem {
  relation: string
  /** 关系写的接口；没写为 null */
  interface: string | null
  /** 接口名（没写接口为 null） */
  name: string | null
  /** 接口 owner 在接收方之下的那一级子模块；本体为 null */
  sub: string | null
  /** 接口是接收方表面上的元素（计入把手数） */
  handle: boolean
  type: RelationType
}

export interface HandleGroup {
  /** 子模块 ID；本体为 null */
  sub: string | null
  items: HandleItem[]
}

/** L23b：一条交互束的把手 */
export interface BundleHandles {
  /** 束内关系条数 N */
  relations: number
  /** 把手数 M：接收方表面上不同接口的个数（没写接口的不计） */
  handles: number
  /** 按所属子模块分组，组按条数降序（同数时本体在后、再按子模块在父模块下的声明顺序） */
  groups: HandleGroup[]
}

/** L23b：receiver 为接收方节点对应的模块（分层总览提升到层的为层模块） */
export function bundleHandles(index: ModelIndex, receiver: string, relationIds: readonly string[]): BundleHandles {
  const provided = new Set(index.modules.get(receiver)?.provides ?? [])
  const items: HandleItem[] = []
  for (const id of relationIds) {
    const r = index.relations.get(id)
    if (!r) continue
    const iface = r.interface && index.interfaces.has(r.interface) ? r.interface : null
    const owner = iface ? interfaceOwner(index, iface) : null
    const inSurface = !!iface && (provided.has(iface) || (!!owner && (index.pathOf.get(owner) ?? []).includes(receiver)))
    items.push({
      relation: id,
      interface: r.interface ?? null,
      name: iface ? index.interfaces.get(iface)!.name : (r.interface ?? null),
      sub: inSurface ? subUnder(index, receiver, owner) : null,
      handle: inSurface,
      type: r.type,
    })
  }
  const order = index.childrenOf.get(receiver) ?? []
  const groups = new Map<string | null, HandleItem[]>()
  for (const it of items) (groups.get(it.sub) ?? groups.set(it.sub, []).get(it.sub)!).push(it)
  const rank = (s: string | null) => (s === null ? Infinity : order.indexOf(s) < 0 ? order.length : order.indexOf(s))
  return {
    relations: items.length,
    handles: new Set(items.filter(x => x.handle).map(x => x.interface)).size,
    groups: [...groups].map(([sub, list]) => ({ sub, items: list })).sort((a, b) => b.items.length - a.items.length || rank(a.sub) - rank(b.sub)),
  }
}
