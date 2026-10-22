/** 演化事实（docs/architecture/evolution.md）：git 历史提升为模块的热度与时间耦合 */
export * from './types'
export {
  isFixSubject,
  historyOptions,
  heatOf,
  heatValue,
  heatCount,
  coupleId,
  coupleEnds,
  touchedModules,
  moduleHistory,
  couplings,
  evolutionStats,
  hotspots,
  isolatedCouplings,
  couplingsOf,
  couplingBetween,
} from './history'
export { heatTiers, levelEvolution } from './level'
