/**
 * 按依赖分层与拆分信号（L28、K21、K22，ADR-0038）：本层值依赖（Y1、Y4 同口径）决定普通层次的上下——被依赖的在下、入口在上、成环合组；
 * 依赖全部朝下，向上的交互边只可能是控制反转。有交互却没有依赖、子模块不占文件、两个模块共用文件，是模块拆分不沿文件边界的信号。
 * 分层是被描述系统的知识（换成命令行也要），布局只消费层号（Layout 的 tiers.ts）。
 */
import { moduleName } from '../names'
import { DEFAULT_PROJECT_OPTIONS, lowestCommonAncestor, projectLevel } from '../project'
import { moduleFiles, type SourceOwnership } from '../source'
import { parseVia, type Issue, type LevelView, type ModelIndex, type RelationEntity } from '../types'
import { depKey } from './facts'
import { isLayered } from '../indexer'
import { mayDependOnOf, stratumByKey } from '../names'
import { levelCycleMembers, levelValueDeps } from './level'
import { valueDeps } from './cycles'
import type { GovernanceReport, ModuleDep } from './types'

/** L28：只用本层依赖（节点对）给参与分层的节点定层；不看交互边 */
export interface Tiering {
  /** 节点 → 层号：0 为顶层（本层没人依赖的，入口），count - 1 为底层（本层不依赖别人的）；孤立节点不在其中 */
  tier: Map<string, number>
  count: number
  /** 环组（强连通分量，规模 ≥ 2），成员按输入顺序；整组同层 */
  groups: string[][]
  /** 孤立：本层既不依赖别人、也没人依赖（按输入顺序），单列在侧边、不占层 */
  isolated: string[]
}

/**
 * L28 定层：强连通分量收成一组；本层不依赖别人的贴底（高度 0），其余按到底部的最长依赖链往上排（高度 = 1 + 后继的最大高度）；
 * 本层没人依赖的统一提到顶层（入口对齐）；层号自上而下 = 最大高度 − 高度。
 */
export function tierNodes(nodes: readonly string[], pairs: Iterable<readonly [string, string]>): Tiering {
  const present = new Set(nodes)
  const edges: [string, string][] = []
  const seen = new Set<string>()
  for (const [a, b] of pairs) {
    if (a === b || !present.has(a) || !present.has(b) || seen.has(depKey(a, b))) continue
    seen.add(depKey(a, b))
    edges.push([a, b])
  }
  const order = new Map(nodes.map((n, i) => [n, i]))
  const byOrder = (a: string, b: string) => order.get(a)! - order.get(b)!
  // 分量：环为一组，其余各自一组；分量以输入顺序最前的成员为代表
  const comp = new Map(nodes.map(n => [n, n]))
  const groups = levelCycleMembers(new Map(edges.map(([from, to]) => [depKey(from, to), { from, to }]))).map(g => [...g].sort(byOrder))
  for (const g of groups) for (const m of g) comp.set(m, g[0])
  const out = new Map<string, Set<string>>()
  const into = new Map<string, number>()
  for (const [a, b] of edges) {
    const ca = comp.get(a)!
    const cb = comp.get(b)!
    if (ca === cb) continue
    if (!out.has(ca)) out.set(ca, new Set())
    if (!out.get(ca)!.has(cb)) {
      out.get(ca)!.add(cb)
      into.set(cb, (into.get(cb) ?? 0) + 1)
    }
  }
  const touched = new Set(edges.flat())
  const isolated = nodes.filter(n => !touched.has(n))
  // 高度：到汇点的最长链（分量图无环；迭代后序，不怕深递归）
  const height = new Map<string, number>()
  const reps = [...new Set(nodes.filter(n => touched.has(n)).map(n => comp.get(n)!))]
  for (const r of reps) {
    if (height.has(r)) continue
    const stack: { c: string; it: Iterator<string> }[] = [{ c: r, it: (out.get(r) ?? new Set<string>()).values() }]
    while (stack.length) {
      const top = stack[stack.length - 1]
      const nx = top.it.next()
      if (!nx.done) {
        if (!height.has(nx.value)) stack.push({ c: nx.value, it: (out.get(nx.value) ?? new Set<string>()).values() })
        continue
      }
      let h = 0
      for (const s of out.get(top.c) ?? []) h = Math.max(h, height.get(s)! + 1)
      height.set(top.c, h)
      stack.pop()
    }
  }
  const max = reps.reduce((m, r) => Math.max(m, height.get(r)!), -1)
  // 入口对齐：本层没人依赖的提到顶层
  for (const r of reps) if (!into.get(r)) height.set(r, max)
  const tier = new Map<string, number>()
  for (const n of nodes) if (touched.has(n)) tier.set(n, max - height.get(comp.get(n)!)!)
  return { tier, count: max + 1, groups, isolated }
}

/** K22：向上的交互边（自下而上：发起方在接收方之下） */
export interface UpwardEdge {
  edge: string
  from: string
  to: string
  /** 边上的关系全是控制反转（通知、流，或写了 via：经端口、总线、通道含回调）——向上是应有之义 */
  inversion: boolean
  /** 不是控制反转的关系（直接的查询、委托；迁移期含未分类） */
  relations: string[]
}

export type TierNote =
  /** L29：大环（超过本层分层节点的一半）——照样分层，加一句提示 */
  | { kind: 'big-cycle'; group: number; size: number; of: number }
  /** K21③：本层子模块之间有交互、没有任何值依赖——不强行分层 */
  | { kind: 'no-deps'; interactions: number }
  /** L40③：平铺——本层子模块之间既没有值依赖也没有交互 */
  | { kind: 'flat'; nodes: number }

/** L29、K21③：提示的说法（画布角、命令行共用） */
export const tierNoteText = (n: TierNote): string =>
  n.kind === 'big-cycle'
    ? `环 ${n.group} 占本层 ${n.size} / ${n.of} 个子模块，照样分层：整组同层`
    : n.kind === 'flat'
      ? `平铺：本层 ${n.nodes} 个子模块彼此独立（没有依赖也没有交互）`
      : `本层子模块之间有 ${n.interactions} 条交互、没有依赖，不分层——拆分可能不沿文件边界`

/** L39②：「+N」的成员的层号跨度（层号 0 起） */
export interface FoldSpan {
  /** 占位块的视图节点 ID */
  node: string
  from: number
  to: number
  members: number
}

/** L40②：「+N」的成员跨这么多层及以上时提示「该标核心或该拆」 */
export const FOLD_SPAN_WARN = 3

/** L39②、L40②：占位块上的层号与跨度提示（按 1 起） */
export function foldSpanText(f: Pick<FoldSpan, 'from' | 'to'>): { tiers: string; warn: string | null } {
  const k = f.to - f.from + 1
  return {
    tiers: f.from === f.to ? `第 ${f.from + 1} 层` : `第 ${f.from + 1}–${f.to + 1} 层`,
    warn: k >= FOLD_SPAN_WARN ? `跨 ${k} 层：该标核心或该拆` : null,
  }
}

/** L28、L29、K21③、K22：一个普通层次的分层 */
export interface LevelTiers extends Tiering {
  /** 本视图里参与分层的节点（module / core 角色的子模块，含边界角色 port / adapter；折叠时含「+N」，L39；不含共用件、总线、边界节点、参与者），按视图顺序 */
  nodes: string[]
  /** 环组的 Y4 编号，与 groups 对齐 */
  groupIds: number[]
  /** 本层依赖（节点对）条数 */
  deps: number
  /** L29：画层带与层号（≥ BAND_MIN_NODES 个节点且 ≥ BAND_MIN_TIERS 层） */
  banded: boolean
  upward: UpwardEdge[]
  /** K21③：直接交互（不写 via 的）的两端之间、两个方向都没有本层值依赖的节点对 */
  undepended: { from: string; to: string; edges: string[] }[]
  notes: TierNote[]
  /** L39②：折叠时「+N」成员的层号跨度（成员全孤立时不给） */
  foldSpan?: FoldSpan
}

/** L29：层带出现的门槛 */
export const BAND_MIN_NODES = 7
export const BAND_MIN_TIERS = 3

/** K22：控制反转——通知、流，或写了 via（经端口、总线、通道，含回调）：依赖方向与调用方向相反或经第三方 */
export const isInversion = (r: Pick<RelationEntity, 'type' | 'via'>): boolean => r.type === 'notifies' || r.type === 'streams' || !!parseVia(r.via)

/** L28：参与分层的节点 */
export const tierable = (view: LevelView): string[] => view.nodes.filter(n => n.role === 'module' || n.role === 'core').map(n => n.id)

/**
 * L28、L39：普通层次的分层（分层总览按作者声明的层 O1，返回 null）。依赖只取本层值依赖（levelValueDeps，同 Y4）；
 * 层号、环组与层带门槛对全集（「+N」展开后的视图）计算，与折叠无关（L39）；折叠时「+N」放在成员中最上的一层，另给成员的层号跨度（foldSpan）。
 * 环组的编号复用本视图的 Y4；交互边不影响层号，只用来找向上的线（K22，按本视图的边）与有交互却没依赖的兄弟（K21③，按全集）。
 */
export function levelTiers(index: ModelIndex, view: LevelView, report: Pick<GovernanceReport, 'moduleDeps'>): LevelTiers | null {
  if (view.mode === 'layered') return null
  const folded = view.fold && !view.fold.expanded && view.fold.members.length ? view.fold : null
  const full = folded ? tierView(index, view.parentId) : view
  const fullNodes = tierable(full)
  const all = levelValueDeps(index, full, report)
  const t = tierNodes(
    fullNodes,
    [...all.values()].map(e => [e.from, e.to] as const),
  )
  // 本视图的 Y4 编号（与节点上的环编号一致）
  const y4 = new Map<string, number>()
  levelCycleMembers(folded ? levelValueDeps(index, view, report) : all).forEach((ms, i) => ms.forEach(m => y4.set(m, i + 1)))
  const inFull = new Set(fullNodes)
  const deps = [...all.values()].filter(e => inFull.has(e.from) && inFull.has(e.to)).length
  // L39②：投影到本视图——可见节点照抄层号；「+N」取成员中最小的层号，成员全孤立时进孤立列
  const visible = tierable(view)
  const tier = new Map<string, number>()
  for (const n of visible) if (t.tier.has(n)) tier.set(n, t.tier.get(n)!)
  let foldSpan: FoldSpan | undefined
  if (folded) {
    const ts = folded.members.map(m => t.tier.get(m)).filter((x): x is number => x !== undefined)
    if (ts.length) {
      foldSpan = { node: folded.id, from: Math.min(...ts), to: Math.max(...ts), members: folded.members.length }
      tier.set(folded.id, foldSpan.from)
    }
  }
  const shown = new Set([...visible, ...(folded ? [folded.id] : [])])
  const groups = t.groups.map(g => g.filter(m => shown.has(m))).filter(g => g.length)
  const isolated = [...t.isolated.filter(n => shown.has(n)), ...(folded && !foldSpan ? [folded.id] : [])]
  // K22：向上的线按本视图的边（「+N」的边按占位块所在的层）
  const upward: UpwardEdge[] = []
  for (const e of view.edges) {
    if (!shown.has(e.from) || !shown.has(e.to) || e.from === e.to) continue
    const a = tier.get(e.from)
    const b = tier.get(e.to)
    if (a === undefined || b === undefined || a <= b) continue
    const rels = e.relationIds.map(id => index.relations.get(id)).filter((r): r is RelationEntity => !!r)
    const direct = rels.filter(r => !isInversion(r)).map(r => r.id)
    upward.push({ edge: e.id, from: e.from, to: e.to, inversion: !direct.length, relations: direct })
  }
  // K21③、L40③：有交互没依赖、平铺——按全集
  const pairs = new Map<string, { from: string; to: string; edges: string[] }>()
  let interactions = 0
  for (const e of full.edges) {
    if (!inFull.has(e.from) || !inFull.has(e.to) || e.from === e.to) continue
    interactions++
    const rels = e.relationIds.map(id => index.relations.get(id)).filter((r): r is RelationEntity => !!r)
    if (rels.some(r => !r.via) && !all.has(depKey(e.from, e.to)) && !all.has(depKey(e.to, e.from))) {
      const [x, y] = [e.from, e.to].sort()
      const p = pairs.get(depKey(x, y)) ?? { from: e.from, to: e.to, edges: [] }
      p.edges.push(e.id)
      pairs.set(depKey(x, y), p)
    }
  }
  const notes: TierNote[] = []
  if (!deps && fullNodes.length >= 2) notes.push(interactions ? { kind: 'no-deps', interactions } : { kind: 'flat', nodes: fullNodes.length })
  const groupIds = groups.map(g => y4.get(g[0]) ?? 0)
  t.groups.forEach(g => {
    if (g.length * 2 > fullNodes.length) notes.push({ kind: 'big-cycle', group: y4.get(g.find(m => shown.has(m)) ?? '') ?? 0, size: g.length, of: fullNodes.length })
  })
  return {
    tier,
    count: t.count,
    groups,
    isolated,
    nodes: [...shown],
    groupIds,
    deps,
    banded: fullNodes.length >= BAND_MIN_NODES && t.count >= BAND_MIN_TIERS,
    upward,
    undepended: [...pairs.values()],
    notes,
    ...(foldSpan ? { foldSpan } : {}),
  }
}

/**
 * K22（ADR-0041；第十四轮 F8 合入）：分层总览里向上的边——层间边、核心跨层边与共用件的边，方向违背声明的分层：
 * 接收方所在层可依赖发起方所在层（mayDependOn）、反过来不可，即交互逆着依赖方向；两层都没写 mayDependOn 时按层序（O2，order 小的在上），
 * 发起方的 order 大于接收方。写了 mayDependOn、两个方向都不许的不算向上（那是违规，归代码事实）；层序与可依赖方向不一致交给 K24。
 * 控制反转的口径同 levelTiers；不在任何层里的端点（边界节点、参与者）与同一层内的边不算。
 * opts.core 为 false 时只判层间边（返工清单按带间边各报一条，不与核心跨层边重复）。返工清单、desk.facts.upward、画布与边面板都用这一个函数。
 */
export function layerUpward(index: ModelIndex, view: LevelView, opts: { core?: boolean } = {}): UpwardEdge[] {
  if (view.mode !== 'layered' || !view.bands) return []
  const order = new Map(view.bands.map(b => [b.layerId, b.order]))
  const layerOf = new Map(view.nodes.map(n => [n.id, order.has(n.id) ? n.id : n.layerId]))
  // ST：带 → 它的层；可依赖的层按局部 ID 比
  const stratum = new Map(view.bands.map(b => [b.layerId, stratumByKey(index, b.stratum)]))
  const may = (l: string) => {
    const s = stratum.get(l)
    return s && mayDependOnOf(s)
  }
  const sid = (l: string) => stratum.get(l)?.id ?? l
  const against = (from: string, to: string, a: number, b: number): boolean => {
    if (may(from)?.includes(sid(to))) return false
    if (may(to)?.includes(sid(from))) return true
    return !may(from) && !may(to) && a > b
  }
  const out: UpwardEdge[] = []
  for (const e of [...view.edges, ...(opts.core === false ? [] : [...(view.coreEdges ?? []), ...(view.shelfEdges ?? [])])]) {
    const a = order.get(layerOf.get(e.from) ?? '')
    const b = order.get(layerOf.get(e.to) ?? '')
    const la = layerOf.get(e.from)!
    const lb = layerOf.get(e.to)!
    if (a === undefined || b === undefined || la === lb || !against(la, lb, a, b)) continue
    const direct = e.relationIds.filter(id => {
      const r = index.relations.get(id)
      return !!r && !isInversion(r)
    })
    out.push({ edge: e.id, from: e.from, to: e.to, inversion: !direct.length, relations: direct })
  }
  return out
}

/** K24（第十四轮 F3）：声明的层与实算不符的一处——成环（声明为不同的层，实际互相依赖）或倒置（声明 above 在 below 之上，实算 above 在 below 之下） */
export type LayerDrift = { kind: 'cycle'; parent: string; layers: string[] } | { kind: 'inverted'; parent: string; above: string; below: string; tiers: [number, number] }

/**
 * K24（第十四轮 F3）：结构符合性——分层总览（父模块声明了两层以上，ADR-0052）里，按层之间的值依赖（核心与共用件归到所在的带）用 L28 的算法实算层号，
 * 与声明的 order 比对：成环的声明层、order 在上而实算在下的层对，都是漂移。mayDependOn 验「允许的依赖」，这里验「声称的结构」。
 * 没有代码事实时不比对（无依赖可算）。只算、不判定确认状态：只对已确认的层报，由返工清单按确认状态过滤。
 */
export function layerDrift(index: ModelIndex, report: Pick<GovernanceReport, 'moduleDeps'>): LayerDrift[] {
  const out: LayerDrift[] = []
  for (const [parent, children] of index.childrenOf) {
    if (children.length < 2 || (index.strata.get(parent)?.length ?? 0) < 2) continue
    const view = tierView(index, parent)
    const bandOf = new Map<string, string>()
    for (const b of view.bands ?? []) for (const id of [b.layerId, ...b.coreModuleIds, ...b.shelf]) bandOf.set(id, b.layerId)
    const layers = (view.bands ?? []).map(b => b.layerId)
    const order = new Map((view.bands ?? []).map(b => [b.layerId, b.order]))
    const pairs = [...levelValueDeps(index, view, report).values()].flatMap(e => {
      const a = bandOf.get(e.from)
      const b = bandOf.get(e.to)
      return a && b && a !== b ? [[a, b] as const] : []
    })
    const t = tierNodes(layers, pairs)
    for (const g of t.groups) out.push({ kind: 'cycle', parent, layers: g })
    for (const a of layers)
      for (const b of layers) {
        const ta = t.tier.get(a)
        const tb = t.tier.get(b)
        if (ta === undefined || tb === undefined || order.get(a)! >= order.get(b)! || ta <= tb) continue
        out.push({ kind: 'inverted', parent, above: a, below: b, tiers: [ta, tb] })
      }
  }
  return out
}

/** K21①②：一个父模块的子模块的拆分信号（只对有代码事实的当前版本） */
export interface SplitSignals {
  /** ① 子树不占任何文件的子模块（父模块子树有文件时；目标态不算） */
  noFiles: string[]
  /** ② 两个及以上子模块（含各自子树）共用的文件（G6 的归属冲突落在本层的兄弟之间） */
  shared: { file: string; modules: string[] }[]
}

export function splitSignals(index: ModelIndex, own: SourceOwnership, parentId: string, withFiles?: ReadonlySet<string>): SplitSignals {
  const children = (index.childrenOf.get(parentId) ?? []).filter(id => index.modules.get(id)?.status !== 'target')
  const out: SplitSignals = { noFiles: [], shared: [] }
  const has = (id: string) => (withFiles ? withFiles.has(id) : moduleFiles(index, own, id).length > 0)
  if (!children.length || !has(parentId)) return out
  out.noFiles = children.filter(id => !has(id))
  const childOf = (m: string) => (index.pathOf.get(m) ?? []).find(a => children.includes(a))
  for (const f of own.conflicts) {
    const ms = [...new Set((own.owners.get(f) ?? []).map(childOf).filter((m): m is string => !!m))]
    if (ms.length >= 2) out.shared.push({ file: f, modules: ms })
  }
  return out
}

/** 一个层次的分层视图（命令行、校验用）：缺省投影、「+N」展开（不计折叠） */
export const tierView = (index: ModelIndex, parentId: string): LevelView => projectLevel(index, parentId, { ...DEFAULT_PROJECT_OPTIONS, expandedBands: [parentId] })

/**
 * K21、K22 的校验提醒（info，不进门禁）：每个普通层次——向上却不是控制反转的交互边（tier.upward）、子模块之间有交互却没有值依赖（split.no-deps）、
 * 直接交互的兄弟之间没有值依赖（split.undepended）；每个有文件的父模块——子模块不占文件（split.no-files）。两个模块共用文件已由 G6 报警告，不重复。
 */
export function tierIssues(index: ModelIndex, report: Pick<GovernanceReport, 'moduleDeps'>, own: SourceOwnership): Issue[] {
  return tierFindings(index, report, own).map(f => f.issue)
}

/** tierIssues 的每一条连同指向的对象（返工清单定位用）：父模块或两端模块、不是控制反转的关系 */
export interface TierFinding {
  issue: Issue
  modules: string[]
  relation?: string
}

export function tierFindings(index: ModelIndex, report: Pick<GovernanceReport, 'moduleDeps'>, own: SourceOwnership): TierFinding[] {
  const out: TierFinding[] = []
  const name = (id: string) => moduleName(index, id)
  // 一次算好：子树占文件的模块；值依赖与关系按两端的最近公共祖先归到层次——只有在那一层两端才落在两个不同的子模块上
  const withFiles = new Set<string>()
  for (const [id, list] of own.direct) if (list.length) for (const a of index.pathOf.get(id) ?? []) withFiles.add(a)
  const depsAt = new Map<string, Map<string, ModuleDep>>()
  for (const d of valueDeps(report.moduleDeps.values())) {
    const at = lowestCommonAncestor(index, d.from, d.to)
    if (!depsAt.has(at)) depsAt.set(at, new Map())
    depsAt.get(at)!.set(d.key, d)
  }
  const relsAt = new Set([...index.relations.values()].map(r => lowestCommonAncestor(index, r.from, r.to)))
  for (const [parentId, children] of index.childrenOf) {
    if (children.length < 2) continue
    // 声明了分层的为分层总览（O1，按作者声明的层，ADR-0052）：只查向上的线（K22，第十四轮 F8 扩到声明的层）
    if (isLayered(index, parentId)) {
      if (!relsAt.has(parentId)) continue
      const lv = tierView(index, parentId)
      for (const u of layerUpward(index, lv, { core: false })) {
        if (u.inversion) continue
        const r = index.relations.get(u.relations[0])
        const ord = (id: string) => lv.bands?.find(b => b.layerId === id)?.order ?? 0
        out.push({
          issue: {
            severity: 'info',
            code: 'tier.upward',
            message: `「${name(u.from)}」→「${name(u.to)}」向上（声明的层：交互逆着可依赖方向，order ${ord(u.from)} → ${ord(u.to)}）却不是控制反转：${u.relations.join('、')}；多半是没标的回调、通知或经通道（K22）`,
            ...(r?.src ?? index.modules.get(parentId)?.src ?? {}),
          },
          modules: [u.from, u.to],
          relation: u.relations[0],
        })
      }
      continue
    }
    const parent = index.modules.get(parentId)
    const src = parent?.src ?? {}
    const split = splitSignals(index, own, parentId, withFiles)
    if (split.noFiles.length)
      out.push({
        issue: {
          severity: 'info',
          code: 'split.no-files',
          message: `「${name(parentId)}」的 ${split.noFiles.length} 个子模块不占文件：${split.noFiles.map(name).join('、')}——模块拆分的最小单位是文件，先拆文件再划子模块（K21）`,
          ...src,
        },
        modules: [parentId, ...split.noFiles],
      })
    // 这一层既没有依赖也没有交互时没有分层的提醒，不必投影
    if (!depsAt.has(parentId) && !relsAt.has(parentId)) continue
    const view = tierView(index, parentId)
    const t = levelTiers(index, view, { moduleDeps: depsAt.get(parentId) ?? new Map() })
    if (!t) continue
    const nodeName = (id: string) => name(view.nodes.find(n => n.id === id)?.moduleId ?? id)
    if (t.notes.some(n => n.kind === 'no-deps'))
      out.push({
        issue: {
          severity: 'info',
          code: 'split.no-deps',
          message: `「${name(parentId)}」的子模块之间有交互、没有值依赖（${t.nodes.length} 个子模块，${t.undepended.length} 对有直接交互）：交互写在了兄弟之间、依赖却在别处，或模块边界没沿文件切（K21）`,
          ...src,
        },
        modules: [parentId],
      })
    else if (t.undepended.length)
      out.push({
        issue: {
          severity: 'info',
          code: 'split.undepended',
          message: `「${name(parentId)}」有 ${t.undepended.length} 对子模块直接交互、两个方向都没有值依赖：${t.undepended.map(p => `${nodeName(p.from)} → ${nodeName(p.to)}`).join('、')}（K21）`,
          ...src,
        },
        modules: [parentId],
      })
    for (const u of t.upward) {
      if (u.inversion) continue
      const r = index.relations.get(u.relations[0])
      out.push({
        issue: {
          severity: 'info',
          code: 'tier.upward',
          message: `「${nodeName(u.from)}」→「${nodeName(u.to)}」向上（第 ${t.tier.get(u.from)! + 1} 层 → 第 ${t.tier.get(u.to)! + 1} 层）却不是控制反转：${u.relations.join('、')}；多半是没标的回调、通知或经通道（K22）`,
          ...(r?.src ?? src),
        },
        modules: [u.from, u.to],
        relation: u.relations[0],
      })
    }
  }
  return out
}
