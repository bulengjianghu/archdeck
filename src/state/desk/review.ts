/**
 * DeskState 的人确认层派生（desk.review，Z1–Z6，ADR-0023）：每个模块的确认状态与差异、确认范围与计数（模型层纯函数），
 * 以及「确认」的写入意图——只发意图，结果由文件变化推送回来（N5）。只对当前版本（Z1）。
 */
import { computed, type ShallowRef } from 'vue'
import {
  REVIEW_SOURCE_MANUAL,
  isReviewable,
  reviewCounts,
  reviewEntries,
  reviewScope,
  reviewStates,
  subtreeOf,
  type ModelIndex,
  type ReviewCounts,
  type ReviewState,
  type ReviewedInput,
  type VersionRef,
} from '@/model'
import type { ModelWriter, WriteOutcome } from './ports'

export interface ReviewInputs {
  index: ShallowRef<ModelIndex | null>
  /** 打开的是设计版本或提交版本时给出：只显示状态，不提供确认 */
  version?: VersionRef
  writer: ModelWriter
}

/** B5：一次请求的正文不超过 64 KB，批量确认按大小分批 */
const CHUNK_BYTES = 48 * 1024

const NONE: ReviewState = { status: 'unreviewed' }
const ZERO: ReviewCounts = { scope: 0, reviewed: 0, stale: 0 }

export function createReview({ index, version, writer }: ReviewInputs) {
  const states = computed(() => (index.value ? reviewStates(index.value) : new Map<string, ReviewState>()))
  const counts = computed(() => (index.value ? reviewCounts(index.value, states.value) : ZERO))
  /** Z4：默认提供「确认」的模块 */
  const scope = computed(() => new Set(index.value ? reviewScope(index.value) : []))
  /** Z3：需复核的模块 */
  const stale = computed(() => new Set([...states.value].filter(([, s]) => s.status === 'stale').map(([id]) => id)))
  const canReview = !version
  const of = (id: string): ReviewState => states.value.get(id) ?? NONE
  /** Z4：「也确认子模块」要记入的模块（含自身） */
  const subtree = (id: string): string[] => (index.value?.modules.has(id) ? subtreeOf(index.value, id) : [])

  /** Z4、Z6、Z7：把这些模块（或系统）记为确认（来源 manual、当天日期、现在的指纹与摘要）；分批写，任一批失败即停止 */
  async function confirm(ids: readonly string[], note?: string): Promise<WriteOutcome> {
    if (!canReview) return { ok: false, error: '只对当前版本确认（Z1）' }
    const idx = index.value
    if (!idx) return { ok: false, error: '描述还没有加载' }
    const missing = ids.find(id => !isReviewable(idx, id))
    if (missing) return { ok: false, error: `模块不存在：${missing}` }
    if (!ids.length) return { ok: false, error: '没有要确认的模块' }
    let last: WriteOutcome = { ok: false, error: '没有要确认的模块' }
    for (const entries of chunk(reviewEntries(idx, ids, { source: REVIEW_SOURCE_MANUAL, note }))) {
      last = await writer.reviewed({ entries })
      if (!last.ok) return last
    }
    return last
  }

  return { states, counts, scope, stale, canReview, of, subtree, confirm }
}

function chunk(entries: ReviewedInput[]): ReviewedInput[][] {
  const out: ReviewedInput[][] = []
  let cur: ReviewedInput[] = []
  let size = 0
  for (const e of entries) {
    const n = JSON.stringify(e).length
    if (cur.length && size + n > CHUNK_BYTES) {
      out.push(cur)
      cur = []
      size = 0
    }
    cur.push(e)
    size += n
  }
  if (cur.length) out.push(cur)
  return out
}
