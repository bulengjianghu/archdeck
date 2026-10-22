/**
 * 拦截记录的统计（Q4）：只数发生过的事，不做反事实推断。
 */
import type { RuleKind } from '../types'
import type { Cyclicity, LedgerEntry, Verdict } from './types'

export interface LedgerSummary {
  checks: number
  byVerdict: Record<Verdict, number>
  /** 被拒绝的判定按规则种类计（一次判定可命中多种） */
  deniedByRule: Record<RuleKind, number>
  /** 会形成或扩大模块环的判定次数 */
  cycleFlags: number
  rescans: number
  /** 确认记录写入次数（Z6） */
  reviewedWrites: number
  first?: { at: string; violations: number; cyclicity: Cyclicity }
  last?: { at: string; violations: number; cyclicity: Cyclicity }
}

export function summarizeLedger(entries: readonly LedgerEntry[]): LedgerSummary {
  const s: LedgerSummary = {
    checks: 0,
    byVerdict: { allowed: 0, denied: 0, unconstrained: 0 },
    deniedByRule: { layer: 0, deps: 0, exposes: 0 },
    cycleFlags: 0,
    rescans: 0,
    reviewedWrites: 0,
  }
  for (const e of entries) {
    if (e.tool === 'check_dependency') {
      s.checks++
      s.byVerdict[e.verdict]++
      if (e.verdict === 'denied') for (const r of new Set(e.rules)) s.deniedByRule[r]++
      if (e.cycle) s.cycleFlags++
    } else if (e.tool === 'reviewed') s.reviewedWrites++
    else {
      s.rescans++
      const point = { at: e.at, violations: e.violations, cyclicity: e.cyclicity }
      s.first ??= point
      s.last = point
    }
  }
  return s
}
