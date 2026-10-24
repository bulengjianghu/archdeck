/**
 * 项目健康度（Q10）：项目卡片上的一行摘要，与返工清单同一批材料，只计数不列明细。
 */
import { implementerWarns, sharedHostOf, unconfirmedWarns, type GovernanceReport } from '../governance'
import { reviewCounts } from '../review'
import type { ProjectHealth, SharedHealth } from '../project-summary'
import { moduleFiles, type SourceOwnership } from '../source'
import { isSharedRole, type ModelIndex } from '../types'
import type { OkHistory } from '../evolution/types'

/** Q13：共用件行数占比的缺省阈值（sourceLimits.sharedRatio 可改）与修改次数占比的阈值（议） */
export const DEFAULT_SHARED_RATIO = 0.2
export const SHARED_CHANGE_RATIO = 0.3

/**
 * Q13：共用件的两条提醒——反向依赖条数（U12）；体量异常增长：共用件子树的行数合计（G19）占已归属行数的比例超过阈值，
 * 或近 J1 窗口内触及共用件文件的提交占全部提交的比例超过 30%。只计数、不卡门禁。没有共用件时为 null。
 */
export function sharedHealth(
  index: ModelIndex,
  own: SourceOwnership,
  report: Pick<GovernanceReport, 'sharedReverse'> | null,
  lines?: Readonly<Record<string, number>> | null,
  history?: OkHistory | null,
): SharedHealth | null {
  const shared = [...index.modules.values()].filter(m => isSharedRole(m.role) && sharedHostOf(index, m.id) === m.id).map(m => m.id)
  if (!shared.length) return null
  const files = new Set(shared.flatMap(id => moduleFiles(index, own, id)))
  const total = [...own.owners.keys()].reduce((n, f) => n + (lines?.[f] ?? 0), 0)
  const mine = [...files].reduce((n, f) => n + (lines?.[f] ?? 0), 0)
  const lineRatio = lines && total > 0 ? mine / total : null
  const commits = history?.commits ?? []
  const changeRatio = history && commits.length ? commits.filter(c => c.files.some(f => files.has(f.path))).length / commits.length : null
  const limits = { lines: index.model.sourceLimits?.sharedRatio ?? DEFAULT_SHARED_RATIO, changes: SHARED_CHANGE_RATIO }
  return {
    modules: shared.length,
    reverse: report?.sharedReverse.length ?? 0,
    lineRatio,
    changeRatio,
    limits,
    over: (lineRatio ?? 0) > limits.lines || (changeRatio ?? 0) > limits.changes,
  }
}

export function projectHealth(
  index: ModelIndex,
  own: SourceOwnership,
  report: GovernanceReport,
  lines?: Readonly<Record<string, number>> | null,
  history?: OkHistory | null,
): ProjectHealth {
  const shared = sharedHealth(index, own, report, lines, history)
  const counted = report.violations.filter(v => v.status !== 'allowed')
  const live = report.moduleCycles.filter(c => !c.tolerated)
  let unconfirmed = 0
  for (const [id, c] of report.relations) {
    const r = index.relations.get(id)
    if (r && unconfirmedWarns(r, c)) unconfirmed++
  }
  // K5c、K6：描述写了、报警的端口实现者
  for (const p of report.implementers.values()) unconfirmed += p.implementers.filter(i => i.described && implementerWarns(i)).length
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
    ...(shared ? { shared } : {}),
  }
}
