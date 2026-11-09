/**
 * 悬停释义（L50，第十七轮 R4.5，ADR-0056）：悬停一条线或线上的标签时，提示末尾附上这个记号在图例里的那一句话。
 * 文字一律取自图例同一份词表（labels.ts，C1）；这里只决定「这条线是哪个记号」，不另写文字。纯函数，单测穷举。
 * 由画布（GraphCanvas）把结果并进边数据的悬停说明；边组件只画 title，不引用这里（边组件被图例的示意线引用，反过来会成环）。
 */
import type { DepEdgeLook, RouteEdgeData } from '@/layout/canvas'
import {
  ALLOWED_TEXT,
  ASSEMBLY_LINE_TEXT,
  COUPLE_ISOLATED_TEXT,
  COUPLE_TEXT,
  DEP_FORM_HINT,
  DEP_FORM_LABEL,
  DEP_TIER_HINT,
  DEP_TIER_LABEL,
  FACT_TAG_HINT,
  MECHANISM_HINTS,
  TYPE_HINT,
  TYPE_LABEL,
  UNMODELED_TEXT,
  UPPER_TEXT,
} from './labels'

/** 释义段的抬头：与原有的悬停说明空一行隔开 */
export const GLOSS_HEAD = '图例 · '

const typeLine = (t: keyof typeof TYPE_LABEL) => `${TYPE_LABEL[t]} = ${TYPE_HINT[t]}`
const factLine = (tag: string) => {
  const f = FACT_TAG_HINT.find(x => x.tag === tag)
  return f ? `${f.tag}：${f.text}` : null
}

/** 标签位里出现的异常词与机制词（L26、L35），按词表次序各一句；同一词只附一次 */
export function labelGloss(label: string | undefined): string[] {
  if (!label) return []
  const words = new Set(label.split(/\s*·\s*|\s+/).map(w => w.replace(/\s*\d+$/, '')))
  return [
    ...FACT_TAG_HINT.filter(f => words.has(f.tag)).map(f => `${f.tag}：${f.text}`),
    ...MECHANISM_HINTS.filter(m => words.has(m.tag)).map(m => `${m.tag}：${m.text}`),
  ]
}

/** 交互边与临时线：按种类给记号的那一句，再加标签词 */
export function routeGloss(d: Pick<RouteEdgeData, 'temp' | 'edge' | 'label' | 'violated' | 'couple'>): string[] {
  const head = (() => {
    switch (d.temp) {
      case 'code':
        return factLine(d.violated ? '违规' : '未解释')
      case 'assembly':
        return ASSEMBLY_LINE_TEXT
      case 'couple':
        return d.couple?.isolated ? `${COUPLE_TEXT}；${COUPLE_ISOLATED_TEXT}` : COUPLE_TEXT
      case 'carrier-gap':
        return factLine('缺段')
      case 'upper':
        return UPPER_TEXT
      case 'unmodeled':
        return UNMODELED_TEXT
      default:
        return d.edge?.type ? typeLine(d.edge.type) : null
    }
  })()
  const tags = labelGloss(d.label)
  return [...(head ? [head] : []), ...tags.filter(t => t !== head)]
}

/** 结构边：形态一句、档一句（允许边只有形态那句） */
export function depGloss(look: Pick<DepEdgeLook, 'kind' | 'tier'>): string[] {
  const form = look.kind === 'allowed' ? ALLOWED_TEXT : `${DEP_FORM_LABEL[look.kind]} = ${DEP_FORM_HINT[look.kind]}`
  return [form, ...(look.tier ? [`${DEP_TIER_LABEL[look.tier]} = ${DEP_TIER_HINT[look.tier]}`] : [])]
}

/** 原有的悬停说明 + 释义段（释义只追加，不改原文） */
export function withGloss(title: string | undefined, gloss: readonly string[]): string {
  const g = gloss.map(x => GLOSS_HEAD + x).join('\n')
  return [title, g].filter(Boolean).join('\n\n')
}
