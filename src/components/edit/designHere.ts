/**
 * 「在此设计」（F-10，SK-14，ADR-0025）：导航树、模型画布节点右键与属性面板的模块上发起，打开新建设计对话框并带入挂载点。
 * 对话框挂在项目视图上（DeskView），各入口只放一个请求。只在当前版本上（底稿与基线都是仓库 HEAD 那一版），挂载点不能是层、不能是系统根；
 * 草图画布上没有这一项（只有「进入下一层」，#20c）；向已打开的设计加一张草图在草图面板的引用节点上（「在此设计」= 在会话里推出那一张）。
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
