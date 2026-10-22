/**
 * 归档写确认记录的接入点（X3，待联调）。
 *
 * 约定：确认层（任务 B，人确认层 reviewed.yaml）在 vite/writeModel.ts 实现 `appendReviewed(modelRoot, project, entries)`，
 * 合入后把这里的桩换成它（改 writeModel.ts 里 archiveDesign 的导入即可），reviewed.yaml 的格式与指纹口径由确认层决定、归档方不碰。
 *
 * 归档方给出的每条记录（ReviewedEntry，src/model/intent/types.ts）：
 *   - module   模块 ID（草图覆盖的、版本里存在的模块）
 *   - at       归档日期（YYYY-MM-DD）
 *   - summary  摘要：草图写的职责，没写时为模块名
 *   - source   'sketch:<设计 ID>'
 *   - hash     不填：指纹由确认层按它的口径（职责 / 接口 / 直接子模块）在写入时计算
 * 期望的返回：{ file: 写入的文件（相对本包根目录）, count: 写入的条数 }；写不了时抛错，归档随之失败、不改设计状态。
 *
 * 这个桩不写任何文件：返回 pending，归档照常改设计状态，并在结果里注明「确认记录待联调」。
 */
import type { ReviewedEntry } from '../src/model'

export interface AppendReviewedResult {
  file: string
  count: number
  /** 桩：还没有接上确认层的写入端点 */
  pending?: true
}

export function appendReviewed(_modelRoot: string, _project: string, entries: readonly ReviewedEntry[]): AppendReviewedResult {
  return { file: 'reviewed.yaml', count: entries.length, pending: true }
}
