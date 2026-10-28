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

/** L29、K21③：提示的说法（画布角、命令行共用） */
export const tierNoteText = (n: TierNote): string =>
  n.kind === 'big-cycle'
    ? `环 ${n.group} 占本层 ${n.size} / ${n.of} 个子模块，照样分层：整组同层`
    : `本层子模块之间有 ${n.interactions} 条交互、没有依赖，不分层——拆分可能不沿文件边界`

/** L28、L29、K21③、K22：一个普通层次的分层 */
export interface LevelTiers extends Tiering {
  /** 参与分层的节点（module / core 角色的子模块，含边界角色 port / adapter；不含共用件、总线、「+N」、边界节点、参与者），按视图顺序 */
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
}

/** L29：层带出现的门槛 */
export const BAND_MIN_NODES = 7
export const BAND_MIN_TIERS = 3

/** K22：控制反转——通知、流，或写了 via（经端口、总线、通道，含回调）：依赖方向与调用方向相反或经第三方 */
export const isInversion = (r: Pick<RelationEntity, 'type' | 'via'>): boolean => r.type === 'notifies' || r.type === 'streams' || !!parseVia(r.via)

/** L28：参与分层的节点 */
export const tierable = (view: LevelView): string[] => view.nodes.filter(n => n.role === 'module' || n.role === 'core').map(n => n.id)

/**
 * L28：普通层次的分层（分层总览按作者声明的层 O1，返回 null）。依赖只取本层值依赖（levelValueDeps，同 Y4）；
 * 环组复用 Y4 的编号；交互边不影响层号，只用来找向上的线（K22）与有交互却没依赖的兄弟（K21③）。
 */
export function levelTiers(index: ModelIndex, view: LevelView, report: Pick<GovernanceReport, 'moduleDeps'>): LevelTiers | null {
  if (view.mode === 'layered') return null
  const nodes = tierable(view)
  const all = levelValueDeps(index, view, report)
  const t = tierNodes(
    nodes,
    [...all.values()].map(e => [e.from, e.to] as const),
  )
  const y4 = new Map<string, number>()
  levelCycleMembers(all).forEach((ms, i) => ms.forEach(m => y4.set(m, i + 1)))
  const inTier = new Set(nodes)
  const deps = [...all.values()].filter(e => inTier.has(e.from) && inTier.has(e.to)).length
  const upward: UpwardEdge[] = []
  const pairs = new Map<string, { from: string; to: string; edges: string[] }>()
  let interactions = 0
  for (const e of view.edges) {
    if (!inTier.has(e.from) || !inTier.has(e.to) || e.from === e.to) continue
    interactions++
    const rels = e.relationIds.map(id => index.relations.get(id)).filter((r): r is RelationEntity => !!r)
    const a = t.tier.get(e.from)
    const b = t.tier.get(e.to)
    if (a !== undefined && b !== undefined && a > b) {
      const direct = rels.filter(r => !isInversion(r)).map(r => r.id)
      upward.push({ edge: e.id, from: e.from, to: e.to, inversion: !direct.length, relations: direct })
    }
    if (rels.some(r => !r.via) && !all.has(depKey(e.from, e.to)) && !all.has(depKey(e.to, e.from))) {
      const [x, y] = [e.from, e.to].sort()
      const p = pairs.get(depKey(x, y)) ?? { from: e.from, to: e.to, edges: [] }
      p.edges.push(e.id)
      pairs.set(depKey(x, y), p)
    }
  }
  const notes: TierNote[] = []
  if (!deps && interactions && nodes.length >= 2) notes.push({ kind: 'no-deps', interactions })
  const groupIds = t.groups.map(g => y4.get(g[0]) ?? 0)
  t.groups.forEach((g, i) => {
    if (g.length * 2 > nodes.length) notes.push({ kind: 'big-cycle', group: groupIds[i], size: g.length, of: nodes.length })
  })
  return {
    ...t,
    nodes,
    groupIds,
    deps,
    banded: nodes.length >= BAND_MIN_NODES && t.count >= BAND_MIN_TIERS,
    upward,
    undepended: [...pairs.values()],
    notes,
  }
}

/**
 * K22（ADR-0041）：分层总览里向上的边——层间边、核心跨层边与共用件的边，方向违背声明的分层：
 * 接收方所在层可依赖发起方所在层（mayDependOn）、反过来不可，即交互逆着依赖方向；两层都没写 mayDependOn 时按层序（O2，order 小的在上），
 * 发起方的 order 大于接收方。写了 mayDependOn、两个方向都不许的不算向上（那是违规，归代码事实）。控制反转的口径同 levelTiers；
 * 不在任何层里的端点（边界节点、参与者）与同一层内的边不算
 */
export function layerUpward(index: ModelIndex, view: LevelView): UpwardEdge[] {
  if (view.mode !== 'layered' || !view.bands) return []
  const order = new Map(view.bands.map(b => [b.layerId, b.order]))
  const layerOf = new Map(view.nodes.map(n => [n.id, order.has(n.id) ? n.id : n.layerId]))
  const may = (l: string) => index.modules.get(l)?.mayDependOn
  const against = (from: string, to: string, a: number, b: number): boolean => {
    if (may(from)?.includes(to)) return false
    if (may(to)?.includes(from)) return true
    return !may(from) && !may(to) && a > b
  }
  const out: UpwardEdge[] = []
  for (const e of [...view.edges, ...(view.coreEdges ?? []), ...(view.shelfEdges ?? [])]) {
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
    // 子模块全是层的为分层总览（O1，按作者声明的层）
    if (children.length < 2 || children.every(k => index.modules.get(k)?.kind === 'layer')) continue
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
