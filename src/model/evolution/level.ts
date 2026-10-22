/**
 * 演化事实在当前层次的投影（J3、J4、J5）：每个视图节点的热度档位、本层的耦合线。与结构图、帧共用 mapEndpoint（P1、G14）。
 */
import { nodeOf } from '../governance/level'
import type { LevelView, ModelIndex } from '../types'
import { heatCount, heatValue } from './history'
import type { EvolutionStats, HeatKind, HeatTier, LevelCoupling, LevelEvolution, NodeHeat } from './types'

/** J3：三档按分位数——按值排序三等分（低 / 中 / 高）；0 不分档（返回 null） */
export function heatTiers(values: readonly number[]): (value: number) => HeatTier | null {
  const sorted = [...values].filter(v => v > 0).sort((a, b) => a - b)
  if (!sorted.length) return () => null
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
  const mid = at(1 / 3)
  const high = at(2 / 3)
  return v => (v <= 0 ? null : v >= high ? 3 : v >= mid ? 2 : 1)
}

const moduleOfNode = (view: LevelView, nodeId: string) => view.nodes.find(n => n.id === nodeId)?.moduleId ?? nodeId

/** J3、J4、J5：本层投影——节点的热度档位（在本层节点间分档）与耦合线（投到同一对节点的合并） */
export function levelEvolution(index: ModelIndex, view: LevelView, stats: EvolutionStats, kind: HeatKind): LevelEvolution {
  const nodes = view.nodes.filter(n => n.role !== 'actor')
  const valueOf = (moduleId: string) => {
    const m = stats.modules.get(moduleId)
    return m ? heatValue(m, kind) : 0
  }
  const tierOf = heatTiers(nodes.map(n => valueOf(n.moduleId)))
  const heat = new Map<string, NodeHeat>()
  for (const n of nodes) {
    const m = stats.modules.get(n.moduleId)
    const value = m ? heatValue(m, kind) : 0
    const tier = tierOf(value)
    if (tier && m) heat.set(n.id, { tier, value, count: heatCount(m, kind) })
  }

  // 耦合线：投到同一对节点的耦合对合并，次数为共同提交的并集（同一提交不重复计）
  const present = new Set(view.nodes.map(n => n.id))
  const pairs = new Map<string, LevelCoupling & { hashes: Set<string> }>()
  for (const c of stats.couplings) {
    const a = nodeOf(index, view, present, c.a)
    const b = nodeOf(index, view, present, c.b)
    if (!a || !b || a === b) continue
    const [from, to] = a < b ? [a, b] : [b, a]
    const id = `couple:${from}~${to}`
    const hit = pairs.get(id)
    if (hit) {
      c.commits.forEach(h => hit.hashes.add(h))
      hit.shared = hit.hashes.size
      hit.isolated = hit.isolated && !c.dependency && !c.relation
      hit.pairs.push(c.id)
    } else
      pairs.set(id, {
        id,
        from,
        to,
        fromModule: moduleOfNode(view, from),
        toModule: moduleOfNode(view, to),
        shared: c.shared,
        isolated: !c.dependency && !c.relation,
        pairs: [c.id],
        hashes: new Set(c.commits),
      })
  }
  const couplings = [...pairs.values()]
    .sort((x, y) => y.shared - x.shared || x.id.localeCompare(y.id))
    .map(({ hashes: _h, ...rest }) => rest)
  return { kind, heat, couplings }
}
