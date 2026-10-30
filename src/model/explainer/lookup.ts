/**
 * 图解的查找、导航、依据状态与引用原文（EX-1–EX-4、EX-7）：都是关于被描述系统的知识，页面与命令行共用。
 */
import { invariantsOf, summaryOf } from '../contract'
import type { ModelIndex } from '../types'
import { diffBasis, explainerBasis, parseBasis } from './basis'
import { archRefs, readBasisMeta } from './html'
import { conventionalExplainer, type ExplainerNav, type ExplainerRef, type ExplainerStatus } from './types'

const files = (index: ModelIndex) => index.model.explainers ?? {}

/** EX-1、M32：模块（或系统根）的图解路径——写了 explainer 取它，否则约定路径；文件不在描述里为 null */
export function explainerOf(index: ModelIndex, id: string): string | null {
  const have = files(index)
  if (id !== index.rootId && !index.modules.has(id)) return null
  const declared = index.modules.get(id)?.explainer
  const path = declared ?? conventionalExplainer(id)
  return path in have ? path : null
}

/** EX-1：有图解的模块（含系统根）→ 路径，按模块树先序 */
export function explainerModules(index: ModelIndex): Map<string, string> {
  const out = new Map<string, string>()
  if (!index.model.explainers) return out
  const walk = (id: string) => {
    const p = explainerOf(index, id)
    if (p) out.set(id, p)
    for (const c of index.childrenOf.get(id) ?? []) walk(c)
  }
  walk(index.rootId)
  return out
}

/** EX-1：图解原文 */
export function explainerHtml(index: ModelIndex, id: string): string | null {
  const p = explainerOf(index, id)
  return p ? files(index)[p] : null
}

/** EX-4：↑ 最近的有图解的祖先（含根），↓ 子树里最近的有图解的后代 */
export function explainerNav(index: ModelIndex, id: string): ExplainerNav {
  const path = index.pathOf.get(id) ?? []
  let up: string | null = null
  for (let i = path.length - 2; i >= 0 && !up; i--) if (explainerOf(index, path[i])) up = path[i]
  const down: string[] = []
  const walk = (m: string) => {
    for (const c of index.childrenOf.get(m) ?? []) {
      if (explainerOf(index, c)) down.push(c)
      else walk(c)
    }
  }
  walk(id)
  return { up, down }
}

/** EX-7：图解的依据状态；没有图解为 null */
export function explainerStatus(index: ModelIndex, id: string): ExplainerStatus | null {
  const path = explainerOf(index, id)
  if (!path) return null
  const recorded = parseBasis(readBasisMeta(files(index)[path]))
  const current = explainerBasis(index, id)
  const changes = recorded ? diffBasis(index, recorded, current) : []
  return { module: id, path, recorded, current, changes, stale: !recorded || recorded.hash !== current.hash }
}

/** EX-2、EX-3：图解里引用到的模块要填入的原文（不存在的模块不列，显示时标删除线） */
export function explainerRefs(index: ModelIndex, id: string): Record<string, ExplainerRef> {
  const html = explainerHtml(index, id)
  const out: Record<string, ExplainerRef> = {}
  if (!html) return out
  for (const r of archRefs(html)) {
    if (r.module in out) continue
    const m = index.modules.get(r.module)
    if (!m && r.module !== index.rootId) continue
    const s = m ? summaryOf(m) : null
    out[r.module] = {
      name: m?.name ?? index.model.system.name,
      summary: s ? { text: s.text, pending: s.pending } : null,
      invariants: m ? invariantsOf(m) : [],
      explainer: r.module !== id && !!explainerOf(index, r.module),
    }
  }
  return out
}
