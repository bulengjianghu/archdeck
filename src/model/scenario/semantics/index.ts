/**
 * 场景语义：步骤树 → 关系绑定 → 回放计划（F1–F7、S12–S14）。
 *
 * 只回答「这个场景按书写顺序会发生什么」，与层次无关；加载流水线（Validator、Indexer）只依赖这一层，
 * 不依赖场景投影。四层划分里属于 L2 描述层：把场景文本变成可信、可回放的语义模型。
 */
export { bindRelation, RUNTIME_RELATION_TYPES, syncMismatch } from './bind'
export { forEachStep, messagesOf, mapChildren } from './steps'
export { planScenario, firstFrame, pairReturns, querySideEffects } from './plan'
