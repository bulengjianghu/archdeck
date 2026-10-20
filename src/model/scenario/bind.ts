/**
 * 步骤与关系的对应（S5a、S12、S13）：回放计划与 Validator 共用，保证校验与回放结果一致。
 *
 * 关系是静态的「会这样交互」，消息步骤是运行时关系的一次发生。关系与消息的端点都写在「能表达清楚的最深模块」上，
 * 两者可能写在不同深度，所以「对得上」指关系两端分别是消息两端自身或其祖先（参与者只能是它自己）。
 * 方向：call / async 沿控制流 from → to；event 关系的箭头是订阅方 → 发布方，消息由发布方发出，与箭头相反；
 * return 再反一次。
 */
import type { MessageKind, ModelIndex, RelationEntity, RelationType } from '../types'

/** 运行时关系：步骤只对应这三类（S12） */
export const RUNTIME_RELATION_TYPES: readonly RelationType[] = ['calls', 'dataflow', 'event']

export interface MessageEnds {
  kind: MessageKind
  from: string
  to: string
  relation?: string
}

export interface Binding {
  /** 对应的关系 ID；没有对应时不给 */
  relation?: string
  /** 没写 relation、由 S13 推断得出 */
  inferred: boolean
  /** 消息方向与关系箭头相反（event、return，P10） */
  reverse: boolean
  /**
   * 与结构不一致之处（供 Validator 报告）：
   * - mismatch：引用了关系但端点或方向对不上（error）
   * - not-runtime：引用了 depends / implements（error）
   * - unrelated：没写 relation、推断不到，且两端结构上没有任何关系（warning）
   */
  issue?: 'mismatch' | 'not-runtime' | 'unrelated'
}

/** a 是 id 自身或其祖先 */
function covers(index: ModelIndex, a: string, id: string): boolean {
  if (a === id) return true
  return index.pathOf.get(id)?.includes(a) ?? false
}

const expectsReverse = (type: RelationType, kind: MessageKind) => (type === 'event') !== (kind === 'return')

/** 关系 r 能否对应这条消息；能则返回方向是否与箭头相反 */
function orient(index: ModelIndex, r: RelationEntity, m: MessageEnds): { reverse: boolean } | null {
  const reverse = expectsReverse(r.type, m.kind)
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
  // S13：两端之间恰好一条运行时关系即认定；恰好连在两端上的优先于连在祖先上的
  const exact = candidates.filter(r => (r.from === m.from && r.to === m.to) || (r.from === m.to && r.to === m.from))
  const pick = exact.length === 1 ? exact[0] : exact.length === 0 && candidates.length === 1 ? candidates[0] : undefined
  if (pick) return { relation: pick.id, inferred: true, reverse: orient(index, pick, m)!.reverse }
  return { inferred: false, reverse: false, ...(linked.length === 0 ? { issue: 'unrelated' as const } : {}) }
}
