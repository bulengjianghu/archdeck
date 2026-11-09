/** 差异的一句话（返工清单的 detail、命令行与面板的摘要共用，Z3） */
import { REVIEW_FIELDS, REVIEW_FIELD_LABELS, type ReviewChange, type ReviewDiff } from './types'

const mark = (c: ReviewChange) => (c.kind === 'added' ? '+' : c.kind === 'removed' ? '−' : '≠')

export function reviewDiffText(diff: ReviewDiff): string {
  return REVIEW_FIELDS.filter(f => diff[f].length)
    .map(f => `${REVIEW_FIELD_LABELS[f]}：${diff[f].map(c => `${mark(c)}「${c.text}」`).join(' ')}`)
    .join('；')
}
