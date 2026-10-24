/**
 * 步骤与关系的对应（S5a、S12、S13）：回放计划与 Validator 共用，保证校验与回放结果一致。
 *
 * 关系是静态的「会这样交互」，消息步骤是运行时关系的一次发生。关系与消息的端点都写在「能表达清楚的最深模块」上，
 * 两者可能写在不同深度，所以「对得上」指关系两端分别是消息两端自身或其祖先（参与者只能是它自己）。
 * 方向：运行时关系的箭头是控制流方向（ADR-0022），call / async 与关系同向；return 与关系相反。
 */
import { RUNTIME_RELATION_TYPES, relationMode } from '../types'
import type { ModelIndex, RelationEntity } from '../types'
import type { MessageEnds, Binding } from './types'

export { RUNTIME_RELATION_TYPES }

/** a 是 id 自身或其祖先 */
function covers(index: ModelIndex, a: string, id: string): boolean {
  if (a === id) return true
  return index.pathOf.get(id)?.includes(a) ?? false
}

/** 关系 r 能否对应这条消息；能则返回方向是否与箭头相反（只有 return） */
function orient(index: ModelIndex, r: RelationEntity, m: MessageEnds): { reverse: boolean } | null {
  const reverse = m.kind === 'return'
  const [from, to] = reverse ? [m.to, m.from] : [m.from, m.to]
  return covers(index, r.from, from) && covers(index, r.to, to) ? { reverse } : null
}

/** 端点自身及其祖先上的全部关系 */
function relationsAround(index: ModelIndex, id: string): Set<string> {
  const out = new Set<string>()
  for (const x of index.pathOf.get(id) ?? [id]) {
    for (const r of index.outRelations.get(x) ?? []) out.add(r)
    for (const r of index.inRelations.get(x) ?? []) out.add(r)
  }
  return out
}

/**
 * S19（ADR-0029）：消息形态与关系类型不一致——查询、委托与未分类按 mode（同步为 call、异步为 async；查询缺省同步，可异步，T0 裁决 1），
 * 通知一律 async；return 与流不比
 */
export const syncMismatch = (r: RelationEntity, kind: MessageEnds['kind']): boolean =>
  kind !== 'return' && r.type !== 'streams' && (relationMode(r) === 'async') !== (kind === 'async')

export function bindRelation(index: ModelIndex, m: MessageEnds): Binding {
  if (m.relation) {
    const r = index.relations.get(m.relation)
    if (!r) return { inferred: false, reverse: false }
    if (!RUNTIME_RELATION_TYPES.includes(r.type)) return { relation: r.id, inferred: false, reverse: false, issue: 'not-runtime' }
    const o = orient(index, r, m)
    return o ? { relation: r.id, inferred: false, reverse: o.reverse } : { relation: r.id, inferred: false, reverse: false, issue: 'mismatch' }
  }
  if (m.from === m.to) return { inferred: false, reverse: false }

  const around = relationsAround(index, m.from)
  const between = [...relationsAround(index, m.to)].filter(id => around.has(id)).map(id => index.relations.get(id)!)
  const linked = between.filter(r => (covers(index, r.from, m.from) && covers(index, r.to, m.to)) || (covers(index, r.from, m.to) && covers(index, r.to, m.from)))
  const candidates = linked.filter(r => RUNTIME_RELATION_TYPES.includes(r.type) && orient(index, r, m))
  // S13：两端之间恰好一条同向（return 反向）的交互关系即认定；恰好连在两端上的优先于连在祖先上的
  // S19：候选多条时，消息形态与关系类型一致（syncMismatch 为假）的恰好一条也认定；return 不比
  const unique = (list: RelationEntity[]) => {
    if (list.length === 1) return list[0]
    if (m.kind === 'return') return undefined
    const same = list.filter(r => !syncMismatch(r, m.kind))
    return same.length === 1 ? same[0] : undefined
  }
  const exact = candidates.filter(r => (r.from === m.from && r.to === m.to) || (r.from === m.to && r.to === m.from))
  const pick = exact.length ? unique(exact) : unique(candidates)
  if (pick) return { relation: pick.id, inferred: true, reverse: orient(index, pick, m)!.reverse }
  return { inferred: false, reverse: false, ...(linked.length === 0 ? { issue: 'unrelated' as const } : {}) }
}
