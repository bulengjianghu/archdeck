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
  undescribedDeps,
  portEntry,
  portPanel,
  portIssues,
  coresOf,
  isCoreBetween,
  unclassifiedRelations,
} from './facts'
export { judge, evaluateRules, rulesFor, exposesMatch, exposesText, violationKey, rulesOf } from './rules'
export type { EntryOf, DepProbe, Judgement, ModuleRules } from './rules'
export { stronglyConnected, valueDeps, moduleCycles, fileCycles, cyclicityOf } from './cycles'
export { governanceReport, gateIssues, makeBaseline, entryResolver } from './report'
export { levelFacts, depsBetween, nodeOf } from './level'
export type { DepOverlay, EdgeFact, LevelFacts } from './level'
export { moduleBrief, describeModule, locateFile, checkDependency } from './query'
export type { ModuleBrief, ModuleDetail, FileStatus, CheckTarget, CheckResult, PairCheck, CycleImpact } from './query'
export { portTriad } from './ports'
export { sharedSuggestions, sharedReverse, sharedHostOf, SHARED_NAME_HINTS } from './roles'
export { summarizeLedger } from './ledger'
export type { LedgerSummary } from './ledger'
export { stepEvidence, scenarioEvidence, interfaceName, EVIDENCE_LIMIT } from './evidence'
