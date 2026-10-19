/**
 * Validator：跨文件检查引用完整性与结构约束。
 *
 * 不抛异常：有问题的实体被剔除或修剪，返回一份可以安全建索引的模型 + 问题列表。
 * - error：实体被剔除（重复 ID、父模块不存在、关系端点无效……）
 * - warning：实体保留，有问题的引用被去掉，或只是提醒补全内容
 */
import type { ArchModel, Issue, ModuleEntity, RelationEntity, SourceLoc } from './types'

export interface ValidateResult {
  model: ArchModel
  issues: Issue[]
}

export function validate(input: ArchModel): ValidateResult {
  const issues: Issue[] = []
  const err = (code: string, message: string, src?: SourceLoc) => issues.push({ severity: 'error', code, message, ...src })
  const warn = (code: string, message: string, src?: SourceLoc) => issues.push({ severity: 'warning', code, message, ...src })
  const rootId = input.system.id

  // ── 模块：ID 唯一、父模块存在、无环 ──
  const modules = new Map<string, ModuleEntity>()
  for (const m of input.modules) {
    if (m.id === rootId) err('module-id-is-system', `模块 ID「${m.id}」与系统根 ID 相同`, m.src)
    else if (modules.has(m.id)) err('duplicate-module', `模块 ID「${m.id}」重复，首次定义在 ${modules.get(m.id)!.src.file}`, m.src)
    else modules.set(m.id, { ...m })
  }
  // 父模块不存在：剔除，其后代随之失去父模块，反复剔除直到稳定
  let changed = true
  while (changed) {
    changed = false
    for (const m of modules.values()) {
      if (m.parentId !== rootId && !modules.has(m.parentId)) {
        if (!input.modules.some(x => x.id === m.parentId)) {
          err('unknown-parent', `模块「${m.id}」的父模块「${m.parentId}」不存在`, m.src)
        }
        modules.delete(m.id)
        changed = true
      }
    }
  }
  // 父链成环（跨文件用 parent 互相指向时可能出现）
  for (const m of [...modules.values()]) {
    const seen = new Set<string>([m.id])
    let cur = m.parentId
    while (cur !== rootId) {
      if (seen.has(cur)) {
        err('parent-cycle', `模块「${m.id}」的父链成环`, m.src)
        modules.delete(m.id)
        break
      }
      seen.add(cur)
      const next = modules.get(cur)
      if (!next) break
      cur = next.parentId
    }
  }
  // 环上节点删掉后，其后代同样需要剔除
  const reachesRoot = (id: string): boolean => {
    let cur: string | undefined = id
    for (let guard = 0; cur !== undefined && guard <= modules.size; guard++) {
      if (cur === rootId) return true
      cur = modules.get(cur)?.parentId
    }
    return false
  }
  for (const m of [...modules.values()]) if (!reachesRoot(m.id)) modules.delete(m.id)

  // ── 接口、数据结构：ID 唯一 ──
  const interfaces = dedupe(input.interfaces, 'interface', err)
  const dataStructures = dedupe(input.dataStructures, 'data-structure', err)

  // ── 模块内引用 ──
  for (const m of modules.values()) {
    if (m.provides) m.provides = keepKnown(m.provides, interfaces, id => warn('unknown-interface', `模块「${m.id}」引用的接口「${id}」不存在`, m.src))
    if (m.dataStructures) {
      m.dataStructures = keepKnown(m.dataStructures, dataStructures, id => warn('unknown-data-structure', `模块「${m.id}」引用的数据结构「${id}」不存在`, m.src))
    }
    if (!m.responsibility?.trim()) warn('missing-responsibility', `模块「${m.id}」没有填写职责`, m.src)
  }
  for (const x of interfaces.values()) {
    if (x.owner && !modules.has(x.owner)) {
      warn('unknown-owner', `接口「${x.id}」的提供方「${x.owner}」不存在`, x.src)
      x.owner = undefined
    }
  }

  // ── 层 ──
  const childrenOf = new Map<string, ModuleEntity[]>()
  for (const m of modules.values()) {
    const list = childrenOf.get(m.parentId) ?? []
    list.push(m)
    childrenOf.set(m.parentId, list)
  }
  for (const [parentId, kids] of childrenOf) {
    const layers = kids.filter(k => k.kind === 'layer')
    if (layers.length === 0) continue
    if (layers.length !== kids.length) {
      warn('mixed-layer-siblings', `「${parentId}」的子模块中只有一部分是层（kind: layer），不会按分层总览呈现`, layers[0].src)
      continue
    }
    const layerIds = new Set(layers.map(l => l.id))
    for (const l of layers) {
      if (l.order === undefined) warn('layer-missing-order', `层「${l.id}」没有 order，按声明顺序排列`, l.src)
      if (!l.abstraction?.trim()) warn('layer-missing-abstraction', `层「${l.id}」没有填写抽象原则 abstraction`, l.src)
      if (l.mayDependOn) {
        l.mayDependOn = l.mayDependOn.filter(id => {
          if (layerIds.has(id)) return true
          warn('unknown-layer', `层「${l.id}」的 mayDependOn 引用了「${id}」，它不是同级的层`, l.src)
          return false
        })
      }
    }
  }

  // ── 关系 ──
  const isAncestor = (anc: string, id: string): boolean => {
    let cur = modules.get(id)?.parentId
    while (cur !== undefined && cur !== rootId) {
      if (cur === anc) return true
      cur = modules.get(cur)?.parentId
    }
    return false
  }
  const relations: RelationEntity[] = []
  const relationIds = new Set<string>()
  for (const r0 of input.relations) {
    const r = { ...r0, payload: [...r0.payload] }
    if (relationIds.has(r.id)) {
      err('duplicate-relation', `关系 ID「${r.id}」重复`, r.src)
      continue
    }
    const badEnd = [r.from, r.to].find(id => !modules.has(id))
    if (badEnd !== undefined) {
      err('unknown-endpoint', `关系「${r.id}」的端点「${badEnd}」不存在`, r.src)
      continue
    }
    if (r.from === r.to) {
      err('self-relation', `关系「${r.id}」的两端是同一个模块`, r.src)
      continue
    }
    if (isAncestor(r.from, r.to) || isAncestor(r.to, r.from)) {
      err('ancestor-relation', `关系「${r.id}」连接了祖先与后代（${r.from} / ${r.to}），包含关系已由模块树表达`, r.src)
      continue
    }
    if (r.interface && !interfaces.has(r.interface)) {
      warn('unknown-interface', `关系「${r.id}」引用的接口「${r.interface}」不存在`, r.src)
      r.interface = undefined
    }
    r.payload = keepKnown(r.payload, dataStructures, id => warn('unknown-data-structure', `关系「${r.id}」引用的数据结构「${id}」不存在`, r.src))
    relationIds.add(r.id)
    relations.push(r)
  }

  return {
    model: {
      system: input.system,
      modules: [...modules.values()].sort((a, b) => a.seq - b.seq),
      relations,
      interfaces: [...interfaces.values()],
      dataStructures: [...dataStructures.values()],
    },
    issues,
  }
}

function dedupe<T extends { id: string; src: SourceLoc }>(
  items: readonly T[],
  label: string,
  err: (code: string, message: string, src?: SourceLoc) => void,
): Map<string, T> {
  const map = new Map<string, T>()
  for (const x of items) {
    if (map.has(x.id)) err(`duplicate-${label}`, `${label === 'interface' ? '接口' : '数据结构'} ID「${x.id}」重复`, x.src)
    else map.set(x.id, { ...x })
  }
  return map
}

function keepKnown(ids: readonly string[], known: Map<string, unknown>, onUnknown: (id: string) => void): string[] {
  return ids.filter(id => {
    if (known.has(id)) return true
    onUnknown(id)
    return false
  })
}
