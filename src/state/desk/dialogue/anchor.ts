/**
 * 锚点（DA-2，DL-19；设计 dialogue-layers 的「锚点」）：这一问挂在哪——由选中、步骤与当前张推出锚点、判断两个锚点是否相同、给锚点条生成文字。
 * 不记录会话，也不决定什么时候换锚点（那是协调者的事）。
 */
import { type Anchor, type ModelIndex } from '@/model'
import type { Selected } from '../../transition'

export function sameAnchor(a: Anchor, b: Anchor): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'module') return a.module === (b as typeof a).module && a.sheet === (b as typeof a).sheet
  if (a.kind === 'step') return a.frame === (b as typeof a).frame && a.scenario === (b as typeof a).scenario
  return true
}

/**
 * DA-2：选中 → 锚点。模块 → 模块；步骤 → 步骤（带两端，供锚点条与上下文包）；其余（无选中、关系、文件…）→ 无。
 * 草图里（sheet 给出当前张）总有锚点：选中的框，没有选中时是当前张的挂载点（DL-19：「没有选中对象不能发起修改」在草图里由当前张兜底）。
 */
export function anchorOf(
  sel: Selected | null,
  step: { scenario: string; frame: { id: string; from: string; to: string; label?: string } } | null,
  sheet?: string | null,
): Anchor {
  if (sheet) return { kind: 'module', module: sel?.kind === 'module' ? sel.id : sheet, sheet }
  if (sel?.kind === 'module') return { kind: 'module', module: sel.id }
  if (sel?.kind === 'step' && step && step.frame.id === sel.id)
    return {
      kind: 'step',
      scenario: step.scenario,
      frame: sel.id,
      from: step.frame.from,
      to: step.frame.to,
      ...(step.frame.label ? { label: step.frame.label } : {}),
    }
  return { kind: 'none' }
}

/** 锚点条的文字（草图里：「当前张 <挂载点名>」，选中了框再加「 · <框名>」） */
export function anchorText(index: ModelIndex | null, a: Anchor, nameOf?: (id: string) => string | undefined): string {
  const name = (id: string) =>
    nameOf?.(id) ??
    index?.modules.get(id)?.name ??
    index?.actors.get(id)?.name ??
    (id === index?.rootId || id === 'root' ? (index?.model.system.name ?? id) : id)
  if (a.kind === 'module' && a.sheet) return `当前张 ${name(a.sheet)}${a.module !== a.sheet ? ` · ${name(a.module)}` : ''}`
  if (a.kind === 'module') return name(a.module)
  if (a.kind === 'step') return `${name(a.from)} → ${name(a.to)}${a.label ? ` · ${a.label}` : ''}`
  return '没有选中（问整个系统）'
}
