/**
 * 影响面估算（CI-6，DL-7）：草图改的是目标态，代码里还没有这些框——先按血缘把改动项映射回基线模块（baselineOrigins），
 * 再在依赖图上取传入闭包（IncomingOf 由调用方给：有代码事实的前端传 K15 impactOf 的传入闭包；设计里没有代码事实，用当前版本描述的关系图 incomingByRelations，DL-27）与涉及的场景（R4 的 scenariosOf）。
 * 意图属于描述层，不依赖解释层的架构治理（skeleton 的层规则），所以 K15 的闭包只作参数传进来。
 * 全新的框标「新」、不给数；凡按此口径出的估算都标「按当前描述估」（呈现层）。纯函数。
 */
import type { SketchSet } from '../intent/types'
import type { ModelIndex } from '../types'
import { baselineOrigins, isFresh, type ChangeItem } from './items'

/** 一个基线模块的传入闭包（谁依赖它，含间接）；查不到为 null */
export type IncomingOf = (module: string) => readonly string[] | null

export interface ImpactEstimate {
  /** 映射回的基线模块 */
  origins: string[]
  /** 牵动的模块：映射回的基线模块与它们的传入闭包（去重） */
  modules: string[]
  /** 涉及的场景（映射回的基线模块参与的） */
  scenarios: string[]
  /** 全是新框（映射不回基线）：标「新」、不给数 */
  fresh: boolean
}

/** 没有代码事实时：按当前版本描述的关系（L5 的依赖方向，from 依赖 to）取传入闭包，子树内的关系算在它身上 */
export function incomingByRelations(index: ModelIndex): IncomingOf {
  const back = new Map<string, Set<string>>()
  for (const r of index.relations.values()) {
    if (!index.modules.has(r.from) || !index.modules.has(r.to)) continue
    for (const t of index.pathOf.get(r.to) ?? [r.to]) (back.get(t) ?? back.set(t, new Set()).get(t)!).add(r.from)
  }
  const within = (x: string, id: string) => (index.pathOf.get(x) ?? []).includes(id)
  return id => {
    if (!index.modules.has(id)) return null
    const seen = new Set<string>()
    const queue = [id]
    while (queue.length) {
      const cur = queue.shift()!
      for (const f of back.get(cur) ?? []) {
        if (seen.has(f) || within(f, id)) continue
        seen.add(f)
        queue.push(f)
      }
    }
    return [...seen].sort()
  }
}

/** DL-7：一组改动项的影响面估算 */
export function estimateImpact(items: readonly ChangeItem[], sketches: SketchSet, baseline: ModelIndex, current: ModelIndex, incoming: IncomingOf): ImpactEstimate {
  const origins = [...new Set(items.flatMap(i => baselineOrigins(i, sketches, baseline)))].sort()
  const modules = new Set<string>(origins)
  for (const o of origins) for (const m of incoming(o) ?? []) modules.add(m)
  const scenarios = new Set<string>()
  for (const o of origins) for (const s of current.scenariosOf.get(o) ?? []) scenarios.add(s)
  return { origins, modules: [...modules].sort(), scenarios: [...scenarios].sort(), fresh: !origins.length && items.length > 0 && items.every(isFresh) }
}
