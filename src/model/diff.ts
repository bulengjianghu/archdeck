/**
 * 版本对比：设计版本相对对比基线（当前版本或上一轮）新增、修改、删除了什么（ADR-0002）。
 *
 * 按实体 ID 对齐，逐字段比较；出处（src / seq）与 designNote 不算修改。
 * 另外为目标模型中的每个模块算出「涉及多少处变更」：子树内的模块增删改，
 * 以及以它（或其后代）为端点的关系、它提供 / 持有的接口与数据结构的增删改，用于在上级层次引导下钻。
 */
import type { ModelIndex } from './types'

export type ChangeKind = 'added' | 'changed' | 'removed'
export type EntityKind = 'module' | 'relation' | 'interface' | 'dataStructure'

export interface Change {
  entity: EntityKind
  id: string
  kind: ChangeKind
  /** 显示名；关系为「from → to」 */
  name: string
  /** 修改了哪些字段（字段名，见 FIELD_LABELS） */
  fields?: string[]
}

export interface ModelDiff {
  /** 全部变更，按实体类别、变更类别、声明顺序排列 */
  changes: Change[]
  /** 目标模型中存在的实体（新增 / 修改）按 ID 查询 */
  module: Map<string, Change>
  relation: Map<string, Change>
  interface: Map<string, Change>
  dataStructure: Map<string, Change>
  /** 目标模型中的模块 ID → 涉及它（及其子树）的变更条数，不含模块自身的增改 */
  touched: Map<string, number>
  counts: Record<ChangeKind, number>
}

export const FIELD_LABELS: Record<string, string> = {
  name: '名称',
  parentId: '位置',
  kind: '类别',
  status: '状态',
  core: '核心',
  responsibility: '职责',
  principle: '实现原理',
  dataStructures: '数据结构',
  provides: '对外接口',
  codeRefs: '代码引用',
  docRefs: '文档引用',
  owner: '负责人 / 提供方',
  tags: '标签',
  order: '层序',
  abstraction: '抽象原则',
  includes: '应包含',
  excludes: '不应包含',
  mayDependOn: '可依赖的层',
  from: '起点',
  to: '终点',
  type: '类型',
  mode: '同步 / 异步',
  interface: '经由接口',
  payload: '交换数据',
  description: '说明',
  signature: '签名',
  semantics: '语义',
  definition: '定义',
  invariants: '不变量',
}

const IGNORED = new Set(['src', 'seq', 'designNote'])
const ENTITY_ORDER: EntityKind[] = ['module', 'relation', 'interface', 'dataStructure']
const KIND_ORDER: ChangeKind[] = ['added', 'changed', 'removed']

export function diffModels(base: ModelIndex, target: ModelIndex): ModelDiff {
  const diff: ModelDiff = {
    changes: [],
    module: new Map(),
    relation: new Map(),
    interface: new Map(),
    dataStructure: new Map(),
    touched: new Map(),
    counts: { added: 0, changed: 0, removed: 0 },
  }
  const label = (idx: ModelIndex, entity: EntityKind, id: string): string => {
    if (entity === 'relation') {
      const r = idx.relations.get(id)!
      return `${idx.modules.get(r.from)?.name ?? r.from} → ${idx.modules.get(r.to)?.name ?? r.to}`
    }
    return mapOf(idx, entity).get(id)?.name ?? id
  }

  for (const entity of ENTITY_ORDER) {
    const before = mapOf(base, entity)
    const after = mapOf(target, entity)
    const found: Change[] = []
    for (const [id, next] of after) {
      const prev = before.get(id)
      if (!prev) found.push({ entity, id, kind: 'added', name: label(target, entity, id) })
      else {
        const fields = changedFields(prev, next)
        if (fields.length) found.push({ entity, id, kind: 'changed', name: label(target, entity, id), fields })
      }
    }
    for (const id of before.keys()) if (!after.has(id)) found.push({ entity, id, kind: 'removed', name: label(base, entity, id) })
    found.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
    for (const c of found) {
      diff.changes.push(c)
      diff.counts[c.kind]++
      if (c.kind !== 'removed') diff[entity].set(c.id, c)
      for (const m of touchedModules(c, base, target)) diff.touched.set(m, (diff.touched.get(m) ?? 0) + 1)
    }
  }
  return diff
}

function mapOf(idx: ModelIndex, entity: EntityKind): Map<string, { name?: string }> {
  switch (entity) {
    case 'module':
      return idx.modules
    case 'relation':
      return idx.relations as Map<string, { name?: string }>
    case 'interface':
      return idx.interfaces
    case 'dataStructure':
      return idx.dataStructures
  }
}

function changedFields(prev: object, next: object): string[] {
  const a = prev as Record<string, unknown>
  const b = next as Record<string, unknown>
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].filter(k => !IGNORED.has(k) && !sameValue(a[k], b[k]))
}

/** 缺省与空数组视为相同，避免只因写法不同报修改 */
function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === undefined || (Array.isArray(v) && v.length === 0) ? null : v)
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
}

/** 一处变更涉及目标模型中的哪些模块（去重） */
function touchedModules(c: Change, base: ModelIndex, target: ModelIndex): Set<string> {
  const out = new Set<string>()
  // 只取在目标模型中仍存在的模块；includeSelf 为 false 时不含端点本身
  const addPath = (idx: ModelIndex, moduleId: string, includeSelf: boolean) => {
    const path = idx.pathOf.get(moduleId) ?? []
    for (const id of includeSelf ? path : path.slice(0, -1)) if (target.pathOf.has(id)) out.add(id)
  }
  const idx = c.kind === 'removed' ? base : target
  switch (c.entity) {
    case 'module':
      addPath(idx, c.id, false)
      break
    case 'relation': {
      const r = idx.relations.get(c.id)!
      addPath(idx, r.from, true)
      addPath(idx, r.to, true)
      break
    }
    case 'interface':
    case 'dataStructure': {
      const owner = c.entity === 'interface' ? idx.interfaces.get(c.id)?.owner : undefined
      if (owner) addPath(idx, owner, true)
      for (const m of idx.modules.values()) {
        const refs = c.entity === 'interface' ? m.provides : m.dataStructures
        if (refs?.includes(c.id)) addPath(idx, m.id, true)
      }
      break
    }
  }
  return out
}
