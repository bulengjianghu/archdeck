/** 场景投影：回放计划 → 回放路径 → 帧的层次投影 → 参与查询 / 时序模型（docs/architecture/scenario.md） */
export type { MessageEnds, Binding, FragmentKind, FragmentTag, Frame, BranchPoint, PlanNode, ScenarioPlan, ReturnPairs, Choices, ResolvedPath, RouteItem, Lanes, Landing, VisibleLanding, VisibleMessage, ScenarioLevelView, FrameStatus, ParticipationTarget, Participation, OutlineOption, OutlineNode, SequenceParticipant, SequenceMessage, SequenceFragment, SequenceModel } from './types'
export { bindRelation, RUNTIME_RELATION_TYPES } from './bind'
export { forEachStep, messagesOf, mapChildren } from './steps'
export { planScenario, firstFrame, pairReturns } from './plan'
export { resolvePath, chooseBranch, choicesFor, choicesForBranch, pointPrefix, routeOf, choiceList, choicesFromList } from './path'
export {
  landFrame,
  linearize,
  projectScenario,
  currentMessage,
  walkedCount,
  stepAfter,
  stepBefore,
  landing,
  scenarioHome,
  frameHome,
  stageEnds,
} from './level'
export { participation, scenarioModules } from './participation'
export { outlineScenario } from './outline'
export { buildSequence, lanesOf } from './sequence'
