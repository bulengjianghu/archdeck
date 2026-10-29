/**
 * 步骤的代码证据（S16）：一步消息从已有的代码事实里找候选调用点（文件:行）并分四档。
 * 与关系的证实（K5）同一口径：参与者、via、目标态、同宿主不判定；场景投影只提供帧，这里只用它的类型。
 */
import type { ModelIndex } from '../types'
import type { Frame, ScenarioPlan } from '../scenario/types'
import { moduleFiles, type SourceOwnership } from '../source'
import { hostOf } from './facts'
import type { EntryOf } from './types'
import { EVIDENCE_LEVELS, type EvidenceLevel, type FileDep, type ScenarioEvidence, type StepEvidence } from './types'

/** 按模块依赖时最多列几条 */
export const EVIDENCE_LIMIT = 10

const IDENT = /^[A-Za-z_$][\w$]*$/

/** S16：接口名——接口的 name 去掉括号与泛型后是标识符时用它，否则取 ID 的最后一段 */
export function interfaceName(index: ModelIndex, id: string): string {
  const name = (index.interfaces.get(id)?.name ?? '').replace(/[(<].*$/s, '').trim()
  return IDENT.test(name) ? name : id.slice(id.lastIndexOf('.') + 1)
}

/** 模块或其祖先是目标态 */
const isTarget = (index: ModelIndex, id: string) => (index.pathOf.get(id) ?? []).some(p => index.modules.get(p)?.status === 'target')

/**
 * 端点的文件：子树的归属文件，加上它在两端最近公共祖先之下的各级祖先的直接归属文件（代码经祖先的文件进出——统一入口、概念子模块，同 K5）；
 * 都没有时取宿主的直接归属文件（K5a）
 */
function endFiles(index: ModelIndex, own: SourceOwnership, id: string, other: string): { files: Set<string>; host?: string } {
  const path = index.pathOf.get(id) ?? [id]
  const otherPath = index.pathOf.get(other) ?? [other]
  let common = 0
  while (common < path.length && path[common] === otherPath[common]) common++
  const files = [...moduleFiles(index, own, id), ...path.slice(common, -1).flatMap(p => own.direct.get(p) ?? [])]
  if (files.length) return { files: new Set(files) }
  const host = hostOf(index, own.direct, id)
  return { files: new Set(host ? own.direct.get(host) : []), host }
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every(x => b.has(x))

/** 候选排序：直接导入目标文件的在前，再按依赖方文件、行号 */
const order = (a: FileDep, b: FileDep) =>
  Number(a.via !== a.to) - Number(b.via !== b.to) || a.from.localeCompare(b.from) || a.line - b.line || a.to.localeCompare(b.to)

/** S16：一步消息的候选调用点与证据等级 */
export function stepEvidence(
  frame: Pick<Frame, 'kind' | 'from' | 'to' | 'interface' | 'relation'>,
  index: ModelIndex,
  own: SourceOwnership,
  deps: readonly FileDep[],
  entryOf?: EntryOf,
): StepEvidence {
  const { from, to } = frame
  if (index.actors.has(from) || index.actors.has(to) || !index.modules.has(from) || !index.modules.has(to)) return { level: 'skipped', reason: 'actor' }
  const relation = frame.relation ? index.relations.get(frame.relation) : undefined
  if (relation?.via) return { level: 'skipped', reason: 'via', via: relation.via }
  if (isTarget(index, from) || isTarget(index, to)) return { level: 'skipped', reason: 'target' }
  const a = endFiles(index, own, from, to)
  const b = endFiles(index, own, to, from)
  if (sameSet(a.files, b.files)) return { level: 'skipped', reason: 'host', ...(a.host || b.host ? { host: a.host ?? b.host } : {}) }

  // 方向：call / async 发送方导入接收方；return 反过来；notifies / streams 两个方向都算（同 K5）
  const either = relation?.type === 'notifies' || relation?.type === 'streams'
  const [src, dst, dstId] = frame.kind === 'return' ? [b, a, from] : [a, b, to]
  const entry = entryOf?.(dstId) ?? null
  const reverseEntry = either ? (entryOf?.(dstId === to ? from : to) ?? null) : null
  const hit = (d: FileDep) =>
    (src.files.has(d.from) && (dst.files.has(d.to) || (!!entry && d.via === entry))) ||
    (either && dst.files.has(d.from) && (src.files.has(d.to) || (!!reverseEntry && d.via === reverseEntry)))
  const all = deps.filter(hit)
  const name = frame.interface ? interfaceName(index, frame.interface) : undefined
  const named = name ? all.filter(d => d.names?.includes(name)) : []
  if (named.length) return { level: 'name', name, candidates: [...named].sort(order), total: named.length }
  if (all.length) {
    const sorted = [...all].sort((x, y) => Number(x.kind !== 'value') - Number(y.kind !== 'value') || order(x, y))
    return { level: 'module', ...(name ? { name } : {}), candidates: sorted.slice(0, EVIDENCE_LIMIT), total: all.length }
  }
  return { level: 'none', ...(name ? { name } : {}) }
}

/** S16：回放计划全部帧（含各分支与 ref 内联）的证据与各等级计数 */
export function scenarioEvidence(
  plan: Pick<ScenarioPlan, 'frames'>,
  index: ModelIndex,
  own: SourceOwnership,
  deps: readonly FileDep[],
  entryOf?: EntryOf,
): ScenarioEvidence {
  const frames = new Map<string, StepEvidence>()
  const counts = Object.fromEntries(EVIDENCE_LEVELS.map(l => [l, 0])) as Record<EvidenceLevel, number>
  for (const f of plan.frames.values()) {
    const e = stepEvidence(f, index, own, deps, entryOf)
    frames.set(f.id, e)
    counts[e.level]++
  }
  return { frames, counts }
}
