/** 确认（人确认层，Z1–Z6，docs/architecture/governance.md §4.3） */
export * from './types'
export { reviewSummary, normalizeSummary, summaryDef, summaryText, summaryHash, reviewHash, normalizeLines, isReviewable } from './hash'
export { reviewStatus, reviewDiff, reviewScope, reviewStates, reviewCounts, subtreeOf, reviewEntries, entryDef } from './status'
export { reviewDiffText } from './text'
