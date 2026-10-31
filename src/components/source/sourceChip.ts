import { sourceDeltaNote, type CommitDelta } from '@/model'

/** TB-8：落后超过这么多个提交着警示色（议） */
export const SOURCE_LAG_WARN = 100

export interface SourceChipView {
  label: string
  warn: boolean
  /** 单击展开的原文 */
  note: string
}

/** TB-8：源码胶囊写什么、是否着警示色；源码读取失败优先，一致（delta 为 null）时不出现 */
export function sourceChipView(delta: CommitDelta | null, unavailable?: string | null): SourceChipView | null {
  if (unavailable) return { label: '源码不可用', warn: true, note: `源码读取失败：${unavailable}；代码事实、源码与演化不可用` }
  if (!delta) return null
  return {
    label: delta.ahead === null ? '描述的提交不在源码树中' : `描述落后 ${delta.ahead} 个提交`,
    warn: delta.ahead === null || delta.ahead > SOURCE_LAG_WARN,
    note: `${sourceDeltaNote(delta)}；代码事实与源码验收读到的是当前源码树`,
  }
}
