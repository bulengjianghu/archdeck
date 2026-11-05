/**
 * 图解的检查（EX-8、M32、EX-1）：引用的模块存在、只引两种字段、不抄写描述原文、父模块不讲到孙模块内部、依据没有过期。
 * 问题都带图解文件与行号，随加载问题进 lint:model 与返工清单。
 */
import { invariantsOf, textWidth } from '../contract'
import type { Issue, ModelIndex } from '../types'
import { archRefs, lineAt, plainText, type ArchRef } from './html'
import { explainerModules, explainerStatus } from './lookup'
import { BASIS_CHANGE_LABELS, isExplainerFile } from './types'

/** EX-8：抄写判定的最短原文（显示宽度，M30 口径） */
export const COPY_MIN_WIDTH = 8
const FIELDS = new Set(['summary', 'invariants'])
const squash = (s: string) => s.replace(/\s+/g, '')

/** EX-8：data-arch 能指向的模块——描述里的模块与系统根（图解与对话里的机制图块共用，DL-41） */
export const knownModule =
  (index: ModelIndex) =>
  (id: string): boolean =>
    index.pathOf.has(id) && (index.modules.has(id) || id === index.rootId)

/** EX-8、DL-41：HTML / SVG 里指向不存在模块的 data-arch 引用 */
export const unknownArchRefs = (html: string, known: (id: string) => boolean): ArchRef[] => archRefs(html).filter(r => !known(r.module))

export function explainerIssues(index: ModelIndex): Issue[] {
  const issues: Issue[] = []
  const have = index.model.explainers ?? {}
  // M32：写了 explainer 但文件不在描述里
  for (const m of index.modules.values())
    if (m.explainer && !(m.explainer in have))
      issues.push({
        severity: 'warning',
        code: 'module.explainer-missing',
        message: `「${m.id}」的图解 ${m.explainer} 不在描述目录里（M32）：补上文件或去掉 explainer`,
        file: m.src.file,
        path: m.src.path ? `${m.src.path}.explainer` : 'explainer',
        ...(m.src.line ? { line: m.src.line } : {}),
      })
  const owners = explainerModules(index)
  // EX-1：没有被任何模块认领的图解文件
  const claimed = new Set(owners.values())
  for (const p of Object.keys(have))
    if (isExplainerFile(p) && !claimed.has(p))
      issues.push({ severity: 'warning', code: 'explainer.orphan', message: `图解 ${p} 不属于任何模块（EX-1）：文件名用模块 ID，或在模块上写 explainer`, file: p })
  if (!owners.size) return issues
  const known = knownModule(index)

  // EX-8：抄写的候选——每个模块的 summary 与每条不变式（够长的）
  const copies: { text: string; what: string }[] = []
  for (const m of index.modules.values()) {
    const s = m.summary?.trim()
    if (s && textWidth(s) >= COPY_MIN_WIDTH) copies.push({ text: squash(s), what: `「${m.id}」的一句话职责` })
    for (const inv of invariantsOf(m)) if (textWidth(inv.text) >= COPY_MIN_WIDTH) copies.push({ text: squash(inv.text), what: `「${m.id}」的不变式` })
  }

  for (const [id, path] of owners) {
    const html = have[path]
    const at = (offset?: number) => ({ file: path, ...(offset !== undefined ? { line: lineAt(html, offset) } : {}) })
    const depth = (index.pathOf.get(id) ?? []).length
    for (const r of unknownArchRefs(html, known))
      issues.push({ severity: 'error', code: 'explainer.unknown-module', message: `图解里 data-arch="${r.module}" 指向的模块不存在（EX-8）`, ...at(r.offset) })
    for (const r of archRefs(html)) {
      if (!known(r.module)) continue
      const target = index.pathOf.get(r.module)!
      if (r.field !== null && !FIELDS.has(r.field))
        issues.push({ severity: 'warning', code: 'explainer.unknown-field', message: `data-field="${r.field}" 不认识：只能引用 summary 或 invariants（EX-2）`, ...at(r.offset) })
      if (target.length - depth >= 2 && target[depth - 1] === id)
        issues.push({
          severity: 'warning',
          code: 'explainer.too-deep',
          message: `「${id}」的图解链到了孙模块「${r.module}」：父模块只讲子模块之间怎么配合，子模块内部留给子模块自己的图解（EX-8、R5.3）`,
          ...at(r.offset),
        })
    }
    const body = plainText(html)
    for (const c of copies)
      if (body.includes(c.text))
        issues.push({ severity: 'warning', code: 'explainer.copied-text', message: `图解正文抄写了${c.what}：改成 <span data-arch="…" data-field="…"> 引用（EX-8）`, ...at() })
    const st = explainerStatus(index, id)!
    if (!st.recorded)
      issues.push({ severity: 'warning', code: 'explainer.no-basis', message: `「${id}」的图解没有记录依据（arch-basis）：运行 npm run arch -- explainer ${id} --write（EX-9）`, ...at() })
    else if (st.stale)
      issues.push({
        severity: 'warning',
        code: 'explainer.stale',
        message: `「${id}」的图解基于旧描述 · ${st.changes.length} 处改动：${st.changes.map(c => `${c.label}（${BASIS_CHANGE_LABELS[c.kind]}）`).join('、')}（EX-7）`,
        ...at(),
      })
  }
  return issues
}
