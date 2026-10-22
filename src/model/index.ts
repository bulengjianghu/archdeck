/** 模型层入口：文本 → 校验后的索引。模型层不依赖 Vue / DOM / 布局库。 */
import { load } from './load'
import { validate } from './validate'
import { buildIndex } from './indexer'
import type { Issue, ModelIndex, RawFile } from './types'

export * from './types'
export * from './design'
export * from './names'
export type { ProjectSummary, ProjectHealth } from './project-summary'
export { load } from './load'
export { validate } from './validate'
export { buildIndex, nearestExisting, isLayered, triggerOf } from './indexer'
export * from './scenario'
export * from './source'
export * from './governance'
export * from './rework'
export * from './review'
export * from './evolution'
export { projectLevel, mapEndpoint, nearestVisibleLevel, edgeId, hierarchyKey, compareKeys, lowestCommonAncestor, DEFAULT_PROJECT_OPTIONS } from './project'
export type { Endpoint } from './project'
export { diffModels } from './diff'

export interface LoadedModel {
  index: ModelIndex
  issues: Issue[]
}

export function loadModel(files: readonly RawFile[]): LoadedModel {
  const loaded = load(files)
  const checked = validate(loaded.model)
  return { index: buildIndex(checked.model), issues: [...loaded.issues, ...checked.issues] }
}
