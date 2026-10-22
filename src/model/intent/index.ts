/** 意图：草图核验、归档判定与指纹比对（X1–X6，docs/architecture/governance.md §4.3） */
export * from './types'
export { compareOwned } from './owned'
export { flattenSketch, sketchLifetime, sketchCheck, parseDesignSketches, checkSketches } from './check'
export type { FlatSketchModule, SketchCheckOptions } from './check'
export { archiveVerdict, reviewedEntries } from './lifecycle'
