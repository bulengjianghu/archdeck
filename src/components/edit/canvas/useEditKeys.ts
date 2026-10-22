/**
 * 删除与快捷键（C-6、C-10、C-12，X7e、X7g）：删除选中对象（有级联时二次确认并列出将删的实体）；⌘Z / ⇧⌘Z 撤销重做。
 * 焦点在输入框时让给输入框（由调用方判断）；编辑态下 Backspace 同 Delete（不返回上级，X7a）。
 */
import type { DeskState } from '@/state/useDeskState'
import { ask } from '../useEditDialog'

/** 删除一个模块或关系；返回失败原因（空串为成功或取消） */
export async function confirmRemove(desk: DeskState, sel: { kind: string; id: string } | null): Promise<string> {
  if (!sel) return ''
  if (sel.kind === 'relation') {
    const r = desk.edit.edit({ op: 'removeRelation', id: sel.id })
    return r.ok ? '' : r.reason
  }
  if (sel.kind !== 'module') return ''
  const preview = desk.edit.previewRemove(sel.id)
  if ('rejected' in preview) return preview.rejected
  const others = preview.removed.filter(x => x !== sel.id)
  if (
    others.length &&
    !(await ask({
      title: `删除「${sel.id}」？`,
      lines: [`将同时删除：${others.slice(0, 12).join('、')}${others.length > 12 ? ` 等 ${others.length} 项` : ''}`],
      ok: '删除',
      danger: true,
    }))
  )
    return ''
  const r = desk.edit.edit({ op: 'removeModule', id: sel.id })
  return r.ok ? '' : r.reason
}

/** 编辑态的键盘；返回是否已处理 */
export function editKey(desk: DeskState, e: KeyboardEvent, notify: (msg: string) => void): boolean {
  if (!desk.edit.active.value) return false
  const mod = e.metaKey || e.ctrlKey
  if (mod && e.key.toLowerCase() === 'z') {
    if (e.shiftKey) desk.edit.redo()
    else desk.edit.undo()
    return true
  }
  if (mod && e.key.toLowerCase() === 'y') return (desk.edit.redo(), true)
  if (e.key === 'Delete' || e.key === 'Backspace') {
    void confirmRemove(desk, desk.selection.value).then(m => m && notify(m))
    return true
  }
  return false
}
