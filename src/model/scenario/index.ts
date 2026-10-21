/** 场景投影：回放计划 → 回放路径 → 帧的层次投影 → 参与查询 / 时序模型（docs/architecture/scenario.md） */
export { bindRelation, RUNTIME_RELATION_TYPES } from './bind'
export type { Binding, MessageEnds } from './bind'
export { forEachStep, messagesOf, mapChildren } from './steps'
export { planScenario, firstFrame, pairReturns } from './plan'
export type { BranchPoint, Frame, FragmentKind, FragmentTag, PlanNode, ReturnPairs, ScenarioPlan } from './plan'
export { resolvePath, chooseBranch, choicesFor, choicesForBranch, pointPrefix, routeOf, choiceList, choicesFromList } from './path'
export type { Choices, ResolvedPath, RouteItem } from './path'
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
export type { Landing, Lanes, VisibleLanding, VisibleMessage, ScenarioLevelView, FrameStatus } from './level'
export { participation, scenarioModules } from './participation'
export type { Participation, ParticipationTarget } from './participation'
export { outlineScenario } from './outline'
export type { OutlineNode, OutlineOption } from './outline'
export { buildSequence } from './sequence'
export type { SequenceModel, SequenceMessage, SequenceFragment, SequenceParticipant } from './sequence'
