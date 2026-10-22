/**
 * 项目健康度（Q10）：项目卡片上的一行摘要，与返工清单同一批材料，只计数不列明细。
 */
import { unconfirmedWarns, type GovernanceReport } from '../governance'
import { reviewCounts } from '../review'
import type { ProjectHealth } from '../project-summary'
import type { SourceOwnership } from '../source'
import type { ModelIndex } from '../types'

export function projectHealth(index: ModelIndex, own: SourceOwnership, report: GovernanceReport): ProjectHealth {
  const counted = report.violations.filter(v => v.status !== 'allowed')
  const live = report.moduleCycles.filter(c => !c.tolerated)
  let unconfirmed = 0
  for (const [id, c] of report.relations) {
    const r = index.relations.get(id)
    if (r && unconfirmedWarns(r, c)) unconfirmed++
  }
  return {
    unowned: own.unowned.length,
    conflicts: own.conflicts.length,
    violations: {
      count: counted.length,
      new: report.gate.newViolations,
      resolved: report.gate.resolved,
      allowed: report.violations.length - counted.length,
      delta: report.baseline ? report.gate.newViolations - report.gate.resolved : null,
    },
    cycles: {
      count: live.length,
      maxSize: Math.max(0, ...live.map(c => c.members.length)),
      cyclicity: report.cyclicity.modules,
      baseline: report.baseline?.cyclicity.modules ?? null,
    },
    unconfirmed,
    reviewed: reviewCounts(index),
  }
}
