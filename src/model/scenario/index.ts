/**
 * 场景投影：回放计划 → 回放路径 → 帧的层次投影 → 参与查询 / 时序模型（docs/architecture/scenario.md）
 *
 * 语义（步骤、绑定、回放计划）在 `./semantics`（L2 描述层），本入口只把两者合起来对外；
 * 投影部分不反向依赖加载流水线。
 */
export type { MessageEnds, Binding, FragmentKind, FragmentTag, Frame, BranchPoint, PlanNode, ScenarioPlan, ReturnPairs, Choices, ResolvedPath, RouteItem, Lanes, Landing, VisibleLanding, VisibleMessage, ScenarioLevelView, FrameStatus, ParticipationTarget, Participation, OutlineOption, OutlineNode, SequenceParticipant, SequenceMessage, SequenceFragment, SequenceModel, QuerySideEffect } from './types'
export { bindRelation, relationScenarios, RUNTIME_RELATION_TYPES, syncMismatch, forEachStep, messagesOf, mapChildren, planScenario, firstFrame, pairReturns, querySideEffects } from './semantics'
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
