/**
 * 画布场景的结构视角（ADR-0031、ADR-0032）：束与元素级边的显隐、走线与编码数据，节点的指标、影响面、环、表面与跨界折叠角标。
 * 结构边与交互边并集布局（L15，第七轮 T6）：节点位置与走线都取同一份布局（V12 由构造保证），这里只按边 ID 取走线——
 * 内部边取 elk 的正交走线，框外边与交互视角一样按画出来的这一组走线、分配轨道（outsideRoutes），共用件的边画成曲线（同 O10），
 * 分层总览的带间边取排布给出的竖线与右侧通道、核心模块的跨层依赖取核心跨层边的曲线（同 O4）。
 *   L21：一对节点同方向一条束（desk.facts.structureDisplay 已按显示偏好过滤）：只引类型收起（typeOnly）、只看交互使用（invokesOnly）、
 *   只看未解释（uncoveredOnly），基线外违规、环上、逆稳定照画；一端是边界节点的束跨界折叠（节点朝外一侧「界外 入 N · 出 M」），悬停或选中一端时画出；
 *   选中束时聚焦（与两端相连的束之外变淡），并反向高亮它承载的交互（L22）。
 *   C6、L20：被依赖方表面展开时束散开为元素级边，接到元素端口（越过入口、整模块接到节点本体），同样随只引类型 / 只看交互使用过滤。
 *   O13：共用件与使用者之间的束缺省不画，聚焦任一端时画；反向依赖（U12）、违规（U15）、在环中（Y4）的照画；「共用 ×N」按依赖计。
 *   O13③：分层总览带间画层间的束，带内不画；核心模块（与架上共用件）的跨层依赖按对合成一条，只在聚焦它时画。
 *   K15：选中模块时影响面按方向（偏好 impactMode）投影到本层，节点标方向与距离，闭包外变淡（共享通道「聚焦变淡」）。
 *   L17、L20①：节点标「入 Ca · 出 Ce · 表面 W」与不稳定度三档；Y4：本层环编号常显（不受「代码事实」开关影响）。
 *   U16：没有代码事实时只画允许边（mayDependOn 的投影），画布角说明。
 */
import {
  DEP_FORMS,
  chipDeps,
  isTarget,
  levelImpact,
  moduleName,
  nodeOf,
  shelfOf,
  type AllowedEdge,
  type Bundle,
  type ChipDep,
  type DepForm,
  type DepTier,
  type ElementEdge,
  type ElementKind,
  type ModelIndex,
  type ViewEdge,
  type ViolationStatus,
} from '@/model'
import { chipBundleId, linkRoute, restEdgeId, outsideRoutes, type Box, type EdgeRoute, type Point, type PositionedView } from '../layout'
import type { CanvasInput, DepEdgeKind, DepEdgeLook, DepViolation, NodeData } from './types'

/** L16：结构边形态的名称（悬停说明与图例） */
export const DEP_KIND_LABELS: Readonly<Record<DepEdgeKind, string>> = {
  use: '使用',
  assembly: '组装',
  subclass: '子类',
  implements: '端口实现',
  allowed: '允许依赖',
}

/** K14：依赖档的名称 */
export const DEP_TIER_LABELS: Readonly<Record<DepTier, string>> = { invokes: '交互使用', value: '值使用', type: '只引类型' }

/** K18：表面元素种类的名称 */
export const ELEMENT_KIND_LABELS: Readonly<Record<ElementKind, string>> = { port: '端口', operation: '操作', type: '类型', data: '数据' }

const VIOLATION_LABELS: Readonly<Record<ViolationStatus, string>> = { new: '新增', open: '无基线', known: '已知', allowed: '已豁免' }

/** U15：违规状态投到画布的三档红晕——新增与无基线为红晕、已知为淡红晕、已豁免为灰描边 */
export const violationLook = (status: ViolationStatus | undefined): DepViolation | undefined =>
  status === 'new' || status === 'open' ? 'new' : status === 'known' ? 'known' : status === 'allowed' ? 'allowed' : undefined

/** 线宽档（共享通道「聚合条数」，L18）：1 / 2–4 / ≥5——束按束内元素级边条数（T0 裁决 1） */
export const depWeight = (n: number): 1 | 2 | 3 => (n >= 5 ? 3 : n >= 2 ? 2 : 1)

const strongest = (forms: Iterable<DepForm>): DepForm => {
  const set = new Set(forms)
  return DEP_FORMS.find(f => set.has(f)) ?? 'use'
}
const TIERS: readonly DepTier[] = ['invokes', 'value', 'type']
const strongerTier = (ts: Iterable<DepTier>): DepTier | undefined => {
  const set = new Set(ts)
  return TIERS.find(t => set.has(t))
}

/** 一条要画的结构边（候选）：两端视图节点与编码数据 */
export interface DepItem {
  id: string
  from: string
  to: string
  look: DepEdgeLook
  /** 元素级边：所在的束（Bundle.id）；束与允许边为空 */
  bundle?: string
  /** C6：元素级边接到的元素名（走线终点在元素端口上） */
  element?: string
  /** O13③：分层总览中核心模块（或架上共用件）的跨层依赖——只在聚焦一端时画，画成曲线 */
  chip?: boolean
}

export interface StructureScene {
  /** 有代码事实（结构边）还是只有允许依赖图（U16） */
  facts: boolean
  /** 本层的全部候选结构边（含收起的） */
  items: DepItem[]
  /** 画出来的结构边（束、散开的元素级边、跨层依赖） */
  shown: DepItem[]
  /** 画出来的边的走线 */
  routes: Map<string, EdgeRoute>
  /** L15、B1：收起的只引类型束条数（照画的不计） */
  typeOnlyHidden: number
  /** B1：只看交互使用时收起的值使用束条数 */
  valueHidden: number
  /** B4：只看未解释时收起的已解释束条数 */
  coveredHidden: number
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
  /** 选中的依赖（`sel=d:`）对应的束（与它散开的元素级边） */
  selected: Set<string>
  /** B3：选中束时留在聚焦里的束（与两端相连的）；没有选中束时为 null */
  focus: ReadonlySet<string> | null
  /** L22 反向：选中束承载的交互（K17 覆盖明细，关系 ID）；没有选中束时为空 */
  carried: string[]
  /** B2：本层节点 → 跨界折叠的束（入 / 出与另一端的名字） */
  cross: Map<string, { in: number; out: number; targets: string[]; side: 'top' | 'bottom' | 'left' | 'right' }>
  /** C6：展开表面的节点 → 有画出来的边接到的元素名 */
  usedElements: Map<string, Set<string>>
}

const ruleText = (r: Bundle['ruling']): string => {
  if (r.verdict === 'violation')
    return `违规（${VIOLATION_LABELS[r.status!]}）：${[...new Set(r.violations.map(v => v.reason))].slice(0, 3).join('；')}${r.violations.length > 3 ? ` 等 ${r.violations.length} 条` : ''}`
  if (r.verdict === 'allowed') return `允许：${r.allowedBy.map(b => b.text).join('；')}`
  return '无规则约束'
}

const elementText = (e: ElementEdge): string =>
  e.element ? `${e.element.name}（${ELEMENT_KIND_LABELS[e.element.kind]}）` : e.bypass ? '越过入口（接到模块本体）' : '整模块'

/** L21①、L16a④：一条束的编码数据与悬停说明——最强形态与档、元素级边条数、各形态与元素、覆盖、规则判定、逆稳定 */
export function bundleItem(idx: ModelIndex | null, b: Bundle, own: readonly ElementEdge[]): DepItem {
  const name = (id: string) => (idx ? moduleName(idx, id) : id)
  const lines = [
    `束：${name(b.fromModule)} → ${name(b.toModule)}（${DEP_KIND_LABELS[b.form]} · ${DEP_TIER_LABELS[b.tier]}）`,
    `元素级边 ${b.edges.length} 条 · 文件依赖 ${b.files} 条${b.bypass ? ` · 越过入口 ${b.bypass} 条` : ''}`,
  ]
  for (const f of b.forms) {
    const list = own.filter(e => e.form === f)
    if (!list.length) continue
    const shown = list.slice(0, 8).map(e => `${elementText(e)} ${DEP_TIER_LABELS[e.tier]}`)
    lines.push(`${DEP_KIND_LABELS[f]}：${shown.join('、')}${list.length > 8 ? ` 等 ${list.length} 个` : ''}`)
  }
  const c = b.coverage
  const facts = [c.implementers ? `端口实现 ${c.implementers}` : '', c.subclass ? `子类 ${c.subclass}` : '', c.assembly ? `组装 ${c.assembly}` : '']
    .filter(Boolean)
    .join('、')
  lines.push(`交互覆盖 ${c.relations.length} 条${facts ? `；事实覆盖：${facts}` : ''}`)
  if (b.unexplained) lines.push('未解释：有调用而没有交互关系覆盖（K7）')
  lines.push(ruleText(b.ruling))
  if (b.againstStability) lines.push(`逆稳定（提示）：依赖方 I ${b.againstStability.from.toFixed(2)} 依赖更易变的 I ${b.againstStability.to.toFixed(2)}（U17）`)
  const violation = b.ruling.verdict === 'violation' ? violationLook(b.ruling.status) : undefined
  return {
    id: b.id,
    from: b.from,
    to: b.to,
    look: {
      kind: b.form,
      tier: b.tier,
      fromModule: b.fromModule,
      toModule: b.toModule,
      deps: Math.max(1, b.edges.length),
      files: b.files,
      forms: b.forms,
      ...(b.mixed ? { elements: b.edges.length } : {}),
      ...(violation ? { violation } : {}),
      ...(b.unexplained ? { unexplained: true } : {}),
      ...(b.againstStability ? { against: b.againstStability } : {}),
      title: lines.join('\n'),
    },
  }
}

/** C6、L16a④：一条元素级边的编码数据——自己的形态与档，悬停另列元素名与种类；越过入口的接到节点本体并带记号 */
export function elementItem(idx: ModelIndex | null, e: ElementEdge, b: Bundle | undefined): DepItem {
  const name = (id: string) => (idx ? moduleName(idx, id) : id)
  const violation = b?.ruling.verdict === 'violation' ? violationLook(b.ruling.status) : undefined
  const lines = [
    `${DEP_KIND_LABELS[e.form]}（${DEP_TIER_LABELS[e.tier]}）：${name(e.fromModule)} → ${name(e.toModule)}`,
    `元素：${elementText(e)}`,
    `文件依赖 ${e.files.length} 条${
      e.files.length
        ? `：${e.files
            .slice(0, 3)
            .map(f => `${f.from}:${f.line}`)
            .join('、')}${e.files.length > 3 ? ' 等' : ''}`
        : ''
    }`,
  ]
  if (e.bypass) lines.push('越过入口：深层导入，没有经过模块入口（U18）')
  return {
    id: e.id,
    from: e.from,
    to: e.to,
    bundle: e.bundle,
    ...(e.element ? { element: e.element.name } : {}),
    look: {
      kind: e.form,
      tier: e.tier,
      fromModule: e.fromModule,
      toModule: e.toModule,
      deps: 1,
      files: e.files.length,
      ...(e.element ? { element: { name: e.element.name, kind: e.element.kind } } : {}),
      ...(e.bypass ? { bypass: true } : {}),
      ...(violation ? { violation } : {}),
      title: lines.join('\n'),
    },
  }
}

/** C6：散开的束里没接到元素端口的元素级边（端口封顶外的元素、越过入口、整模块）合成一条，接到节点本体——取最强形态与档，标「×N 其余」 */
export function restItem(idx: ModelIndex | null, b: Bundle, rest: readonly ElementEdge[]): DepItem {
  const base = bundleItem(idx, { ...b, edges: rest.map(e => e.id), forms: DEP_FORMS.filter(f => rest.some(e => e.form === f)) }, rest)
  const bypass = rest.some(e => e.bypass)
  const forms = DEP_FORMS.filter(f => rest.some(e => e.form === f))
  return {
    ...base,
    id: restEdgeId(b.id),
    bundle: b.id,
    look: {
      ...base.look,
      kind: strongest(forms),
      tier: strongerTier(rest.map(e => e.tier)) ?? b.tier,
      forms,
      deps: rest.length,
      elements: rest.length,
      rest: true,
      ...(bypass ? { bypass: true } : {}),
      title: [`接到节点本体的其余元素级边 ${rest.length} 条（端口封顶外的元素、越过入口、整模块；元素清单见面板「表面」一节）`, base.look.title].join('\n'),
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

/** O13③、L21：核心模块（与架上共用件）的跨层依赖——一对节点一条束（chipDeps 已按对合成：最强形态与档，线宽按元素级边条数） */
export function chipItems(idx: ModelIndex, list: readonly ChipDep[]): DepItem[] {
  return list.map(e => {
    const violation = violationLook(e.violation)
    return {
      id: chipBundleId(e.from, e.to),
      from: e.from,
      to: e.to,
      chip: true,
      look: {
        kind: e.form,
        tier: e.tier,
        fromModule: e.fromModule,
        toModule: e.toModule,
        deps: Math.max(1, e.edges),
        files: e.files,
        forms: e.forms,
        ...(e.forms.length > 1 ? { elements: e.edges } : {}),
        ...(violation ? { violation } : {}),
        title: [
          `跨层依赖：${moduleName(idx, e.fromModule)} → ${moduleName(idx, e.toModule)}（${e.forms.map(f => DEP_KIND_LABELS[f]).join('、')} · ${DEP_TIER_LABELS[e.tier]}）`,
          `模块依赖 ${e.deps.length} 条 · 文件依赖 ${e.files} 条`,
          ...(e.violation ? [`违规（${VIOLATION_LABELS[e.violation]}）`] : []),
        ].join('\n'),
      },
    }
  })
}

/** 结构边在走线器里的外形（同并集布局里的结构边） */
export const depViewEdge = (e: Pick<DepItem, 'id' | 'from' | 'to'>): ViewEdge => ({
  id: e.id,
  kind: 'direct',
  from: e.from,
  to: e.to,
  type: 'calls',
  relationIds: [],
  mode: 'sync',
})

/** C6：节点到一个点（元素端口）的曲线（不参与布局的边接到元素时用） */
export function routeToPoint(a: Box | undefined, p: Point | undefined, b?: Box): EdgeRoute | undefined {
  if (!p) return linkRoute(a, b)
  return linkRoute(a, { x: p.x, y: p.y, w: 0, h: 0 })
}

/** C6：元素端口的位置 */
export const elementAt = (pv: PositionedView, node: string, element: string | undefined): Point | undefined =>
  element ? pv.elements?.get(node)?.find(x => x.name === element) : undefined

/** B2：跨界折叠记号画在节点朝外的一侧——朝着折叠进来的另一端（边界节点）的平均方向 */
function outwardSide(pv: PositionedView, node: string, others: readonly string[]): 'top' | 'bottom' | 'left' | 'right' {
  const b = pv.nodes.get(node)
  const os = others.map(o => pv.nodes.get(o)).filter((x): x is Box => !!x)
  if (!b || !os.length) return 'top'
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  const dx = os.reduce((n, o) => n + o.x + o.w / 2 - cx, 0) / os.length
  const dy = os.reduce((n, o) => n + o.y + o.h / 2 - cy, 0) / os.length
  return Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? 'top' : 'bottom') : dx < 0 ? 'left' : 'right'
}

/** 结构视角的场景派生；结构视角之外不调用 */
export function structureScene(input: CanvasInput, pv: PositionedView, focusId: string | null): StructureScene {
  const s = input.structure!
  const idx = input.index
  const view = pv.view
  const layered = view.mode === 'layered'
  const sv = s.view
  const disp = sv?.facts ? (s.display ?? null) : null
  const sel = input.selection
  const shelf = shelfOf(view)
  const isBoundary = (id: string) => id.startsWith('boundary:')
  const touches = (e: DepItem) => !!focusId && (e.from === focusId || e.to === focusId)
  const cyc = s.cycles
  const inCycle = (e: { from: string; to: string }) => !!cyc && cyc.get(e.from) !== undefined && cyc.get(e.from) === cyc.get(e.to)

  const items: DepItem[] = []
  let shown: DepItem[] = []
  const selected = new Set<string>()
  let focus: ReadonlySet<string> | null = null
  let carried: string[] = []
  const cross: StructureScene['cross'] = new Map()
  const usedElements = new Map<string, Set<string>>()

  if (sv && !sv.facts) {
    // U16：允许边——边界节点的只在聚焦其一端时画（同 L4），两端都是边界节点的只在聚焦时画
    items.push(...sv.edges.map(e => allowedItem(idx, e)))
    shown = items.filter(e => (isBoundary(e.from) || isBoundary(e.to) ? touches(e) : true))
  } else if (sv?.facts && disp) {
    const byBundle = new Map<string, ElementEdge[]>()
    for (const e of sv.elementEdges) byBundle.set(e.bundle, [...(byBundle.get(e.bundle) ?? []), e])
    const bundles = new Map(sv.bundles.map(b => [b.id, b]))
    const picked = disp.focus ? bundles.get(disp.focus.bundle) : undefined
    focus = disp.focus ? disp.focus.bundles : null
    carried = picked ? [...picked.coverage.relations] : []
    // 选中的束不论过滤照画
    const list = picked && !disp.shown.some(b => b.id === picked.id) ? [...disp.shown, picked] : [...disp.shown]
    const keep = (b: Bundle) => {
      if (b.id === picked?.id) return true
      // O13②：共用件——聚焦一端、违规、在环中、反向依赖（共用件依赖使用者，U12）照画
      if (shelf.has(b.from) || shelf.has(b.to))
        return (!!focusId && (b.from === focusId || b.to === focusId)) || disp.anomalies.has(b.id) || inCycle(b) || (shelf.has(b.from) && !shelf.has(b.to))
      return true
    }
    // C6：被依赖方表面展开、本布局散开了的束换成元素级边（随只引类型 / 只看交互使用过滤；照画的束不过滤）
    const spread = pv.spread ?? new Set<string>()
    for (const b of list.filter(keep)) {
      const own = byBundle.get(b.id) ?? []
      if (!spread.has(b.id) || !own.length) {
        items.push(bundleItem(idx, b, own))
        continue
      }
      const odd = disp.anomalies.has(b.id) || b.id === picked?.id
      const fits = (e: ElementEdge) => odd || ((s.typeOnly || e.tier !== 'type') && (!s.invokesOnly || e.tier === 'invokes'))
      const ports = new Set((pv.elements?.get(b.to) ?? []).map(p => p.name))
      const rest: ElementEdge[] = []
      for (const e of own.filter(fits)) {
        if (!e.element || !ports.has(e.element.name)) {
          rest.push(e)
          continue
        }
        items.push(elementItem(idx, e, b))
        ;(usedElements.get(e.to) ?? usedElements.set(e.to, new Set()).get(e.to)!).add(e.element.name)
      }
      if (rest.length) items.push(restItem(idx, b, rest))
    }
    shown = [...items]
    if (picked) for (const e of items) if (e.id === picked.id || e.bundle === picked.id) selected.add(e.id)
    // B2：跨界折叠——一端是边界节点、没画出来的（不含照画的）束，按本层那一端节点计入、记下另一端
    const drawn = new Set(list.map(b => b.id))
    const name = (id: string) => {
      const m = view.nodes.find(n => n.id === id)?.moduleId ?? id
      return idx ? moduleName(idx, m) : m
    }
    const others = new Map<string, string[]>()
    const targets = new Map<string, string[]>()
    for (const b of sv.bundles) {
      if (disp.reach.get(b.id) !== 'cross' || drawn.has(b.id) || disp.anomalies.has(b.id)) continue
      // 与 cross 计数同口径：被档位、未解释过滤收起的不算折叠
      if ((b.tier === 'type' && !s.typeOnly) || (b.tier === 'value' && s.invokesOnly) || (s.uncoveredOnly && !b.unexplained)) continue
      const outward = isBoundaryNode(idx, view, b.from) ? 'in' : 'out'
      const inner = outward === 'in' ? b.to : b.from
      const other = outward === 'in' ? b.from : b.to
      others.set(inner, [...(others.get(inner) ?? []), other])
      targets.set(inner, [...(targets.get(inner) ?? []), `${outward === 'in' ? '入' : '出'} ${name(other)}`])
    }
    for (const [node, c] of disp.cross)
      if (c.in + c.out > 0) cross.set(node, { ...c, targets: targets.get(node) ?? [], side: outwardSide(pv, node, others.get(node) ?? []) })
  }

  // O13③：聚焦（或选中的依赖一端是）核心模块 / 架上共用件时，补它的跨层依赖（按对合成一条）
  if (layered && sv?.facts && idx && s.report) {
    const chipIds = new Set(view.nodes.filter(n => n.role === 'core' || n.role === 'shared').map(n => n.id))
    const wanted = new Set<string>()
    if (focusId && chipIds.has(focusId)) wanted.add(focusId)
    if (sel?.kind === 'dep') for (const id of sel.id.split('->')) if (chipIds.has(id)) wanted.add(id)
    const chips = chipItems(idx, chipDeps(idx, view, s.report, wanted))
    items.push(...chips)
    shown.push(...chips)
    if (sel?.kind === 'dep') for (const c of chips) if (`${c.look.fromModule}->${c.look.toModule}` === sel.id) selected.add(c.id)
  }

  // 走线（L15，并集布局）：与交互边同一个走线器——布局给出的按 ID 取；普通层次的框外边按画出来的这一组走线（同 L11），
  // 共用件的边为曲线（同 O10），接到元素时曲线的终点落在元素端口上
  const routes = new Map<string, EdgeRoute>()
  const outside = layered ? new Map<string, EdgeRoute>() : outsideRoutes(pv, shown.filter(e => !e.chip).map(depViewEdge))
  for (const e of shown) {
    const r = e.chip
      ? pv.coreEdges.get(e.id)
      : (outside.get(e.id) ??
        pv.edges.get(e.id) ??
        (shelf.has(e.from) || shelf.has(e.to) ? routeToPoint(pv.nodes.get(e.from), elementAt(pv, e.to, e.element), pv.nodes.get(e.to)) : undefined))
    if (r) routes.set(e.id, r)
  }

  // K15：影响面按方向投影到本层
  let impact: StructureScene['impact'] = null
  let impactSelf: string | null = null
  if (s.impact && idx) {
    const imp = s.impactMode === 'in' ? { ...s.impact, outgoing: [] } : s.impactMode === 'out' ? { ...s.impact, incoming: [] } : s.impact
    impact = levelImpact(idx, view, imp)
    const m = s.impact.module
    impactSelf = pv.nodes.has(m) ? m : pv.nodes.has(`boundary:${m}`) ? `boundary:${m}` : nodeOf(idx, view, new Set(view.nodes.map(n => n.id)), m)
  }

  // O13②：使用者依赖的不同共用件数（含只引类型）——按全部束
  const sharedSets = new Map<string, Set<string>>()
  for (const b of sv?.facts ? sv.bundles : [])
    if (!shelf.has(b.from) && shelf.has(b.to)) (sharedSets.get(b.from) ?? sharedSets.set(b.from, new Set()).get(b.from)!).add(b.to)
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

  const hidden = disp?.hidden ?? { type: 0, value: 0, covered: 0, cross: 0 }
  const note = s.note ?? (sv && !sv.facts ? sv.note : null)
  return {
    facts: !!sv?.facts,
    items,
    shown,
    routes,
    typeOnlyHidden: hidden.type,
    valueHidden: hidden.value,
    coveredHidden: hidden.covered,
    note,
    impact,
    impactSelf,
    sharedCounts,
    near,
    selected,
    focus,
    carried,
    cross,
    usedElements,
  }
}

/** B2、L14：本层的边界节点——外部（boundary:）、边界角色（port / adapter）与目标态模块（同 desk.facts 的 boundaryNodes） */
function isBoundaryNode(idx: ModelIndex | null, view: PositionedView['view'], id: string): boolean {
  const n = view.nodes.find(x => x.id === id)
  if (!n) return id.startsWith('boundary:')
  return n.role === 'boundary' || !!n.rim || (!!idx && idx.modules.has(n.moduleId) && isTarget(idx, n.moduleId))
}

/** L17、L20①、K15、Y4、O13、B2：节点在结构视角下的角标数据（交互视角的角标——端口、组装根——不画） */
export function structureNodeMarks(
  scene: StructureScene,
  input: CanvasInput,
  n: { id: string; moduleId: string; role: string; layerId?: string },
): Pick<NodeData, 'metrics' | 'impact' | 'impactSelf' | 'cycle' | 'sharedCount' | 'sharedByDeps' | 'crossFold'> {
  const s = input.structure!
  const out: Pick<NodeData, 'metrics' | 'impact' | 'impactSelf' | 'cycle' | 'sharedCount' | 'sharedByDeps' | 'crossFold'> = {}
  const m = n.role === 'actor' || n.role === 'more' ? undefined : s.metrics?.get(n.moduleId)
  if (m && m.ca + m.ce > 0)
    out.metrics = {
      ca: m.ca,
      ce: m.ce,
      instability: m.instability,
      band: m.band,
      ...(n.role === 'shared' ? { inOnly: true } : {}),
      // L20①：「表面 W」与「入 · 出」同一行；没有入口（W 不给）不显示
      ...(m.w != null && n.role !== 'shared' && n.role !== 'layer' ? { w: m.w } : {}),
    }
  const hit = scene.impact?.get(n.id)
  if (hit) out.impact = hit
  if (scene.impactSelf === n.id) out.impactSelf = true
  const c = s.cycles?.get(n.id)
  if (c !== undefined) out.cycle = c
  const shared = scene.sharedCounts.get(n.id)
  out.sharedCount = shared || undefined
  if (shared) out.sharedByDeps = true
  const x = scene.cross.get(n.id)
  if (x)
    out.crossFold = {
      in: x.in,
      out: x.out,
      side: x.side,
      title: [
        '跨界折叠：一端是边界节点的束缺省不画，悬停或选中任一端时画出（L21③）',
        ...x.targets.slice(0, 12),
        ...(x.targets.length > 12 ? [`等 ${x.targets.length} 条`] : []),
      ].join('\n'),
    }
  return out
}

/** K15：影响面生效时节点是否留在闭包里（自身、闭包内；分层总览的核心块与架上共用件跟随它所在的带） */
export function inImpact(scene: StructureScene, n: { id: string; layerId?: string }): boolean {
  const imp = scene.impact
  if (!imp) return true
  const hit = (id: string) => id === scene.impactSelf || imp.has(id)
  return hit(n.id) || (!!n.layerId && hit(n.layerId))
}
