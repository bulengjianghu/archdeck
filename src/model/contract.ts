/**
 * 描述契约（ADR-0053）：一句话职责 summary、关系目的 purpose、不变式 invariants 的取值与回退（M30）。
 * 换一个前端（属性栏、命令行、AI 查询）都要同一份取值，所以在模型层；只看单个实体的字段、不含跨实体的计算，属契约（类型与 Schema），呈现层可直接用。
 * 全项目的覆盖计数（M31）在返工清单（rework/coverage.ts）。
 */
import type { InvariantDef, ModuleDef, RelationDef } from './types'

/** M27：一句话职责的字数上限 */
export const SUMMARY_LIMIT = 30
/** M29：关系目的的字数上限 */
export const PURPOSE_LIMIT = 20
/** M28：不变式的条数上限 */
export const INVARIANTS_LIMIT = 3

/** M30：显示宽度——全角字符计 1、半角字符（ASCII）计 ½、空白不计，向上取整 */
export function textWidth(text: string): number {
  let half = 0
  for (const ch of text) if (!/\s/.test(ch)) half += ch.codePointAt(0)! < 0x80 ? 1 : 2
  return Math.ceil(half / 2)
}

/** M30：首句——在 。！？； 及后跟空白或行尾的 .!?; 处断开，去掉句末标点 */
export function firstSentence(text: string): string {
  const t = text.trim()
  const m = /[。！？；]|[.!?;](?=\s|$)/.exec(t)
  return (m ? t.slice(0, m.index) : t).trim()
}

/** M30：超过 limit 字时截断并加「…」（「…」计 1 字） */
export function truncateWidth(text: string, limit: number): string {
  if (textWidth(text) <= limit) return text
  let out = ''
  for (const ch of text) {
    if (textWidth(out + ch) > limit - 1) break
    out += ch
  }
  return `${out.trimEnd()}…`
}

/** M30：契约字段的取值；pending 为「待提炼」——字段没写，由长文首句截断得来 */
export interface ContractText {
  text: string
  pending: boolean
}

const pick = (written: string | undefined, fallback: string | undefined, limit: number): ContractText | null => {
  if (written?.trim()) return { text: written.trim(), pending: false }
  const first = fallback ? firstSentence(fallback) : ''
  return first ? { text: truncateWidth(first, limit), pending: true } : null
}

/** M30：模块的一句话职责——summary，缺失时回退为 responsibility 首句截断（待提炼） */
export const summaryOf = (m: Pick<ModuleDef, 'summary' | 'responsibility'>): ContractText | null => pick(m.summary, m.responsibility, SUMMARY_LIMIT)

/** M30：关系的目的——purpose，缺失时回退为 description 首句截断（待提炼） */
export const purposeOf = (r: Pick<RelationDef, 'purpose' | 'description'>): ContractText | null => pick(r.purpose, r.description, PURPOSE_LIMIT)

/** M28：不变式归一为 { text, adr? }，去掉空条 */
export const invariantsOf = (m: Pick<ModuleDef, 'invariants'>): InvariantDef[] =>
  (m.invariants ?? [])
    .map(x => (typeof x === 'string' ? { text: x.trim() } : { text: x.text.trim(), ...(x.adr !== undefined ? { adr: x.adr } : {}) }))
    .filter(x => x.text)

/** M33（ADR-0060，round19 V3）：否定边界的条数上限 */
export const EXCLUDES_LIMIT = 3

/** M33：否定边界的一条——「不负责什么」，可带去向（哪个模块负责） */
export interface ExcludeDef {
  text: string
  /** 去向模块的 ID（写法「短语 → 模块 ID」） */
  to?: string
}

/**
 * M33：模块的否定边界——excludes 每条「短语」或「短语 → 模块 ID」（箭头可写 → 或 ->），去掉空条；
 * 层（单成员层的模块）的 excludes 同一字段、同一读法（ADR-0052 的「不包含」）。
 */
export const excludesOf = (m: Pick<ModuleDef, 'excludes'>): ExcludeDef[] =>
  (m.excludes ?? [])
    .map(x => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .map(x => {
      const hit = /^(.*?)\s*(?:→|->)\s*([A-Za-z0-9_.-]+)\s*$/.exec(x)
      return hit && hit[1].trim() ? { text: hit[1].trim(), to: hit[2] } : { text: x }
    })
