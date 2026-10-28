/**
 * 确认状态、差异、范围与计数（Z1、Z3–Z6）。记录来自 index.model.reviewed（Validator 已去掉坏引用、按模块去重）。
 */
import type { ModelIndex, ReviewedEntry, ReviewedEntryDef } from '../types'
import { normalizeSummary, reviewSummary, summaryDef, summaryHash } from './hash'
import { REVIEW_FIELDS, type ReviewChange, type ReviewCounts, type ReviewDiff, type ReviewState, type ReviewStatus, type ReviewSummary, type ReviewedInput } from './types'

/** Z3：有记录且指纹一致 / 有记录、指纹不一致 / 没有记录 */
export function reviewStatus(index: ModelIndex, entry: Pick<ReviewedEntry, 'hash'> | undefined, moduleId: string): ReviewStatus {
  if (!entry) return 'unreviewed'
  return entry.hash === summaryHash(reviewSummary(index, moduleId)) ? 'reviewed' : 'stale'
}

/** 最长公共子序列的行 diff：返回被删与新增的行（顺序按各自原文） */
function diffLines(a: readonly string[], b: readonly string[]): ReviewChange[] {
  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: ReviewChange[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: 'removed', text: a[i++] })
    else out.push({ kind: 'added', text: b[j++] })
  }
  while (i < n) out.push({ kind: 'removed', text: a[i++] })
  while (j < m) out.push({ kind: 'added', text: b[j++] })
  return out
}

/** 集合 diff（按项增删，顺序按各自原文） */
function diffItems(a: readonly string[], b: readonly string[]): ReviewChange[] {
  const A = new Set(a)
  const B = new Set(b)
  return [...a.filter(x => !B.has(x)).map(text => ({ kind: 'removed' as const, text })), ...b.filter(x => !A.has(x)).map(text => ({ kind: 'added' as const, text }))]
}

/** Z3：上次确认时与现在的差异——简介、职责与原则按行、包含 / 不包含与可依赖的层按项、接口按 ID 增 / 删 / 改、子模块按 ID 增删 */
export function reviewDiff(before: ReviewSummary, now: ReviewSummary): ReviewDiff {
  const was = new Map(before.provides.map(p => [p.id, p.signature]))
  const is = new Map(now.provides.map(p => [p.id, p.signature]))
  const provides: ReviewChange[] = []
  for (const [id, sig] of was) {
    if (!is.has(id)) provides.push({ kind: 'removed', text: id, before: sig })
    else if (is.get(id) !== sig) provides.push({ kind: 'changed', text: id, before: sig, after: is.get(id) })
  }
  for (const [id, sig] of is) if (!was.has(id)) provides.push({ kind: 'added', text: id, after: sig })
  const lines = (f: 'description' | 'responsibility' | 'abstraction') => diffLines(before[f].split('\n').filter(Boolean), now[f].split('\n').filter(Boolean))
  const diff = {
    description: lines('description'),
    responsibility: lines('responsibility'),
    abstraction: lines('abstraction'),
    includes: diffItems(before.includes, now.includes),
    excludes: diffItems(before.excludes, now.excludes),
    mayDependOn: diffItems(before.mayDependOn, now.mayDependOn),
    provides,
    children: diffItems(before.children, now.children),
  }
  return { ...diff, count: REVIEW_FIELDS.reduce((n, f) => n + diff[f].length, 0) }
}

/** Z4：默认提供「确认」的模块——任意层次的核心模块（role: core，ADR-0027）与第二级模块（根的子模块的子模块），按声明顺序 */
export function reviewScope(index: ModelIndex): string[] {
  const second = new Set((index.childrenOf.get(index.rootId) ?? []).flatMap(id => index.childrenOf.get(id) ?? []))
  return [...index.modules.values()]
    .filter(m => m.role === 'core' || second.has(m.id))
    .sort((a, b) => a.seq - b.seq)
    .map(m => m.id)
}

/** 每个模块与系统本身（Z7）的确认状态（Z1、Z3）；只有记录的才有 entry，需复核且记录带摘要时才有 diff */
export function reviewStates(index: ModelIndex): Map<string, ReviewState> {
  const entries = new Map(index.model.reviewed.map(e => [e.module, e]))
  const out = new Map<string, ReviewState>()
  for (const id of [index.rootId, ...index.modules.keys()]) {
    const entry = entries.get(id)
    if (!entry) {
      out.set(id, { status: 'unreviewed' })
      continue
    }
    const now = reviewSummary(index, id)
    if (entry.hash === summaryHash(now)) out.set(id, { status: 'reviewed', entry })
    else out.set(id, { status: 'stale', entry, ...(entry.summary ? { diff: reviewDiff(normalizeSummary(entry.summary), now) } : {}) })
  }
  return out
}

/** Z5：确认范围内的已确认 / 需复核计数 */
export function reviewCounts(index: ModelIndex, states: ReadonlyMap<string, ReviewState> = reviewStates(index)): ReviewCounts {
  const scope = reviewScope(index)
  const of = (s: ReviewStatus) => scope.filter(id => states.get(id)?.status === s).length
  return { scope: scope.length, reviewed: of('reviewed'), stale: of('stale') }
}

/** 一个模块及其子树（含自身），按声明顺序；「也确认子模块」用 */
export function subtreeOf(index: ModelIndex, moduleId: string): string[] {
  const out: string[] = []
  const walk = (id: string) => {
    out.push(id)
    for (const c of index.childrenOf.get(id) ?? []) walk(c)
  }
  walk(moduleId)
  return out
}

/** Z4、Z6、Z7：为一组模块（或系统）生成确认记录（现在的指纹与摘要）；页面「确认」与草图归档都用它构造写入 */
export function reviewEntries(index: ModelIndex, ids: readonly string[], opts: { source: string; note?: string; at?: string }): ReviewedInput[] {
  const at = opts.at ?? new Date().toISOString().slice(0, 10)
  const note = opts.note?.trim()
  return ids.map(module => {
    const summary = reviewSummary(index, module)
    return { module, at, hash: summaryHash(summary), summary: summaryDef(summary), source: opts.source, ...(note ? { note } : {}) }
  })
}

/** 记录的原样（去掉出处），写回文件用 */
export const entryDef = ({ src: _src, ...def }: ReviewedEntry): ReviewedEntryDef => def
