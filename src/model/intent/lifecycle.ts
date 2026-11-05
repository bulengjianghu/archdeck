/**
 * 草图的生命周期（X3）：归档判定与草图覆盖的模块（交给确认层写确认记录）。纯函数；写文件在接入层（描述写入）。
 */
import type { ModelIndex, SketchEntity } from '../types'
import { flattenSketch } from './check'
import type { ArchiveVerdict, SketchCheck, SketchDeviation } from './types'

/** X3：核验一致才能归档；声明 supersedes 的为晋升；持久草图不归档 */
export function archiveVerdict(check: SketchCheck): ArchiveVerdict {
  const outcome = check.supersedes ? 'promote' : 'archive'
  if (check.lifetime === 'persistent' && !check.supersedes) return { ok: false, outcome, reason: `草图「${check.sketch}」是持久草图，不归档；只能被声明 supersedes 它的草图替换`, check }
  if (!check.consistent) {
    const open = check.deviations.filter(d => d.severity !== 'info')
    return {
      ok: false,
      outcome,
      reason: `核验不一致（${check.counts.error} 个错误、${check.counts.warning} 个未认可的提醒）：${open
        .slice(0, 3)
        .map(d => d.message)
        .join('；')}${open.length > 3 ? `；…另 ${open.length - 3} 条` : ''}`,
      check,
    }
  }
  return { ok: true, outcome, check }
}

/** X3：归档时写确认记录的对象——草图覆盖的、版本里存在的模块（按草图顺序）；记录的指纹与摘要由确认层按它的口径算 */
export function sketchModules(sketch: SketchEntity, index: ModelIndex): string[] {
  return flattenSketch(sketch)
    .map(m => m.id)
    .filter(id => index.modules.has(id))
}

/** DL-45 的标注：已认可、未归档设计的草图偏差在门禁里的尾注 */
export const PENDING_TASK_NOTE = '（任务单待做）'

/**
 * DL-45（X3 的 ADR-0063 修订）：门禁（`lint:model`）报当前版本上的草图偏差时的严重度——属于已认可、未归档设计的草图（until-implemented）
 * 的偏差，error 降为 warning、消息尾标「任务单待做」：从认可到实现之间的偏差就是任务单，不是违规；与持久草图矛盾（sketch.contradiction）不降。
 * 持久草图不降。核验本身不变：归档三关（archiveVerdict）、任务单与页面仍看原严重度。info（已认可的偏差）原样。
 */
export function gateSeverity(check: Pick<SketchCheck, 'design' | 'lifetime'>, d: Pick<SketchDeviation, 'severity' | 'code' | 'message'>): { severity: SketchDeviation['severity']; message: string; pending: boolean } {
  const pending = !!check.design && check.lifetime === 'until-implemented' && d.severity !== 'info' && d.code !== 'sketch.contradiction'
  if (!pending) return { severity: d.severity, message: d.message, pending }
  return { severity: d.severity === 'error' ? 'warning' : d.severity, message: `${d.message}${PENDING_TASK_NOTE}`, pending }
}
