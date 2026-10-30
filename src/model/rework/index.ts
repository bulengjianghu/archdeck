/** 返工清单（docs/architecture/governance.md §4.2） */
export * from './types'
export { reworkList } from './list'
export type { ReworkInput } from './list'
export { reworkMarkdown, reworkItemMarkdown, reworkLocText } from './markdown'
export type { ReworkMarkdownOptions } from './markdown'
export { projectHealth, sharedHealth, topSharedFanIn, DEFAULT_SHARED_RATIO, SHARED_CHANGE_RATIO } from './health'
export { contractCoverage, contractNote } from './coverage'
export type { ContractCoverage } from './coverage'
