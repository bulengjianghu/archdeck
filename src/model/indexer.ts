/**
 * Indexer：把校验后的模型整理成按 ID 查询的结构。输入必须来自 validate()。
 */
import type { ArchModel, ModelIndex, ModuleEntity } from './types'

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
  for (const [id, kids] of childrenOf) childrenOf.set(id, sortChildren(kids.map(k => modules.get(k)!)))

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
  }
}

/** 全部是层时按 order（缺省排最后）再按声明顺序；否则按声明顺序 */
function sortChildren(kids: ModuleEntity[]): string[] {
  const allLayers = kids.length > 0 && kids.every(k => k.kind === 'layer')
  const sorted = [...kids].sort((a, b) => {
    if (allLayers) {
      const d = (a.order ?? Infinity) - (b.order ?? Infinity)
      if (d !== 0 && !Number.isNaN(d)) return d
    }
    return a.seq - b.seq
  })
  return sorted.map(k => k.id)
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/** 两个模块路径的最近公共祖先 */
export function lowestCommonAncestor(index: ModelIndex, a: string, b: string): string {
  const pa = index.pathOf.get(a) ?? [index.rootId]
  const pb = index.pathOf.get(b) ?? [index.rootId]
  let i = 0
  while (i < pa.length && i < pb.length && pa[i] === pb[i]) i++
  return pa[i - 1] ?? index.rootId
}

/** 旧路径（根到某模块）中最深的、在本模型中仍存在的模块；都不存在时为根（N5、N11） */
export function nearestExisting(index: ModelIndex, path: readonly string[]): string {
  return [...path].reverse().find(id => index.pathOf.has(id)) ?? index.rootId
}

export function isLayered(index: ModelIndex, parentId: string): boolean {
  const kids = index.childrenOf.get(parentId) ?? []
  return kids.length > 0 && kids.every(k => index.modules.get(k)?.kind === 'layer')
}

export function moduleName(index: ModelIndex, id: string): string {
  return id === index.rootId ? index.model.system.name : (index.modules.get(id)?.name ?? id)
}
