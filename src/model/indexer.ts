/**
 * Indexer：把校验后的模型整理成按 ID 查询的结构。输入必须来自 validate()。
 */
import type { ArchModel, ModelIndex, ModuleEntity, StratumEntity } from './types'
import { messagesOf } from './scenario/semantics'

export function buildIndex(model: ArchModel): ModelIndex {
  const rootId = model.system.id
  const modules = new Map(model.modules.map(m => [m.id, m]))
  const childrenOf = new Map<string, string[]>([[rootId, []]])
  for (const m of model.modules) {
    childrenOf.set(m.id, childrenOf.get(m.id) ?? [])
    const list = childrenOf.get(m.parentId) ?? []
    list.push(m.id)
    childrenOf.set(m.parentId, list)
  }
  // ST（ADR-0052）：层是父模块对子模块的分类，不是节点
  const strata = new Map<string, StratumEntity[]>()
  const stratumOf = new Map<string, StratumEntity>()
  for (const s of model.strata ?? []) {
    push(strata, s.parent, s)
    for (const id of s.members) stratumOf.set(id, s)
  }
  for (const list of strata.values()) list.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || 0)
  for (const [id, kids] of childrenOf) childrenOf.set(id, sortChildren(kids.map(k => modules.get(k)!), strata.get(id)))

  const pathOf = new Map<string, string[]>([[rootId, [rootId]]])
  const resolvePath = (id: string): string[] => {
    const cached = pathOf.get(id)
    if (cached) return cached
    const path = [...resolvePath(modules.get(id)!.parentId), id]
    pathOf.set(id, path)
    return path
  }
  for (const m of model.modules) resolvePath(m.id)

  const outRelations = new Map<string, string[]>()
  const inRelations = new Map<string, string[]>()
  for (const r of model.relations) {
    push(outRelations, r.from, r.id)
    push(inRelations, r.to, r.id)
  }

  const scenarios = new Map(model.scenarios.map(s => [s.id, s]))
  const scenariosOf = new Map<string, string[]>([[rootId, model.scenarios.map(s => s.id)]])
  const triggeredBy = new Map<string, string[]>()
  for (const sc of model.scenarios) {
    const messages = messagesOf(scenarios, sc.id)
    // R4：有帧端点在其子树内的场景 → 端点的全部祖先（根已含全部场景）
    const touched = new Set<string>()
    for (const m of messages) for (const id of [m.msg.from, m.msg.to]) for (const p of pathOf.get(id) ?? []) touched.add(p)
    touched.delete(rootId)
    for (const id of touched) push(scenariosOf, id, sc.id)
    // A6：触发者 = 第一条消息的发送方
    const first = messages[0]?.msg.from
    if (first !== undefined && model.actors.some(a => a.id === first)) push(triggeredBy, first, sc.id)
  }

  return {
    model,
    rootId,
    modules,
    relations: new Map(model.relations.map(r => [r.id, r])),
    interfaces: new Map(model.interfaces.map(x => [x.id, x])),
    dataStructures: new Map(model.dataStructures.map(x => [x.id, x])),
    childrenOf,
    pathOf,
    outRelations,
    inRelations,
    actors: new Map(model.actors.map(a => [a.id, a])),
    scenarios,
    scenariosOf,
    triggeredBy,
    strata,
    stratumOf,
  }
}

/** 触发者（A6）：第一条消息的发送方，模块或参与者；场景没有消息时为 undefined */
export function triggerOf(index: ModelIndex, scenarioId: string): string | undefined {
  return messagesOf(index.scenarios, scenarioId)[0]?.msg.from
}

/** 声明了分层时按层序（ST、O2）再按声明顺序；否则按声明顺序 */
function sortChildren(kids: ModuleEntity[], strata?: readonly StratumEntity[]): string[] {
  const rank = new Map<string, number>((strata ?? []).flatMap((s, i) => s.members.map(id => [id, i] as const)))
  const sorted = [...kids].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.seq - b.seq)
  return sorted.map(k => k.id)
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/** 旧路径（根到某模块）中最深的、在本模型中仍存在的模块；都不存在时为根（N5、N11） */
export function nearestExisting(index: ModelIndex, path: readonly string[]): string {
  return [...path].reverse().find(id => index.pathOf.has(id)) ?? index.rootId
}

/** ST（ADR-0052）：父模块声明了分层 */
export function isLayered(index: ModelIndex, parentId: string): boolean {
  return !!index.strata.get(parentId)?.length
}

/** ST：父模块的层（按 order）；没有声明时为空 */
export function strataOf(index: ModelIndex, parentId: string): readonly StratumEntity[] {
  return index.strata.get(parentId) ?? []
}

/** ST：子模块在父模块下所属的层 */
export function stratumOf(index: ModelIndex, childId: string): StratumEntity | undefined {
  return index.stratumOf.get(childId)
}
