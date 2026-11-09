/**
 * 问答卡的引用（DA-3，DL-13）：AI 只写 `{模块, 字段}`，原文由架构台从描述填——AI 抄错、编造的原文进不了卡片。
 * 模块不存在、字段在描述里是空的 → 解析失败，卡片上标「引用无效」，不替 AI 补。
 */
import { invariantsOf, summaryOf } from '../contract'
import { explainerOf } from '../explainer/lookup'
import type { ModelIndex } from '../types'
import type { Citation } from './protocol'

export const CITE_FIELD_LABELS: Record<Citation['field'], string> = {
  summary: '一句话',
  responsibility: '职责',
  invariants: '不变式',
  principle: '原则',
  interfaces: '接口',
  relations: '关系',
  explainer: '题解',
}

export type ResolvedCitation = { ok: true; module: string; name: string; field: Citation['field']; text: string } | { ok: false; module: string; field: string; reason: string }

export function resolveCitation(index: ModelIndex, cite: Citation): ResolvedCitation {
  const fail = (reason: string): ResolvedCitation => ({ ok: false, module: cite.module, field: cite.field, reason })
  const isRoot = cite.module === index.rootId
  const m = index.modules.get(cite.module)
  if (!m && !isRoot) return fail(`模块「${cite.module}」不存在`)
  const name = m?.name ?? index.model.system.name
  const ok = (text: string | null | undefined) =>
    text?.trim() ? ({ ok: true, module: cite.module, name, field: cite.field, text: text.trim() } as const) : fail(`「${name}」的${CITE_FIELD_LABELS[cite.field]}在描述里是空的`)
  switch (cite.field) {
    case 'summary':
      return ok(m ? summaryOf(m)?.text : index.model.system.description)
    case 'responsibility':
      return ok(m?.responsibility)
    case 'invariants':
      return ok(m ? invariantsOf(m).map(i => i.text).join('；') : null)
    case 'principle':
      return ok(m ? (m.principle ?? m.abstraction) : null)
    case 'interfaces':
      return ok(
        [...index.interfaces.values()]
          .filter(i => i.owner === cite.module)
          .map(i => (i.signature ? `${i.name}：${i.signature}` : i.name))
          .join('；'),
      )
    case 'relations': {
      const name = (id: string) => index.modules.get(id)?.name ?? index.actors.get(id)?.name ?? id
      const ids = [...(index.outRelations.get(cite.module) ?? []), ...(index.inRelations.get(cite.module) ?? [])]
      return ok(
        ids
          .map(id => index.relations.get(id))
          .filter(r => !!r)
          .map(r => `${name(r.from)} → ${name(r.to)}（${r.type}）${r.description ? `：${r.description}` : ''}`)
          .join('；'),
      )
    }
    case 'explainer':
      return explainerOf(index, cite.module) ? ok(`${name}的题解`) : fail(`「${name}」没有题解`)
  }
}
