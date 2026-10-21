/**
 * 环（Y1–Y3）：强连通分量与环度。
 */
import type { ModelIndex } from '../types'
import type { SourceOwnership } from '../source'
import { within } from './facts'
import type { Cycle, FileDep, ModuleDep } from './types'

/** Y1：Tarjan 强连通分量（迭代实现，不怕深递归）；只返回规模 ≥ 2 的，成员按字典序，分量按首个成员排序 */
export function stronglyConnected(edges: Iterable<readonly [string, string]>): string[][] {
  const adj = new Map<string, string[]>()
  for (const [a, b] of edges) {
    if (a === b) continue
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a)!.push(b)
  }
  const indexOf = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const out: string[][] = []
  let counter = 0
  for (const root of adj.keys()) {
    if (indexOf.has(root)) continue
    const work: { node: string; i: number }[] = [{ node: root, i: 0 }]
    indexOf.set(root, counter)
    low.set(root, counter++)
    stack.push(root)
    onStack.add(root)
    while (work.length) {
      const top = work[work.length - 1]
      const next = adj.get(top.node)!
      if (top.i < next.length) {
        const w = next[top.i++]
        if (!indexOf.has(w)) {
          indexOf.set(w, counter)
          low.set(w, counter++)
          stack.push(w)
          onStack.add(w)
          work.push({ node: w, i: 0 })
        } else if (onStack.has(w)) low.set(top.node, Math.min(low.get(top.node)!, indexOf.get(w)!))
        continue
      }
      work.pop()
      if (work.length) {
        const parent = work[work.length - 1].node
        low.set(parent, Math.min(low.get(parent)!, low.get(top.node)!))
      }
      if (low.get(top.node) === indexOf.get(top.node)) {
        const comp: string[] = []
        let w: string
        do {
          w = stack.pop()!
          onStack.delete(w)
          comp.push(w)
        } while (w !== top.node)
        if (comp.length > 1) out.push(comp.sort())
      }
    }
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]))
}

/** Y3：模块是否在容忍的子树内 */
const toleratedModule = (index: ModelIndex, id: string) => (index.model.rules?.cycles?.tolerated ?? []).some(t => within(index, id, t))

/** Y1、Y3：模块环 */
export function moduleCycles(index: ModelIndex, moduleDeps: Iterable<ModuleDep>): Cycle[] {
  return stronglyConnected([...moduleDeps].map(d => [d.from, d.to] as const)).map(members => ({
    members,
    tolerated: members.every(m => toleratedModule(index, m)),
  }))
}

/** Y1、Y3：文件环（终点为目标文件） */
export function fileCycles(index: ModelIndex, own: SourceOwnership, deps: readonly FileDep[]): Cycle[] {
  return stronglyConnected(deps.map(d => [d.from, d.to] as const)).map(members => ({
    members,
    tolerated: members.every(f => {
      const owners = own.owners.get(f)
      return !!owners?.length && owners.every(o => toleratedModule(index, o))
    }),
  }))
}

/** Y2：环度 = 未容忍的环的规模平方和 */
export const cyclicityOf = (cycles: readonly Cycle[]): number => cycles.reduce((n, c) => (c.tolerated ? n : n + c.members.length ** 2), 0)
