/**
 * URL 编解码（N6、N10）：视图状态 ↔ 查询参数。解码时丢弃无效值，恢复到最接近的合法状态。
 *
 * | 参数    | 含义                                   |
 * |---------|----------------------------------------|
 * | `level` | 当前层次（根层省略）                   |
 * | `sel`   | 选中，`m:` / `r:` / `e:` / `a:` 前缀   |
 */
import type { ModelIndex } from '@/model'
import { selectionExists, withLevel } from './navigation'
import type { Query, Selection, TransitionResult, ViewState } from './types'

const SELECTION_PREFIX = { module: 'm', relation: 'r', edge: 'e', actor: 'a' } as const
const SELECTION_KIND = { m: 'module', r: 'relation', e: 'edge', a: 'actor' } as const

export function encodeSelection(s: Selection | null): string | undefined {
  if (!s) return undefined
  return `${SELECTION_PREFIX[s.kind]}:${s.id}`
}

export function decodeSelection(raw: unknown): Selection | null {
  if (typeof raw !== 'string') return null
  const m = /^([mrea]):(.+)$/.exec(raw)
  if (!m) return null
  return { kind: SELECTION_KIND[m[1] as keyof typeof SELECTION_KIND], id: m[2] }
}

export function encodeView(state: ViewState, index: ModelIndex): Record<string, string> {
  const query: Record<string, string> = {}
  if (state.levelId && state.levelId !== index.rootId) query.level = state.levelId
  const sel = encodeSelection(state.selection)
  if (sel) query.sel = sel
  return query
}

/** 按查询参数恢复：不存在的层次回到根，不存在的选中被丢弃 */
export function restore(state: ViewState, index: ModelIndex, query: Query): TransitionResult {
  const level = query.level ?? index.rootId
  const sel = decodeSelection(query.sel)
  return { state: withLevel(state, index, level, { select: selectionExists(index, sel) ? sel : null }), history: 'replace' }
}

/** 两组查询参数是否相同（忽略值为 undefined 的键） */
export function sameQuery(a: Query, b: Query): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if (a[k] !== b[k]) return false
  return true
}
