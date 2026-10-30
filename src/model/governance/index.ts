export * from './types'
export {
  depKey,
  within,
  related,
  liftDeps,
  hostOf,
  isTarget,
  confirmRelations,
  confirmImplementers,
  heritageFacts,
  assemblyFacts,
  portOwner,
  plainInteraction,
  contractNames,
  contractEvidence,
  unconfirmedWarns,
  implementerWarns,
  unconfirmedCode,
  unconfirmedReason,
  implementerReason,
  covers,
  coveringRelations,
  implementsInto,
  undescribedDeps,
  coresOf,
  isCoreBetween,
  unclassifiedRelations,
} from './facts'
export { portEntry, portPanel, portIssues } from './ports'
export { judge, evaluateRules, rulesFor, exposesMatch, exposesText, violationKey, rulesOf } from './rules'
export type { EntryOf, DepProbe, Judgement, ModuleRules } from './rules'
export { gradeBundles, exceptionsOf, forcedExceptions, type BundleGrading, type ExceptionKind, type GradeInput, type LineGrade } from './grades'
export { stronglyConnected, valueDeps, moduleCycles, fileCycles, cyclicityOf } from './cycles'
export { governanceReport, gateIssues, makeBaseline, entryResolver } from './report'
export { levelFacts, levelAssembly, depsBetween, nodeOf, levelValueDeps } from './level'
export { strataMetrics, strataFindings, strataIssues, placeSuggestion, STRATA_ORDER_TOLERANCE, type StratumMetrics, type StrataFinding, type PlaceSuggestion } from './strata'
export { tierNodes, tierNoteText, foldSpanText, FOLD_SPAN_WARN, type FoldSpan, levelTiers, layerUpward, layerDrift, type LayerDrift, splitSignals, tierIssues, tierFindings, tierView, tierable, isInversion, BAND_MIN_NODES, BAND_MIN_TIERS } from './tiers'
export type { TierFinding, Tiering, LevelTiers, UpwardEdge, TierNote, SplitSignals } from './tiers'
export type { AssemblyOverlay, DepOverlay, EdgeFact, LevelAssembly, LevelFacts } from './level'
export {
  structureView,
  levelDeps,
  chipDeps,
  allowedDeps,
  contractOf,
  cuttableDep,
  impactOf,
  levelImpact,
  type LevelImpactHit,
  structureMetrics,
  moduleMetrics,
  againstStability,
  againstStabilityOf,
  isolatedInteractions,
  hasStructureEdge,
  interactionEdgeBetween,
  ruleBasis,
  tierOf,
  stabilityBand,
  STABLE_DIRECTION_THRESHOLD,
  TOP_CONTRIBUTORS,
  ALLOWED_ONLY_NOTE,
  NO_ALLOWED_NOTE,
  NO_FACTS_REASON,
} from './structure'
export {
  surfaceContext,
  surfaceOf,
  surfaceMetrics,
  surfaceWidths,
  surfaceIssues,
  bypassesOf,
  gateOf,
  gateModule,
  elementSlots,
  slotKey,
  formOf,
  fileForms,
  elementTier,
  elementKindOf,
  strongerForm,
  strongerTier,
} from './surface'
export type { SurfaceContext, SurfaceGate, EdgeSlot } from './surface'
export {
  moduleElementEdges,
  carrierTemplate,
  carrierOf,
  carriersOf,
  carrierGap,
  carrierNote,
  interactionBundle,
} from './carrier'
export { moduleBrief, describeModule, locateFile, checkDependency, collaborationsOf } from './query'
export type { ModuleBrief, ModuleDetail, FileStatus, CheckTarget, CheckResult, PairCheck, CycleImpact, Collaboration } from './query'
export { sharedSuggestions, sharedReverse, sharedHostOf, SHARED_NAME_HINTS } from './roles'
export { summarizeLedger } from './ledger'
export type { LedgerSummary } from './ledger'
export { stepEvidence, scenarioEvidence, interfaceName, EVIDENCE_LIMIT } from './evidence'
export { classifyRelation, classifyRelations, interactionDescription, nameLean, returnShapeOf, signatureReturns } from './classify'
export type { CallSiteFact, Classification, ClassifiedType, ClassifyCode, ClassifyConfidence, DeclFact, FileStateFact, ReturnShape } from './classify'
export { bundleHandles, elementOwner, elementSub, interfaceOwner, subUnder } from './carrier'
export type { BundleHandles, HandleGroup, HandleItem } from './carrier'
