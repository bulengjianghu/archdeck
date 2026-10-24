/**
 * F-15、X7a：退出草图回到进入草图之前的版本——浏览器历史里上一个地址不是草图（设计的草图 / 持久草图）时回到它，否则回当前版本。
 * 有未保存改动时离开（信息条「退出」、切换版本、回项目列表、浏览器前进后退）一律同一个三选对话框：保存 / 放弃 / 取消；
 * 保存失败（格式错误、冲突 X7i）时留在草图画布并说明原因。关闭页面受浏览器限制只有两选（beforeunload，项目视图里处理）。
 * 路由只在呈现层出现（视图状态层的 exit 只结束会话）。
 */
import type { Router } from 'vue-router'
import type { EditGroup } from '@/state/desk/edit'
import { choose } from './useEditDialog'

const isSketchPath = (p: string) => /\/d\/[^/]+\/sketch(\?|$)/.test(p) || /\/i\/[^/?]+/.test(p)

export function leaveSketch(router: Router, project: string): void {
  const back = (window.history.state as { back?: unknown } | null)?.back
  if (typeof back === 'string' && back.startsWith(`/p/${project}`) && !isSketchPath(back)) void router.push(back)
  else void router.push({ name: 'project', params: { project } })
}

/** X7a 离开的方式：对话框标题里的动词 */
export type LeaveKind = 'exit' | 'switch'

/**
 * X7a：有未保存改动时问三选——保存（失败则留下，经 report 说明原因）/ 放弃（结束会话，改动丢掉）/ 取消（留下）。
 * 没有改动直接放行。返回 true 即可以离开（会话由调用方结束：退出时 exit，切换版本时项目视图随路由卸载）。
 */
export async function confirmLeave(
  e: Pick<EditGroup, 'canLeave' | 'designErrors' | 'save'>,
  kind: LeaveKind,
  report: (text: string) => void,
): Promise<boolean> {
  if (e.canLeave() === 'free') return true
  const a = await choose({
    title: kind === 'exit' ? '有未保存的改动，退出草图？' : '有未保存的改动，离开草图？',
    lines: [kind === 'exit' ? '保存后退出，或放弃改动退出' : '保存后离开，或放弃改动离开（切换版本、回项目列表、前进后退）'],
    ok: '保存',
    alt: '放弃',
  })
  if (a === 'cancel') return false
  if (a === 'ok') {
    const errors = e.designErrors.value.length
    if (errors) return (report(`有 ${errors} 个格式错误，先改正再保存`), false)
    const r = await e.save()
    if (!r.ok) return (report(r.conflict ? '文件已变，重新加载并重放后再保存' : `保存失败：${r.error}`), false)
  }
  return true
}
