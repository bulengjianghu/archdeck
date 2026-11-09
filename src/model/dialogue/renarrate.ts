/**
 * 重讲（DA-4、DA-5，DL-8）：只动讲法不动事实。
 * - 三问判别：产出里的每一样东西问三句——进不进确认层指纹（Z2）、进不进核验（X4）、进不进事实检查（Q12 / K7）；三个都否才放行。
 *   题解 HTML 与讲法要求三否；职责、一句话、不变式、原则、关系、接口、代码位置都不是——产出含它们整轮拒绝。
 * - 讲法要求随题解存 `explainers/<模块 ID>.notes.md`（AI 拥有、不登记指纹）：纯文本一条一行，累积——第二次重讲带第一次的。
 */
import { explainerIssues } from '../explainer/lint'
import { explainerOf } from '../explainer/lookup'
import type { ModelIndex } from '../types'
import type { RenarrateBlock } from './protocol'

export interface ThreeQuestions {
  /** 进确认层指纹（Z2：确认记录的 hash 覆盖它） */
  fingerprint: boolean
  /** 进核验（X4：草图核验比对它） */
  verify: boolean
  /** 进事实检查（Q12 / K7：代码事实比对它） */
  factCheck: boolean
}

/** DL-8 的判别表：重讲产出里可能出现的键 → 三问的答案。不在表里的键一律按事实对待（宁拒勿放） */
export const THREE_QUESTIONS: Record<string, ThreeQuestions> = {
  kind: { fingerprint: false, verify: false, factCheck: false },
  module: { fingerprint: false, verify: false, factCheck: false },
  html: { fingerprint: false, verify: false, factCheck: false },
  notes: { fingerprint: false, verify: false, factCheck: false },
  summary: { fingerprint: true, verify: false, factCheck: false },
  responsibility: { fingerprint: true, verify: false, factCheck: false },
  invariants: { fingerprint: true, verify: false, factCheck: false },
  principle: { fingerprint: true, verify: true, factCheck: false },
  relations: { fingerprint: true, verify: true, factCheck: true },
  interfaces: { fingerprint: true, verify: true, factCheck: true },
  codeRefs: { fingerprint: true, verify: false, factCheck: true },
  name: { fingerprint: true, verify: true, factCheck: false },
}

const passes = (q: ThreeQuestions) => !q.fingerprint && !q.verify && !q.factCheck

export type RenarrateVerdict = { ok: true; path: string } | { ok: false; reasons: string[] }

/** DL-8：判别一份重讲产出——键过三问、模块存在、新题解过同一套检查（EX-8 的错误与抄写） */
export function judgeRenarrate(index: ModelIndex, block: RenarrateBlock, candidate?: ModelIndex): RenarrateVerdict {
  const reasons: string[] = []
  for (const key of Object.keys(block)) {
    const q = THREE_QUESTIONS[key]
    if (!q) reasons.push(`产出多了「${key}」：不在讲法范围，按事实对待`)
    else if (!passes(q))
      reasons.push(
        `产出含事实字段「${key}」（${[q.fingerprint && '进确认层指纹', q.verify && '进核验', q.factCheck && '进事实检查'].filter(Boolean).join('、')}）：重讲只动讲法`,
      )
  }
  if (block.module !== index.rootId && !index.modules.has(block.module)) reasons.push(`模块「${block.module}」不存在`)
  const path = explainerOf(index, block.module) ?? `explainers/${block.module}.html`
  if (candidate && !reasons.length)
    for (const i of explainerIssues(candidate))
      if (i.file === path && (i.severity === 'error' || i.code === 'explainer.copied-text' || i.code === 'explainer.too-deep')) reasons.push(`新题解没过检查：${i.message}`)
  return reasons.length ? { ok: false, reasons } : { ok: true, path }
}

/** 讲法要求文件：一条一行；空行与「#」开头的行不算 */
export const notesPath = (module: string) => `explainers/${module}.notes.md`

export const parseNotes = (text: string): string[] =>
  text
    .split('\n')
    .map(l => l.replace(/^[-*]\s+/, '').trim())
    .filter(l => l && !l.startsWith('#'))

/** DA-5：累积——已有的在前、新的追加，重复的不再记 */
export function mergeNotes(existing: readonly string[], add: readonly string[]): string[] {
  const out = [...existing]
  for (const n of add.map(x => x.trim()).filter(Boolean)) if (!out.includes(n)) out.push(n)
  return out
}

export const formatNotes = (module: string, notes: readonly string[]) => `# 讲法要求 · ${module}（DL-8：AI 拥有，不登记指纹；一条一行，重写题解时随上下文带上）\n\n${notes.map(n => `- ${n}`).join('\n')}\n`
