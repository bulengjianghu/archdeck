/**
 * M31：描述契约（ADR-0053）的覆盖计数——lint:model 摘要的「契约」一段；只汇总字段写了没有、超没超长，不新增事实。
 */
import { INVARIANTS_LIMIT, PURPOSE_LIMIT, SUMMARY_LIMIT, invariantsOf, textWidth } from '../contract'
import type { ModelIndex } from '../types'

/** M31：契约字段的覆盖计数 */
export interface ContractCoverage {
  /** 有职责的模块 */
  modules: number
  /** 其中写了 summary 的 */
  summary: number
  /** 核心模块没写 summary 的 */
  coreMissing: number
  relations: number
  /** 写了 purpose 的关系 */
  purpose: number
  /** 写了 invariants 的模块 */
  invariants: number
  /** summary 超 30 字与 purpose 超 20 字的条数 */
  long: number
  /** invariants 超 3 条的模块 */
  many: number
}

export function contractCoverage(index: ModelIndex): ContractCoverage {
  const out: ContractCoverage = { modules: 0, summary: 0, coreMissing: 0, relations: 0, purpose: 0, invariants: 0, long: 0, many: 0 }
  for (const m of index.modules.values()) {
    const summary = m.summary?.trim()
    if (m.responsibility?.trim()) out.modules++
    if (summary) out.summary++
    if (summary && textWidth(summary) > SUMMARY_LIMIT) out.long++
    if (m.role === 'core' && !summary) out.coreMissing++
    const n = invariantsOf(m).length
    if (n) out.invariants++
    if (n > INVARIANTS_LIMIT) out.many++
  }
  for (const r of index.relations.values()) {
    out.relations++
    const purpose = r.purpose?.trim()
    if (purpose) out.purpose++
    if (purpose && textWidth(purpose) > PURPOSE_LIMIT) out.long++
  }
  return out
}

/** M31：lint:model 摘要里的一段 */
export const contractNote = (c: ContractCoverage): string =>
  `契约：summary ${c.summary} / 有职责的 ${c.modules}（核心缺 ${c.coreMissing}）· purpose ${c.purpose} / ${c.relations} · invariants ${c.invariants} 个模块 · 超长 ${c.long}${c.many ? `、不变式超 3 条 ${c.many}` : ''}`
