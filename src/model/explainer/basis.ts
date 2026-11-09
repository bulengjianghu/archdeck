/**
 * 图解的依据与指纹（EX-6、EX-7）：依据 = 本模块的描述（Z2 的确认摘要 + summary + invariants）+ 直接子模块的 summary / invariants
 * + 子模块之间的关系（两端分属两个不同直接子模块的子树）。按项记 8 位指纹（与 Z2 同一算法），所以能数出改了几处、是哪几处。
 */
import { invariantsOf } from '../contract'
import { moduleName } from '../names'
import { hash64, reviewSummary } from '../review/hash'
import { REVIEW_FIELD_LABELS, REVIEW_FIELDS } from '../review/types'
import type { ModelIndex } from '../types'
import { BASIS_VERSION, type BasisChange, type ExplainerBasis } from './types'

const FIELD_LABELS: Record<string, string> = { ...REVIEW_FIELD_LABELS, summary: '一句话职责', invariants: '不变式' }

const norm = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const invText = (index: ModelIndex, id: string) => {
  const m = index.modules.get(id)
  return m ? JSON.stringify(invariantsOf(m).map(i => [norm(i.text), i.adr ?? null])) : '[]'
}

/** id 在 parent 之下的那个直接子模块；不在 parent 子树里为 null */
function childUnder(index: ModelIndex, parent: string, id: string): string | null {
  const path = index.pathOf.get(id)
  if (!path) return null
  const at = path.indexOf(parent)
  return at >= 0 && at + 1 < path.length ? path[at + 1] : null
}

/** EX-6：依据的各项（键 → 规整后的原文），空项不列 */
export function basisEntries(index: ModelIndex, moduleId: string): [string, string][] {
  const out: [string, string][] = []
  const add = (key: string, text: string) => {
    if (text && text !== '[]' && text !== '""') out.push([key, text])
  }
  // ① 本模块：确认摘要（Z2）的各字段 + summary + invariants
  const s = reviewSummary(index, moduleId)
  for (const f of REVIEW_FIELDS) add(`${moduleId}#${f}`, typeof s[f] === 'string' ? (s[f] as string) : JSON.stringify(s[f]))
  const self = index.modules.get(moduleId)
  if (self) {
    add(`${moduleId}#summary`, norm(self.summary))
    add(`${moduleId}#invariants`, invText(index, moduleId))
  }
  // ② 直接子模块的对外承诺
  const kids = index.childrenOf.get(moduleId) ?? []
  for (const c of kids) {
    add(`${c}#summary`, norm(index.modules.get(c)?.summary))
    add(`${c}#invariants`, invText(index, c))
  }
  // ③ 子模块之间的关系
  if (kids.length > 1)
    for (const r of index.relations.values()) {
      const a = childUnder(index, moduleId, r.from)
      const b = childUnder(index, moduleId, r.to)
      if (a && b && a !== b) add(`rel:${r.id}`, JSON.stringify([r.type, r.from, r.to, norm(r.purpose)]))
    }
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

const short = (text: string) => hash64(text).slice(0, 8)

/** EX-6：现在的依据 */
export function explainerBasis(index: ModelIndex, moduleId: string): ExplainerBasis {
  const items: Record<string, string> = {}
  for (const [k, v] of basisEntries(index, moduleId)) items[k] = short(v)
  return { hash: basisHash(items), items }
}

const basisHash = (items: Record<string, string>) =>
  hash64(
    Object.keys(items)
      .sort()
      .map(k => `${k}=${items[k]}`)
      .join(' '),
  )

/** EX-6：写进 arch-basis 的文本 */
export const formatBasis = (b: ExplainerBasis): string =>
  [
    BASIS_VERSION,
    b.hash,
    ...Object.keys(b.items)
      .sort()
      .map(k => `${k}=${b.items[k]}`),
  ].join(' ')

/** EX-6：读 arch-basis；版本不认识或写坏了为 null */
export function parseBasis(content: string | null): ExplainerBasis | null {
  if (!content) return null
  const [ver, hash, ...rest] = content.trim().split(/\s+/)
  if (ver !== BASIS_VERSION || !hash) return null
  const items: Record<string, string> = {}
  for (const kv of rest) {
    const at = kv.lastIndexOf('=')
    if (at <= 0) return null
    items[kv.slice(0, at)] = kv.slice(at + 1)
  }
  return { hash, items }
}

/** EX-7：记录相对现在的改动，按键排序；每项给「谁的什么」 */
export function diffBasis(index: ModelIndex, recorded: ExplainerBasis, current: ExplainerBasis): BasisChange[] {
  if (recorded.hash === current.hash) return []
  const keys = [...new Set([...Object.keys(recorded.items), ...Object.keys(current.items)])].sort()
  const out: BasisChange[] = []
  for (const key of keys) {
    const was = recorded.items[key]
    const now = current.items[key]
    if (was === now) continue
    out.push({ key, kind: was === undefined ? 'added' : now === undefined ? 'removed' : 'changed', label: basisLabel(index, key) })
  }
  return out
}

/** 依据一项的说法：「会话内核的一句话职责」「关系 命令调度 → 会话决定」 */
export function basisLabel(index: ModelIndex, key: string): string {
  if (key.startsWith('rel:')) {
    const r = index.relations.get(key.slice(4))
    return r ? `关系 ${moduleName(index, r.from)} → ${moduleName(index, r.to)}` : `关系 ${key.slice(4)}`
  }
  const at = key.lastIndexOf('#')
  const id = key.slice(0, at)
  return `${moduleName(index, id)}的${FIELD_LABELS[key.slice(at + 1)] ?? key.slice(at + 1)}`
}
