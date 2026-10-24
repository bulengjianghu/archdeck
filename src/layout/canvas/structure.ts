/**
 * 画布场景的结构视角（ADR-0031）：结构边（依赖边）的显隐、走线与编码数据，节点的指标、影响面与环角标。
 * 节点位置全部取交互视角的布局结果（V12），结构边不参与布局（L15）：从起点节点边缘到终点节点边缘直连（directRoutes），
 * 不绕框、可压在其他节点下方；分层总览的带与带之间画竖直直线（bandDirectRoutes）。
 *   L15：只引类型的依赖边缺省收起（偏好 typeOnly），画布角计数；基线外违规的照画。边界节点的边只在聚焦其一端时画（同 L4）。
 *   O13：共用件与使用者之间的边缺省不画，聚焦任一端时画；反向依赖（U12）、违规（U15）、在环中（Y4）的照画；「共用 ×N」按依赖计。
 *   O13③：分层总览带间画层间依赖，带内不画；核心模块（与架上共用件）的跨层依赖只在聚焦它时画。
 *   K15：选中模块时影响面按方向（偏好 impactMode）投影到本层，节点标方向与距离，闭包外变淡（共享通道「聚焦变淡」）。
 *   L17：节点标「入 Ca · 出 Ce」与不稳定度三档；Y4：本层环编号常显（不受「代码事实」开关影响）。
 *   U16：没有代码事实时只画允许边（mayDependOn 的投影），画布角说明。
 */
import {
  contractNames,
  fileKinds,
  levelImpact,
  moduleName,
  nodeOf,
  shelfOf,
  tierOf,
  type AllowedEdge,
  type DepTier,
  type FileDep,
  type GovernanceReport,
  type LevelView,
  type ModelIndex,
  type StructureEdge,
  type StructureKind,
  type Violation,
  type ViolationStatus,
} from '@/model'
import { bandDirectRoutes, directRoutes, type EdgeRoute, type PositionedView } from '../layout'
import type { CanvasInput, DepEdgeKind, DepEdgeLook, DepViolation, NodeData } from './types'

/** L16：结构边种类的名称（悬停说明与图例） */
export const DEP_KIND_LABELS: Readonly<Record<DepEdgeKind, string>> = {
  dependency: '依赖',
  assembly: '组装',
  subclass: '子类',
  implements: '端口实现',
  allowed: '允许依赖',
}

/** K14：依赖档的名称 */
export const DEP_TIER_LABELS: Readonly<Record<DepTier, string>> = { invokes: '交互使用', value: '值使用', type: '只引类型' }

const VIOLATION_LABELS: Readonly<Record<ViolationStatus, string>> = { new: '新增', open: '无基线', known: '已知', allowed: '已豁免' }

/** U15：违规状态投到画布的三档红晕——新增与无基线为红晕、已知为淡红晕、已豁免为灰描边 */
export const violationLook = (status: ViolationStatus | undefined): DepViolation | undefined =>
  status === 'new' || status === 'open' ? 'new' : status === 'known' ? 'known' : status === 'allowed' ? 'allowed' : undefined

/** 线宽档（共享通道「聚合条数」，L18）：1 / 2–4 / ≥5 */
export const depWeight = (n: number): 1 | 2 | 3 => (n >= 5 ? 3 : n >= 2 ? 2 : 1)

/** 一条要画的结构边（候选）：两端视图节点与编码数据 */
export interface DepItem {
  id: string
  from: string
  to: string
  look: DepEdgeLook
  /** O13③：分层总览中核心模块（或架上共用件）的跨层依赖——只在聚焦一端时画，画成曲线 */
  chip?: boolean
}

export interface StructureScene {
  /** 有代码事实（结构边）还是只有允许依赖图（U16） */
  facts: boolean
  /** 本层的全部候选结构边（含收起的） */
  items: DepItem[]
  /** 画出来的结构边 */
  shown: DepItem[]
  /** 画出来的边的走线 */
  routes: Map<string, EdgeRoute>
  /** L15：收起的只引类型依赖边条数（基线外违规的照画，不计） */
  typeOnlyHidden: number
  /** 画布角的说明（U16 / 正在读取） */
  note: string | null
  /** K15：本层节点 → 方向与最短距离；没有选中模块时为 null */
  impact: Map<string, { direction: 'in' | 'out' | 'both'; distance: number; inCycle: boolean }> | null
  /** K15：选中的模块所在的节点 */
  impactSelf: string | null
  /** O13：使用者节点 → 它依赖的不同共用件数（含只引类型） */
  sharedCounts: Map<string, number>
  /** 聚焦（悬停或选中节点）时与它相连的节点；没有聚焦或影响面生效时为 null */
  near: Set<string> | null
  /** 选中的依赖（`sel=d:`）对应的结构边 */
  selected: Set<string>
}

const ruleText = (e: StructureEdge): string => {
  const r = e.ruling
  if (r.verdict === 'violation')
    return `违规（${VIOLATION_LABELS[r.status!]}）：${[...new Set(r.violations.map(v => v.reason))].slice(0, 3).join('；')}${r.violations.length > 3 ? ` 等 ${r.violations.length} 条` : ''}`
  if (r.verdict === 'allowed') return `允许：${r.allowedBy.map(b => b.text).join('；')}`
  return '无规则约束'
}

/** L15、L16：一条结构边（模型层 levelDeps）的编码数据与悬停说明 */
function structureItem(idx: ModelIndex | null, e: StructureEdge): DepItem {
  const name = (id: string) => (idx ? moduleName(idx, id) : id)
  const lines = [
    `${DEP_KIND_LABELS[e.kind]}${e.tier ? `（${DEP_TIER_LABELS[e.tier]}）` : ''}：${name(e.fromModule)} → ${name(e.toModule)}`,
    `模块依赖 ${e.deps.length} 条 · 文件依赖 ${e.files} 条`,
  ]
  if (e.coverage) {
    const c = e.coverage
    const facts = [c.implementers ? `端口实现 ${c.implementers}` : '', c.subclass ? `子类 ${c.subclass}` : '', c.assembly ? `组装 ${c.assembly}` : '']
      .filter(Boolean)
      .join('、')
    lines.push(`交互覆盖 ${c.relations.length} 条${facts ? `；事实覆盖：${facts}` : ''}`)
  }
  if (e.unexplained) lines.push('未解释：有调用而没有交互关系覆盖（K7）')
  lines.push(ruleText(e))
  if (e.againstStability) lines.push(`逆稳定（提示）：依赖方 I ${e.againstStability.from.toFixed(2)} 依赖更易变的 I ${e.againstStability.to.toFixed(2)}（U17）`)
  const violation = e.ruling.verdict === 'violation' ? violationLook(e.ruling.status) : undefined
  return {
    id: e.id,
    from: e.from,
    to: e.to,
    look: {
      kind: e.kind,
      ...(e.tier ? { tier: e.tier } : {}),
      fromModule: e.fromModule,
      toModule: e.toModule,
      deps: e.deps.length,
      files: e.files,
      ...(violation ? { violation } : {}),
      ...(e.unexplained ? { unexplained: true } : {}),
      ...(e.againstStability ? { against: e.againstStability } : {}),
      title: lines.join('\n'),
    },
  }
}

/** U16：允许边的编码数据——点线、不带档与记号 */
function allowedItem(idx: ModelIndex | null, e: AllowedEdge): DepItem {
  const name = (id: string) => (idx ? moduleName(idx, id) : id)
  const rule = (r: AllowedEdge['rules'][number]) =>
    r.kind === 'layer'
      ? `层规则：「${name(r.at)}」可依赖「${name(r.to)}」`
      : r.kind === 'deps'
        ? `依赖白名单：「${name(r.at)}」可依赖「${name(r.to)}」`
        : `草图：「${name(r.at)}」可依赖「${name(r.to)}」`
  return {
    id: e.id,
    from: e.from,
    to: e.to,
    look: {
      kind: 'allowed',
      fromModule: e.fromModule,
      toModule: e.toModule,
      deps: 1,
      title: [`允许依赖：${name(e.fromModule)} → ${name(e.toModule)}`, ...e.rules.map(rule), '没有代码事实：不知道实际依赖（U16）'].join('\n'),
    },
  }
}

/**
 * O13③：分层总览中核心模块（与架上共用件）的跨层依赖——模块依赖的一端落在给出的块（chips）的子树内时，
 * 这一端投到块、另一端投到它所在的块（没有时为带或边界节点）；两端同带的不画（带内）。一对节点同方向按种类各一条（同 K14）。
 */
export function chipDeps(idx: ModelIndex, view: LevelView, report: Pick<GovernanceReport, 'moduleDeps' | 'violations'>, chips: ReadonlySet<string>): DepItem[] {
  if (!chips.size) return []
  const present = new Set(view.nodes.map(n => n.id))
  const chipIds = new Set(view.nodes.filter(n => n.role === 'core' || n.role === 'shared').map(n => n.id))
  const layerOf = new Map(view.nodes.map(n => [n.id, n.layerId ?? n.id]))
  const chipOf = (m: string): string | null => {
    const p = idx.pathOf.get(m) ?? []
    for (let i = p.length - 1; i >= 0; i--) if (chipIds.has(p[i])) return p[i]
    return null
  }
  const project = (d: { from: string; to: string }): [string, string] | null => {
    const ca = chipOf(d.from)
    const cb = chipOf(d.to)
    if (!(ca && chips.has(ca)) && !(cb && chips.has(cb))) return null
    const a = ca ?? nodeOf(idx, view, present, d.from)
    const b = cb ?? nodeOf(idx, view, present, d.to)
    if (!a || !b || a === b || layerOf.get(a) === layerOf.get(b)) return null
    return [a, b]
  }
  interface Pair {
    from: string
    to: string
    byKind: Map<StructureKind, { files: FileDep[]; deps: Set<string> }>
    violations: Violation[]
  }
  const pairs = new Map<string, Pair>()
  for (const d of report.moduleDeps.values()) {
    const p = project(d)
    if (!p) continue
    const k = `${p[0]}->${p[1]}`
    const pair = pairs.get(k) ?? pairs.set(k, { from: p[0], to: p[1], byKind: new Map(), violations: [] }).get(k)!
    const ports = contractNames(idx, d.to)
    for (const f of d.files)
      for (const kind of fileKinds(f, ports)) {
        const slot = pair.byKind.get(kind) ?? pair.byKind.set(kind, { files: [], deps: new Set() }).get(kind)!
        slot.files.push(f)
        slot.deps.add(d.key)
      }
  }
  for (const v of report.violations) {
    const p = project(v)
    if (p) pairs.get(`${p[0]}->${p[1]}`)?.violations.push(v)
  }
  const moduleOf = (id: string) => view.nodes.find(n => n.id === id)?.moduleId ?? id
  const order: readonly ViolationStatus[] = ['new', 'open', 'known', 'allowed']
  const out: DepItem[] = []
  for (const p of pairs.values()) {
    const status = order.find(s => p.violations.some(v => v.status === s))
    const violation = violationLook(status)
    for (const [kind, slot] of [...p.byKind].sort((a, b) => a[0].localeCompare(b[0]))) {
      const tier = kind === 'dependency' ? tierOf(slot.files) : undefined
      const fromModule = moduleOf(p.from)
      const toModule = moduleOf(p.to)
      out.push({
        id: `chip:${kind}:${p.from}->${p.to}`,
        from: p.from,
        to: p.to,
        chip: true,
        look: {
          kind,
          ...(tier ? { tier } : {}),
          fromModule,
          toModule,
          deps: slot.deps.size,
          files: slot.files.length,
          ...(violation ? { violation } : {}),
          title: [
            `${DEP_KIND_LABELS[kind]}${tier ? `（${DEP_TIER_LABELS[tier]}）` : ''}：${moduleName(idx, fromModule)} → ${moduleName(idx, toModule)}`,
            `模块依赖 ${slot.deps.size} 条 · 文件依赖 ${slot.files.length} 条`,
            ...(status ? [`违规（${VIOLATION_LABELS[status]}）`] : []),
          ].join('\n'),
        },
      })
    }
  }
  return out
}

/** 结构视角的场景派生；结构视角之外不调用 */
export function structureScene(input: CanvasInput, pv: PositionedView, focusId: string | null): StructureScene {
  const s = input.structure!
  const idx = input.index
  const view = pv.view
  const layered = view.mode === 'layered'
  const sv = s.view
  const sel = input.selection
  const items: DepItem[] = !sv ? [] : sv.facts ? sv.edges.map(e => structureItem(idx, e)) : sv.edges.map(e => allowedItem(idx, e))

  // O13③：聚焦（或选中的依赖一端是）核心模块 / 架上共用件时，补它的跨层依赖
  if (layered && sv?.facts && idx && s.report) {
    const chipIds = new Set(view.nodes.filter(n => n.role === 'core' || n.role === 'shared').map(n => n.id))
    const wanted = new Set<string>()
    if (focusId && chipIds.has(focusId)) wanted.add(focusId)
    if (sel?.kind === 'dep') for (const id of sel.id.split('->')) if (chipIds.has(id)) wanted.add(id)
    items.push(...chipDeps(idx, view, s.report, wanted))
  }

  const shelf = shelfOf(view)
  const isBoundary = (id: string) => id.startsWith('boundary:')
  const touches = (e: DepItem) => !!focusId && (e.from === focusId || e.to === focusId)
  const selected = new Set(sel?.kind === 'dep' ? items.filter(e => `${e.look.fromModule}->${e.look.toModule}` === sel.id).map(e => e.id) : [])
  const cyc = s.cycles
  const inCycle = (e: DepItem) => !!cyc && cyc.get(e.from) !== undefined && cyc.get(e.from) === cyc.get(e.to)
  let typeOnlyHidden = 0
  const shown = items.filter(e => {
    if (selected.has(e.id)) return true
    // 异常不折叠：基线外的违规（新增或无基线）照画，同 K9 只画基线外的违规；已知与已豁免的跟着边本身的显隐
    const anomaly = e.look.violation === 'new'
    if (e.look.kind === 'dependency' && e.look.tier === 'type' && !s.typeOnly && !anomaly) {
      if (!e.chip) typeOnlyHidden++
      return false
    }
    if (e.chip) return true
    // 同 L4：边界节点的边只在聚焦其一端时画（基线外违规照画）；两端都是边界节点的（本层之外的依赖）只在聚焦时画
    if (isBoundary(e.from) && isBoundary(e.to)) return touches(e)
    if (isBoundary(e.from) || isBoundary(e.to)) return touches(e) || anomaly
    // O13②：共用件——聚焦一端、违规、在环中、反向依赖（共用件依赖使用者，U12）照画
    if (shelf.has(e.from) || shelf.has(e.to)) return touches(e) || anomaly || inCycle(e) || (shelf.has(e.from) && !shelf.has(e.to))
    return true
  })

  // 走线（L15，直连）：从起点节点边缘到终点节点边缘画直线，不绕框；同一对节点的各条平行错开；分层总览带与带之间画竖直直线
  const routes = new Map<string, EdgeRoute>()
  if (layered) {
    const bands = new Set((view.bands ?? []).map(b => b.layerId))
    const bandLinks = shown.filter(e => !e.chip && bands.has(e.from) && bands.has(e.to))
    for (const [id, r] of bandDirectRoutes(pv, bandLinks)) routes.set(id, r)
    for (const [id, r] of directRoutes(
      pv,
      shown.filter(e => !routes.has(e.id)),
    ))
      routes.set(id, r)
  } else for (const [id, r] of directRoutes(pv, shown)) routes.set(id, r)

  // K15：影响面按方向投影到本层
  let impact: StructureScene['impact'] = null
  let impactSelf: string | null = null
  if (s.impact && idx) {
    const imp = s.impactMode === 'in' ? { ...s.impact, outgoing: [] } : s.impactMode === 'out' ? { ...s.impact, incoming: [] } : s.impact
    impact = levelImpact(idx, view, imp)
    const m = s.impact.module
    impactSelf = pv.nodes.has(m) ? m : pv.nodes.has(`boundary:${m}`) ? `boundary:${m}` : nodeOf(idx, view, new Set(view.nodes.map(n => n.id)), m)
  }

  // O13②：使用者依赖的不同共用件数（含只引类型）
  const sharedSets = new Map<string, Set<string>>()
  for (const e of items)
    if (!e.chip && !shelf.has(e.from) && shelf.has(e.to)) (sharedSets.get(e.from) ?? sharedSets.set(e.from, new Set()).get(e.from)!).add(e.to)
  const sharedCounts = new Map([...sharedSets].map(([k, v]) => [k, v.size]))

  // 聚焦变淡：与聚焦节点之间有画出来的结构边的节点照常；分层总览只有核心模块、共用件参与聚焦（同交互视角）
  let near: Set<string> | null = null
  const focusable = (id: string) => !layered || view.nodes.some(n => n.id === id && (n.role === 'core' || n.role === 'shared'))
  if (!impact && focusId && pv.nodes.has(focusId) && focusable(focusId)) {
    near = new Set([focusId])
    for (const e of shown) {
      if (e.from === focusId) near.add(e.to)
      if (e.to === focusId) near.add(e.from)
    }
  }

  const note = s.note ?? (sv && !sv.facts ? sv.note : null)
  return { facts: !!sv?.facts, items, shown, routes, typeOnlyHidden, note, impact, impactSelf, sharedCounts, near, selected }
}

/** L17、K15、Y4、O13：节点在结构视角下的角标数据（交互视角的角标——端口、组装根——不画） */
export function structureNodeMarks(
  scene: StructureScene,
  input: CanvasInput,
  n: { id: string; moduleId: string; role: string; layerId?: string },
): Pick<NodeData, 'metrics' | 'impact' | 'impactSelf' | 'cycle' | 'sharedCount'> {
  const s = input.structure!
  const out: Pick<NodeData, 'metrics' | 'impact' | 'impactSelf' | 'cycle' | 'sharedCount'> = {}
  const m = n.role === 'actor' || n.role === 'more' ? undefined : s.metrics?.get(n.moduleId)
  if (m && m.ca + m.ce > 0) out.metrics = { ca: m.ca, ce: m.ce, instability: m.instability, band: m.band, ...(n.role === 'shared' ? { inOnly: true } : {}) }
  const hit = scene.impact?.get(n.id)
  if (hit) out.impact = hit
  if (scene.impactSelf === n.id) out.impactSelf = true
  const c = s.cycles?.get(n.id)
  if (c !== undefined) out.cycle = c
  const shared = scene.sharedCounts.get(n.id)
  out.sharedCount = shared || undefined
  return out
}

/** K15：影响面生效时节点是否留在闭包里（自身、闭包内；分层总览的核心块与架上共用件跟随它所在的带） */
export function inImpact(scene: StructureScene, n: { id: string; layerId?: string }): boolean {
  const imp = scene.impact
  if (!imp) return true
  const hit = (id: string) => id === scene.impactSelf || imp.has(id)
  return hit(n.id) || (!!n.layerId && hit(n.layerId))
}
