/**
 * 确认摘要与指纹（Z2）：只覆盖架构师应当理解的部分——职责、原则（abstraction，ADR-0042）、包含 / 不包含、可依赖的层、对外接口签名、直接子模块；
 * 不覆盖名称、类别、实现原理、数据结构正文、codeRefs、docRefs、关系。系统（Z7）只覆盖简介。纯函数，页面、命令行与草图归档同一份。
 */
import type { ModelIndex, ReviewSummaryDef } from '../types'
import type { ReviewSummary } from './types'

/** 职责按行去首尾空白、去空行（Z2） */
export const normalizeLines = (text: string | undefined): string =>
  (text ?? '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .join('\n')

/** 指纹里一切按 ID 排序的地方共用这一个比较器：按 UTF-16 码元比较，与区域设置无关（大小写、非 ASCII 的 ID 也稳定） */
export const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const sorted = (xs: readonly string[] | undefined) => [...(xs ?? [])].sort(compareIds)

/** Z1、Z7：能记确认的对象——模块或系统本身 */
export const isReviewable = (index: ModelIndex, id: string): boolean => id === index.rootId || index.modules.has(id)

const EMPTY: ReviewSummary = { responsibility: '', abstraction: '', includes: [], excludes: [], mayDependOn: [], provides: [], children: [], description: '' }

/** 现在的摘要：从索引里读；系统只给简介（Z7） */
export function reviewSummary(index: ModelIndex, moduleId: string): ReviewSummary {
  if (moduleId === index.rootId) return { ...EMPTY, description: normalizeLines(index.model.system.description) }
  const m = index.modules.get(moduleId)
  if (!m) throw new Error(`模块不存在：${moduleId}`)
  return {
    responsibility: normalizeLines(m.responsibility),
    abstraction: normalizeLines(m.abstraction),
    includes: [...(m.includes ?? [])],
    excludes: [...(m.excludes ?? [])],
    mayDependOn: sorted(m.mayDependOn),
    provides: sorted(m.provides).map(id => ({ id, signature: index.interfaces.get(id)?.signature?.trim() ?? '' })),
    children: sorted(index.childrenOf.get(moduleId)),
    description: '',
  }
}

/** 记录里的摘要（字段可缺）规整为同一形状，才能与现在的比较 */
export function normalizeSummary(def: ReviewSummaryDef | undefined): ReviewSummary {
  return {
    responsibility: normalizeLines(def?.responsibility),
    abstraction: normalizeLines(def?.abstraction),
    includes: [...(def?.includes ?? [])],
    excludes: [...(def?.excludes ?? [])],
    mayDependOn: sorted(def?.mayDependOn),
    provides: [...(def?.provides ?? [])].sort((a, b) => compareIds(a.id, b.id)).map(p => ({ id: p.id, signature: p.signature?.trim() ?? '' })),
    children: sorted(def?.children),
    description: normalizeLines(def?.description),
  }
}

/** 写进文件的形状：空字段省略，便于阅读 */
export function summaryDef(s: ReviewSummary): ReviewSummaryDef {
  return {
    ...(s.description ? { description: s.description } : {}),
    ...(s.responsibility ? { responsibility: s.responsibility } : {}),
    ...(s.abstraction ? { abstraction: s.abstraction } : {}),
    ...(s.includes.length ? { includes: s.includes } : {}),
    ...(s.excludes.length ? { excludes: s.excludes } : {}),
    ...(s.mayDependOn.length ? { mayDependOn: s.mayDependOn } : {}),
    ...(s.provides.length ? { provides: s.provides.map(p => (p.signature ? p : { id: p.id })) } : {}),
    ...(s.children.length ? { children: s.children } : {}),
  }
}

/**
 * 规范化拼接：内容相同必得相同文本，与声明顺序无关。原则与简介（ADR-0042）有值时才以带标签的项追加在后，
 * 所以没写原则的模块、早于它们的确认记录指纹不变
 */
export const summaryText = (s: ReviewSummary): string =>
  JSON.stringify([
    s.responsibility,
    s.includes,
    s.excludes,
    s.mayDependOn,
    s.provides.map(p => [p.id, p.signature]),
    s.children,
    ...(s.abstraction ? [['abstraction', s.abstraction]] : []),
    ...(s.description ? [['description', s.description]] : []),
  ])

/** 64 位指纹（两段 32 位 cyrb 混合），16 位十六进制 */
export function summaryHash(s: ReviewSummary): string {
  return hash64(summaryText(s))
}

export const reviewHash = (index: ModelIndex, moduleId: string): string => summaryHash(reviewSummary(index, moduleId))

function hash64(str: string): string {
  let h1 = 0xdeadbeef ^ 0x9e3779b9
  let h2 = 0x41c6ce57 ^ 0x9e3779b9
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}
