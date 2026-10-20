/** 模型层入口：文本 → 校验后的索引。模型层不依赖 Vue / DOM / 布局库。 */
import { load } from './load'
import { validate } from './validate'
import { buildIndex } from './indexer'
import type { Issue, ModelIndex, RawFile } from './types'

export * from './types'
export { load } from './load'
export { validate } from './validate'
export { buildIndex, lowestCommonAncestor, nearestExisting, isLayered, moduleName, triggerOf } from './indexer'
export * from './scenario'
export { projectLevel, mapEndpoint, nearestVisibleLevel, edgeId, DEFAULT_PROJECT_OPTIONS } from './project'
export type { Endpoint } from './project'
export { diffModels, FIELD_LABELS } from './diff'
export type { Change, ChangeKind, EntityKind, ModelDiff } from './diff'

export interface LoadedModel {
  index: ModelIndex
  issues: Issue[]
}

export function loadModel(files: readonly RawFile[]): LoadedModel {
  const loaded = load(files)
  const checked = validate(loaded.model)
  return { index: buildIndex(checked.model), issues: [...loaded.issues, ...checked.issues] }
}
