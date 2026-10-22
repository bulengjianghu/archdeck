/**
 * 草图的生命周期（X3）：归档判定与草图覆盖的模块（交给确认层写确认记录）。纯函数；写文件在接入层（描述写入）。
 */
import type { ModelIndex, SketchEntity } from '../types'
import { flattenSketch } from './check'
import type { ArchiveVerdict, SketchCheck } from './types'

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
