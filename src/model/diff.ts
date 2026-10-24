/**
 * 版本对比：设计版本相对对比基线（当前版本或上一轮）新增、修改、删除了什么（ADR-0002）；给了血缘（X11、X12，ADR-0025）时
 * 按血缘表述——不在基线里、带 from 的模块读作合并 / 拆分 / 改 ID / 移动，被它们吸收的来源与前缀级联的改 ID 不另列为删除 / 新增，
 * 只因血缘改了端点的关系（重指向合并结果、去重）不计修改。
 *
 * 按实体 ID 对齐，逐字段比较；出处（src / seq）与 designNote 不算修改。
 * 另外为目标模型中的每个模块算出「涉及多少处变更」：子树内的模块增删改，
 * 以及以它（或其后代）为端点的关系、它提供 / 持有的接口与数据结构的增删改，用于在上级层次引导下钻。
 */
import { isMergeResult, lineageKind, lineageSources, mapId, prefixMap, unmapId, type Lineage } from './intent/lineage'
import { CHANGE_KINDS, type Change, type ChangeKind, type EntityKind, type ModelDiff, type ModelIndex } from './types'

const IGNORED = new Set(['src', 'seq', 'designNote', 'roleFrom'])
const ENTITY_ORDER: EntityKind[] = ['module', 'relation', 'interface', 'dataStructure']

export interface DiffOptions {
  /** X11：目标里的模块 ID → 它的基线来源（设计全部草图的 from） */
  lineage?: Lineage
}

export function diffModels(base: ModelIndex, target: ModelIndex, opts: DiffOptions = {}): ModelDiff {
  const diff: ModelDiff = {
    changes: [],
    module: new Map(),
    relation: new Map(),
    interface: new Map(),
    dataStructure: new Map(),
    touched: new Map(),
    counts: Object.fromEntries(CHANGE_KINDS.map(k => [k, 0])) as Record<ChangeKind, number>,
  }
  const lineage: Lineage = opts.lineage ?? new Map()
  const map = prefixMap(lineage)
  const sources = lineageSources(lineage)
  const label = (idx: ModelIndex, entity: EntityKind, id: string): string => {
    if (entity === 'relation') {
      const r = idx.relations.get(id)!
      return `${idx.modules.get(r.from)?.name ?? r.from} → ${idx.modules.get(r.to)?.name ?? r.to}`
    }
    return mapOf(idx, entity).get(id)?.name ?? id
  }
  /** 新端点只是旧端点按血缘换了 ID（或重指向它在目标里的祖先：合并、降级） */
  const lineageOnly = (before: string, after: string) => {
    if (before === after) return true
    const mapped = mapId(map, before)
    return mapped === after || mapped.startsWith(`${after}.`) || (!!target.pathOf.get(mapped)?.includes(after) && target.modules.has(after))
  }

  for (const entity of ENTITY_ORDER) {
    const before = mapOf(base, entity)
    const after = mapOf(target, entity)
    const found: Change[] = []
    const splits = new Map<string, string[]>()
    for (const [id, next] of after) {
      const prev = before.get(id)
      if (prev) {
        let fields = changedFields(prev, next)
        if (entity === 'relation') {
          const a = prev as unknown as { from: string; to: string }
          const b = next as unknown as { from: string; to: string }
          if (lineageOnly(a.from, b.from) && lineageOnly(a.to, b.to)) fields = fields.filter(f => f !== 'from' && f !== 'to')
        }
        if (entity === 'interface') {
          const a = prev as { owner?: string }
          const b = next as { owner?: string }
          if (a.owner && b.owner && lineageOnly(a.owner, b.owner)) fields = fields.filter(f => f !== 'owner')
        }
        if (fields.length) found.push({ entity, id, kind: 'changed', name: label(target, entity, id), fields })
        continue
      }
      if (entity !== 'module') {
        found.push({ entity, id, kind: 'added', name: label(target, entity, id) })
        continue
      }
      const from = lineage.get(id)?.filter(src => base.modules.has(src))
      if (!from?.length) {
        // X12：前缀级联推出的后代（基线里的对应仍在、只是换了前缀）不另列
        const origin = unmapId(map, id)
        if (origin !== id && base.modules.has(origin)) continue
        found.push({ entity, id, kind: 'added', name: label(target, entity, id) })
        continue
      }
      const parent = target.modules.get(id)?.parentId
      const kind = lineageKind(from, {
        shared: src => [...lineage].filter(([x, f]) => f.length === 1 && f[0] === src && !base.modules.has(x)).length * (target.modules.has(src) ? 0 : 1),
        sameParent: src => {
          const p = base.modules.get(src)?.parentId
          return p !== undefined && mapId(map, p) === parent
        },
      })
      if (kind === 'split') {
        splits.set(from[0], [...(splits.get(from[0]) ?? []), id])
        continue
      }
      // 父是合并结果的移动计入合并，不另列（X11）
      if (kind === 'moved' && parent && isMergeResult(lineage, parent)) continue
      found.push({ entity, id, kind, name: label(target, entity, id), from })
    }
    for (const [src, to] of splits) found.push({ entity, id: src, kind: 'split', name: label(base, entity, src), to })
    for (const id of before.keys()) {
      if (after.has(id)) continue
      if (entity === 'module' && (sources.has(id) || (mapId(map, id) !== id && after.has(mapId(map, id))))) continue
      if (entity === 'relation' && absorbedRelation(base, target, id, lineageOnly, x => mapId(map, x))) continue
      found.push({ entity, id, kind: 'removed', name: label(base, entity, id) })
    }
    found.sort((a, b) => CHANGE_KINDS.indexOf(a.kind) - CHANGE_KINDS.indexOf(b.kind))
    for (const c of found) {
      diff.changes.push(c)
      diff.counts[c.kind]++
      if (c.kind === 'split') for (const to of c.to ?? []) diff[entity].set(to, c)
      else if (c.kind !== 'removed') diff[entity].set(c.id, c)
      for (const m of touchedModules(c, base, target)) diff.touched.set(m, (diff.touched.get(m) ?? 0) + 1)
    }
  }
  return diff
}

/** 基线的关系在目标里没有了，但目标里有同类型、两端按血缘对应的关系（重指向合并结果后的去重） */
function absorbedRelation(base: ModelIndex, target: ModelIndex, id: string, lineageOnly: (before: string, after: string) => boolean, mapIdOf: (id: string) => string): boolean {
  const r = base.relations.get(id)!
  if (r.from === r.to) return false
  // 一端随血缘移进了另一端之下（降级、合并）：成了连祖先的关系，随之去掉
  const [a, b] = [mapIdOf(r.from), mapIdOf(r.to)]
  if ((a !== r.from || b !== r.to) && (a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`))) return true
  return [...target.relations.values()].some(
    x => x.type === r.type && lineageOnly(r.from, x.from) && lineageOnly(r.to, x.to) && !(x.from === r.from && x.to === r.to),
  )
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
  const idx = c.kind === 'removed' || c.kind === 'split' ? base : target
  switch (c.entity) {
    case 'module':
      for (const id of c.kind === 'split' ? (c.to ?? []) : [c.id]) addPath(c.kind === 'split' ? target : idx, id, false)
      break
    case 'relation': {
      const r = idx.relations.get(c.id)
      if (!r) break
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
