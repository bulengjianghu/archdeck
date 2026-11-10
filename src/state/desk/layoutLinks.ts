/**
 * 交给布局的结构边（L15、L21、L28）：本层结构视图的束与元素级边、分层总览的核心跨层束（chipDeps）、按值依赖的分层（levelTiers）。
 * 纯函数：DeskState（facts.ts 的 baseLinks / layoutTiers）与线的几何检查器（tests/layout/clarity，L30）共用，检查器量到的就是产品的布局。
 */
import { chipDeps, portPanel, type GovernanceReport, type LevelTiers, type LevelView, type ModelIndex, type StructureView } from '@/model'
import { chipBundleId, compassOf, type LayoutTiers, type StructureLinks } from '@/layout/layout'

/** L28：交给布局的分层（纯数据，进缓存键）；没有层号但有孤立节点时只给孤立列 */
export function toLayoutTiers(t: LevelTiers | null): LayoutTiers | null {
  if (!t || !t.count) return t && t.isolated.length ? { tier: {}, count: 0, groups: [], isolated: t.isolated, banded: false } : null
  return {
    tier: Object.fromEntries(t.tier),
    count: t.count,
    groups: t.groups.map((g, i) => ({ id: t.groupIds[i], nodes: g })),
    isolated: t.isolated,
    banded: t.banded,
    ...(t.foldSpan ? { fold: t.foldSpan } : {}),
  }
}

/**
 * L11、L13（ADR-0039 修订 1）：普通层次中有端口记号的内部节点——子模块（`module` / `core`）声明了算端口的接口（K11）；
 * 与画布的端口记号（facts.portMarks）同一判定，但不看视角（两个视角同一份布局，V12）。分层总览不给（核心的端口另按 O3b 分配）。
 */
export function portMarkedNodes(index: ModelIndex, view: LevelView, report: GovernanceReport | null): string[] {
  if (view.mode === 'layered') return []
  return view.nodes
    .filter(n => (n.role === 'module' || n.role === 'core') && compassOf(n) === 'inner' && portPanel(index, report, n.moduleId).some(p => p.isPort))
    .map(n => n.id)
}

/**
 * L15、L21：并集布局的基础输入——本层全部束与元素级边（不含表面展开），分层总览另加全部块的跨层依赖（按对合成一条）；
 * 没有代码事实时为允许边（U16）。
 */
export function baseLayoutLinks(
  index: ModelIndex,
  view: LevelView,
  sv: StructureView,
  report: GovernanceReport | null,
  tiers: LayoutTiers | null,
): StructureLinks {
  const link = (e: { id: string; from: string; to: string }) => ({ id: e.id, from: e.from, to: e.to })
  const ports = portMarkedNodes(index, view, report)
  const marked = ports.length ? { marked: ports } : {}
  if (!sv.facts) return { edges: sv.edges.map(link), ...marked }
  const chips = new Set(view.nodes.filter(n => n.role === 'core' || n.role === 'shared').map(n => n.id))
  const pairs = new Map<string, { id: string; from: string; to: string }>()
  if (view.mode === 'layered' && report)
    for (const c of chipDeps(index, view, report, chips)) pairs.set(chipBundleId(c.from, c.to), { id: chipBundleId(c.from, c.to), from: c.from, to: c.to })
  const core = [...pairs.values()]
  const elements = sv.elementEdges.map(e => ({
    ...link(e),
    bundle: e.bundle,
    element: e.element?.name ?? null,
    ...(e.element ? { kind: e.element.kind } : {}),
  }))
  return { edges: sv.bundles.map(link), ...(core.length ? { core } : {}), ...(elements.length ? { elements } : {}), ...(tiers ? { tiers } : {}), ...marked }
}
