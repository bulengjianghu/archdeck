/**
 * 「在此设计」（F-10，SK-14，ADR-0025）：导航树、模型画布节点右键与属性面板的模块上发起，打开新建设计对话框并带入挂载点。
 * 对话框挂在项目视图上（DeskView），各入口只放一个请求。只在当前版本上（底稿与基线都是仓库 HEAD 那一版），挂载点不能是层、不能是系统根；
 * 草图画布上没有这一项（只有「进入下一层」，#20c）；向已打开的设计加一张草图在草图面板的引用节点上（「在此设计」= 在会话里推出那一张）。
 * 对话框里「加到设计 <名>」（T2b 裁决 6）：打开那个草稿设计的草图，进入后切到挂在该模块上的一张（会话里没有时按基线推出，改了才写出）——
 * 跨路由的这一步经 pendingSheet 交给新的项目视图。
 */
import { shallowRef } from 'vue'
import type { DeskState } from '@/state/useDeskState'

export const newDesignRequest = shallowRef<{ mount?: string } | null>(null)

export function openNewDesign(mount?: string): void {
  newDesignRequest.value = { ...(mount ? { mount } : {}) }
}

/** 这个模块上能不能「在此设计」 */
export function canDesignAt(desk: DeskState, id: string): boolean {
  const idx = desk.index.value
  const m = idx?.modules.get(id)
  return !desk.version && !desk.edit.active.value && !!m && id !== idx!.rootId && m.kind !== 'layer'
}

export function closeNewDesign(): void {
  newDesignRequest.value = null
}

/** 「加到设计」：打开设计的草图后要切到的挂载点（项目视图进入草图画布后取走） */
const pendingSheet = shallowRef<{ design: string; mount: string } | null>(null)

export function requestSheet(design: string, mount: string): void {
  pendingSheet.value = { design, mount }
}

/** 取走发给这个设计的请求（只取一次） */
export function takeSheet(design: string): string | null {
  const p = pendingSheet.value
  if (!p || p.design !== design) return null
  pendingSheet.value = null
  return p.mount
}
