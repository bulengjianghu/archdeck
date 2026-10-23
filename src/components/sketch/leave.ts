/**
 * F-15、X7a：退出草图回到进入草图之前的版本——浏览器历史里上一个地址不是草图（设计的草图 / 持久草图）时回到它，否则回当前版本。
 * 路由只在呈现层出现（视图状态层的 exit 只结束会话）。
 */
import type { Router } from 'vue-router'

const isSketchPath = (p: string) => /\/d\/[^/]+\/sketch(\?|$)/.test(p) || /\/i\/[^/?]+/.test(p)

export function leaveSketch(router: Router, project: string): void {
  const back = (window.history.state as { back?: unknown } | null)?.back
  if (typeof back === 'string' && back.startsWith(`/p/${project}`) && !isSketchPath(back)) void router.push(back)
  else void router.push({ name: 'project', params: { project } })
}
