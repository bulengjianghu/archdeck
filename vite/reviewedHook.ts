/**
 * 归档写确认记录的接入点（X3，待联调）。这个桩不写任何文件：返回 pending，归档照常改设计状态，结果里注明「确认记录待联调」。
 *
 * 合入确认层（任务 B，分支 r3-reviewed）后把函数体换成下面两行即可，其余不动：
 *
 *   import { reviewEntries } from '../src/model'            // src/model/review：按确认层的口径算 hash 与摘要（职责 / 接口 / 直接子模块）
 *   import { appendReviewed } from './writeModel'            // 确认层的写入端点：逐条按 module 更新或追加，全部校验通过才写
 *   …
 *   const r = appendReviewed(modelRoot, project, reviewEntries(index, modules, { source: `sketch:${design}`, at }), root)
 *   return { file: r.file, count: r.added.length + r.updated.length }
 *
 * 约定（确认层交接记录）：
 *   - appendReviewed(modelRoot, project, entries: ReviewedInput[], root?) → { file, updated: string[], added: string[] }
 *   - ReviewedInput = { module, at (YYYY-MM-DD), hash（非空，由 reviewEntries 计算）, summary（实现后的那一版）, source: 'manual' | 'sketch:<设计 ID>', note? }
 *   - 没有 reviewed.yaml 时新建；reviewed.yaml 是人拥有的文件（已在 isOwnedFile 里，X6）
 * 归档方只给出：草图覆盖的、版本里存在的模块 ID（src/model/intent 的 sketchModules）、设计 ID、日期与当前版本的索引。
 */
import type { ModelIndex } from '../src/model'

export interface SketchReviewedInput {
  /** 当前版本的索引（确认层按它算指纹与摘要） */
  index: ModelIndex
  /** 草图覆盖的、版本里存在的模块 */
  modules: readonly string[]
  design: string
  /** YYYY-MM-DD */
  at: string
}

export interface AppendReviewedResult {
  file: string
  count: number
  /** 桩：还没有接上确认层的写入端点 */
  pending?: true
}

export function appendSketchReviewed(_modelRoot: string, _project: string, _root: string, input: SketchReviewedInput): AppendReviewedResult {
  return { file: 'reviewed.yaml', count: input.modules.length, pending: true }
}
