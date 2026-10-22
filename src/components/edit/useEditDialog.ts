/**
 * 编辑态的二次确认（C-3、C-5、C-6、E-3，X7d、X7e）：移动会改 ID、级联删除、放弃改动时弹出，列出影响。
 * 只属于这块界面（不进视图状态）：一个模块级的对话框值，EditDialog 渲染，调用方 await ask(...) 得到是否确认。
 */
import { shallowRef } from 'vue'

export interface DialogRequest {
  title: string
  lines: string[]
  ok: string
  danger?: boolean
}

export const editDialog = shallowRef<(DialogRequest & { resolve: (ok: boolean) => void }) | null>(null)

export function ask(req: DialogRequest): Promise<boolean> {
  editDialog.value?.resolve(false)
  return new Promise(resolve => (editDialog.value = { ...req, resolve }))
}

export function answer(ok: boolean): void {
  const d = editDialog.value
  editDialog.value = null
  d?.resolve(ok)
}
