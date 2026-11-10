/**
 * 改动项编号表（CI-2，DL-3）：`designs/<设计>/changes.json`，页面维护的小文件，不登记指纹。
 * 号按产生顺序给，撤回（改动项不在了）后留空不复用；同一处改动撤回后再做出来仍得新号。号认的是改动项的稳定键（items.ts）。纯函数。
 */
import type { ChangeKind } from '../types'
import type { ChangeItem } from './items'

/** 改动项的来源：AI 的一轮或人的手势（CI-1） */
export type ChangeAuthor = 'ai' | 'human'

export interface ChangeRecord {
  n: number
  /** 改动项的稳定键（同一处改动在后续轮次里不变） */
  key: string
  kind: ChangeKind
  summary: string
  /** 第几轮：AI 的轮次序号；人的改动记它发生时已经有几轮（0 = 第一轮之前） */
  round: number
  by: ChangeAuthor
  /** 撤回（或在别处被抹掉）的时间：号留空，不复用 */
  withdrawnAt?: string
}

export interface ChangeTable {
  nextNumber: number
  items: ChangeRecord[]
}

export const EMPTY_CHANGE_TABLE: ChangeTable = { nextNumber: 1, items: [] }

/** 读文件：形状不对的条目丢掉，nextNumber 不小于已用的最大号 + 1 */
export function parseChangeTable(raw: unknown): ChangeTable {
  if (!raw || typeof raw !== 'object') return EMPTY_CHANGE_TABLE
  const r = raw as { nextNumber?: unknown; items?: unknown }
  const items = (Array.isArray(r.items) ? r.items : []).filter(
    (x): x is ChangeRecord =>
      !!x && typeof x === 'object' && Number.isInteger((x as ChangeRecord).n) && typeof (x as ChangeRecord).key === 'string' && typeof (x as ChangeRecord).summary === 'string',
  )
  const max = items.reduce((m, x) => Math.max(m, x.n), 0)
  const next = Number.isInteger(r.nextNumber) ? (r.nextNumber as number) : 1
  return { nextNumber: Math.max(next, max + 1), items: items.map(x => ({ ...x, round: Number(x.round) || 0, by: x.by === 'ai' ? 'ai' : 'human' })) }
}

/** 还在的号：键 → 记录 */
export function activeNumbers(table: ChangeTable): Map<string, ChangeRecord> {
  return new Map(table.items.filter(x => !x.withdrawnAt).map(x => [x.key, x]))
}

/**
 * DL-3：对上当前的改动项——还在的项留原号（措辞更新）；新出现的项按顺序给新号，记第几轮与谁；不在了的项标撤回、号留空。
 * 没有变化时返回原表（同一个值）。
 */
export function reconcileChanges(table: ChangeTable, items: readonly ChangeItem[], attrib: { round: number; by: ChangeAuthor }, at: string): ChangeTable {
  const active = activeNumbers(table)
  const now = new Set(items.map(i => i.key))
  let next = table.nextNumber
  let changed = false
  const out = table.items.map(r => {
    if (r.withdrawnAt || now.has(r.key)) {
      const item = items.find(i => i.key === r.key)
      if (!r.withdrawnAt && item && item.summary !== r.summary) {
        changed = true
        return { ...r, summary: item.summary }
      }
      return r
    }
    changed = true
    return { ...r, withdrawnAt: at }
  })
  for (const i of items) {
    if (active.has(i.key)) continue
    out.push({ n: next++, key: i.key, kind: i.kind, summary: i.summary, round: attrib.round, by: attrib.by })
    changed = true
  }
  return changed ? { nextNumber: next, items: out } : table
}

/** 改动项带上号（没有号的不出现） */
export function numbered<T extends ChangeItem>(table: ChangeTable, items: readonly T[]): (T & { n: number; round: number; by: ChangeAuthor })[] {
  const active = activeNumbers(table)
  return items
    .flatMap(i => {
      const r = active.get(i.key)
      return r ? [{ ...i, n: r.n, round: r.round, by: r.by }] : []
    })
    .sort((a, b) => a.n - b.n)
}
