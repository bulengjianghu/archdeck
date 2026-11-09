/**
 * 血缘与前缀映射（X11、X12，ADR-0025）：模块的 from 一律指向基线 ID；一个设计的全部草图合起来是一份血缘。
 * 由血缘推出前缀映射（基线 ID → 设计里的 ID）：改 ID / 移动的来源换成结果，合并的来源换成「结果.来源短名」；
 * 没有草图覆盖的后代由前缀映射推出。版本对比（diffModels）、核验（compareSketch）与交给 AI 的摘要都按它表述。纯函数。
 */
import type { SketchDef } from '../types'
import { locateAll, shortName } from './edit/locate'

/** 设计里的 ID → 它的基线来源（只收写了 from 的模块） */
export type Lineage = ReadonlyMap<string, readonly string[]>

/** X11：一组草图的血缘（同一 ID 出现在多张草图里时取先出现的） */
export function sketchLineage(sketches: Iterable<SketchDef>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const def of sketches) for (const m of locateAll(def)) if (m.node.from?.length && !out.has(m.id)) out.set(m.id, [...m.node.from])
  return out
}

/** 血缘里出现过的全部基线 ID */
export const lineageSources = (lineage: Lineage): Set<string> => new Set([...lineage.values()].flat())

/** 合并结果：from 至少两个基线 ID */
export const isMergeResult = (lineage: Lineage, id: string): boolean => (lineage.get(id)?.length ?? 0) >= 2

/**
 * X12：前缀映射（基线 ID → 设计里的 ID）。from 恰一个的：来源 → 结果（同一来源被拆成多个时不映射）；
 * 合并结果：每个来源 → 「结果.来源短名」（已有 from 恰为该来源的模块时以它为准）。
 */
export function prefixMap(lineage: Lineage): Map<string, string> {
  const single = new Map<string, string[]>()
  for (const [id, from] of lineage) if (from.length === 1) single.set(from[0], [...(single.get(from[0]) ?? []), id])
  const out = new Map<string, string>()
  for (const [src, ids] of single) if (ids.length === 1) out.set(src, ids[0])
  for (const [id, from] of lineage) if (from.length >= 2) for (const src of from) if (!out.has(src)) out.set(src, `${id}.${shortName(src)}`)
  return out
}

/** 按前缀映射换 ID：取最长的已映射前缀（自身或祖先）；没有映射时原样返回 */
export function mapId(map: ReadonlyMap<string, string>, id: string): string {
  let best: string | undefined
  for (const src of map.keys()) if ((id === src || id.startsWith(`${src}.`)) && (!best || src.length > best.length)) best = src
  return best === undefined ? id : `${map.get(best)}${id.slice(best.length)}`
}

/** 前缀映射的逆：设计里的 ID → 基线里的对应（自身或祖先经映射得到）；没有时原样返回 */
export function unmapId(map: ReadonlyMap<string, string>, id: string): string {
  let best: [string, string] | undefined
  for (const [src, to] of map) if ((id === to || id.startsWith(`${to}.`)) && (!best || to.length > best[1].length)) best = [src, to]
  return best ? `${best[0]}${id.slice(best[1].length)}` : id
}

/** 变更的血缘种类（X11） */
export type LineageKind = 'added' | 'merged' | 'split' | 'renamed' | 'moved'

/**
 * X11：一个不在基线里的模块按血缘读作什么。shared：同一个基线 ID 被几个模块的 from 引用；
 * sameParent：与来源同父（父按前缀映射比较）；parentMerged：父是合并结果（计入合并、不另列）。
 */
export function lineageKind(from: readonly string[] | undefined, opts: { shared: (src: string) => number; sameParent: (src: string) => boolean }): LineageKind {
  if (!from?.length) return 'added'
  if (from.length >= 2) return 'merged'
  if (opts.shared(from[0]) >= 2) return 'split'
  return opts.sameParent(from[0]) ? 'renamed' : 'moved'
}

/** 变更摘要的措辞（F-53）：「合并 A、B 为 N」「拆分 A 为 A1、A2」「改 ID A 为 N」「移动 A 到 P 之下」 */
export function lineagePhrase(kind: LineageKind | 'changed' | 'removed', id: string, opts: { from?: readonly string[]; to?: readonly string[]; parent?: string; name?: (id: string) => string } = {}): string {
  const n = opts.name ?? ((x: string) => x)
  const list = (ids: readonly string[] = []) => ids.map(n).join('、')
  switch (kind) {
    case 'merged':
      return `合并 ${list(opts.from)} 为 ${n(id)}`
    case 'split':
      return `拆分 ${n(id)} 为 ${list(opts.to)}`
    case 'renamed':
      return `改 ID ${list(opts.from)} 为 ${n(id)}`
    case 'moved':
      return `移动 ${list(opts.from)} 到 ${opts.parent ? n(opts.parent) : '根'} 之下（${id}）`
    case 'added':
      return `新增 ${n(id)}`
    case 'changed':
      return `修改 ${n(id)}`
    case 'removed':
      return `删除 ${n(id)}`
  }
}
