/** 意图：草图核验、两个对比、归档判定与指纹比对（X1–X6、X17）；草图编辑与校验（X7、X9–X20，ADR-0024、ADR-0025）。docs/architecture/governance.md §4.4 */
export * from './types'
export { compareOwned } from './owned'
export {
  flattenSketch,
  sketchLifetime,
  sketchCheck,
  sketchContradictions,
  parseDesignSketches,
  checkSketches,
  compareSketch,
  compareDesign,
  changeSummary,
  byDesign,
} from './check'
export type { FlatSketchModule, SketchCheckOptions, CompareMode, CompareOptions, SketchChange, SketchComparison } from './check'
export { archiveVerdict, sketchModules } from './lifecycle'
export {
  applyEdit,
  applyDesignEdit,
  sketchesUnder,
  sketchText,
  idImpact,
  seedFromBaseline,
  deriveChildSketch,
  gridLayout,
  referenceNodes,
  referenceRelations,
  foldReference,
  ROOT_BAND_X0,
  ROOT_BAND_GAP,
  ROOT_BAND_COLS,
  ROOT_BAND_PAD,
  ROOT_BAND_ROW,
  dropOrphanReferences,
  locate,
  locateAll,
  knownModules,
  moduleId,
  relationId,
  interfaceId,
  kebab,
  shortName,
  mountOf,
  isRootSketch,
  ID_PATTERN,
} from './edit'
export type { LocatedModule, SeedOptions } from './edit'
export { validateSketch, SKETCH_SOFT_LIMIT } from './validate'
export type { ValidateContext } from './validate'
export { mountScope, underMount, looksLocal } from './scope'
export type { MountScope } from './scope'
export { sketchLineage, lineageSources, isMergeResult, prefixMap, mapId, unmapId, lineageKind, lineagePhrase } from './lineage'
export type { Lineage, LineageKind } from './lineage'
