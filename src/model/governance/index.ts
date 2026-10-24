export * from './types'
export {
  depKey,
  within,
  related,
  liftDeps,
  hostOf,
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
export { stronglyConnected, valueDeps, moduleCycles, fileCycles, cyclicityOf } from './cycles'
export { governanceReport, gateIssues, makeBaseline, entryResolver } from './report'
export { levelFacts, levelAssembly, depsBetween, nodeOf } from './level'
export type { AssemblyOverlay, DepOverlay, EdgeFact, LevelAssembly, LevelFacts } from './level'
export {
  structureView,
  levelDeps,
  chipDeps,
  allowedDeps,
  impactOf,
  levelImpact,
  structureMetrics,
  moduleMetrics,
  againstStability,
  againstStabilityOf,
  structureEdgeFiles,
  isolatedInteractions,
  hasStructureEdge,
  interactionEdgeBetween,
  ruleBasis,
  fileKinds,
  tierOf,
  stabilityBand,
  STABLE_DIRECTION_THRESHOLD,
  TOP_CONTRIBUTORS,
  ALLOWED_ONLY_NOTE,
  NO_ALLOWED_NOTE,
  NO_FACTS_REASON,
} from './structure'
export { moduleBrief, describeModule, locateFile, checkDependency } from './query'
export type { ModuleBrief, ModuleDetail, FileStatus, CheckTarget, CheckResult, PairCheck, CycleImpact } from './query'
export { sharedSuggestions, sharedReverse, sharedHostOf, SHARED_NAME_HINTS } from './roles'
export { summarizeLedger } from './ledger'
export type { LedgerSummary } from './ledger'
export { stepEvidence, scenarioEvidence, interfaceName, EVIDENCE_LIMIT } from './evidence'
export { classifyRelation, classifyRelations, interactionDescription, nameLean, returnShapeOf, signatureReturns } from './classify'
export type { CallSiteFact, Classification, ClassifiedType, ClassifyCode, ClassifyConfidence, DeclFact, FileStateFact, ReturnShape } from './classify'
