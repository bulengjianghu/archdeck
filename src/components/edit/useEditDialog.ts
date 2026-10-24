/**
 * 编辑态的二次确认（C-3、C-5、C-6、E-3，X7d、X7e）：移动会改 ID、级联删除、放弃改动时弹出，列出影响；
 * 退出编辑时有未保存的改动弹三选（保存 / 放弃 / 取消，F-61）。
 * 只属于这块界面（不进视图状态）：一个模块级的对话框值，EditDialog 渲染，调用方 await ask(...) / choose(...) 得到回答。
 */
import { shallowRef } from 'vue'

export interface DialogRequest {
  title: string
  lines: string[]
  ok: string
  danger?: boolean
  /** 第三个选项（在取消与确认之间） */
  alt?: string
}

export type DialogAnswer = 'ok' | 'alt' | 'cancel'

export const editDialog = shallowRef<(DialogRequest & { resolve: (a: DialogAnswer) => void }) | null>(null)

/** 三选：确认 / 第三个选项 / 取消 */
export function choose(req: DialogRequest): Promise<DialogAnswer> {
  editDialog.value?.resolve('cancel')
  return new Promise(resolve => (editDialog.value = { ...req, resolve }))
}

export function ask(req: DialogRequest): Promise<boolean> {
  return choose(req).then(a => a === 'ok')
}

export function answer(a: boolean | DialogAnswer): void {
  const d = editDialog.value
  editDialog.value = null
  d?.resolve(a === true ? 'ok' : a === false ? 'cancel' : a)
}
