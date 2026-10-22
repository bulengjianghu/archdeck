/** 意图：草图核验、归档判定与指纹比对（X1–X6）；草图编辑与校验（X7，ADR-0024）。docs/architecture/governance.md §4.4 */
export * from './types'
export { compareOwned } from './owned'
export { flattenSketch, sketchLifetime, sketchCheck, sketchContradictions, parseDesignSketches, checkSketches } from './check'
export type { FlatSketchModule, SketchCheckOptions } from './check'
export { archiveVerdict, sketchModules } from './lifecycle'
export { applyEdit, sketchText, idImpact, seedSketch, locate, locateAll, knownModules, moduleId, relationId, interfaceId, kebab, shortName, ID_PATTERN } from './edit'
export type { LocatedModule } from './edit'
export { validateSketch } from './validate'
