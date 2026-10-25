/**
 * C9、L20④、A6：面板里「定位到某个表面元素」的请求——画布单击元素（选中其模块）或单击元素级边（选中束 `sel=d:`）时由画布发出，
 * 模块「表面」一节与依赖边面板「文件依赖」一节收到后把该元素滚进视野并短暂高亮。不新增选中种类、不进 URL（C9），
 * 只是一次浏览动作的提示，所以放在呈现层（同一页面共用一份）；面板内「端口」与「表面」两节的互相定位也走这里。
 */
import { shallowRef, type ShallowRef } from 'vue'

export interface SurfaceFocus {
  /** 元素所属的模块（表面所属的模块） */
  module: string
  /** 元素名；越过入口为 `!`、整模块为 `*` */
  element: string
  /** 同一元素重复请求时也能触发 */
  seq: number
}

const focus = shallowRef<SurfaceFocus | null>(null)
let seq = 0

/** 请求面板定位到 module 的表面元素 element */
export function focusSurfaceElement(module: string, element: string) {
  focus.value = { module, element, seq: ++seq }
}

/** 读与消费（定位成功后置 null） */
export const useSurfaceFocus = (): ShallowRef<SurfaceFocus | null> => focus

/** 单测用 */
export function resetSurfaceFocus() {
  focus.value = null
}

/** 在 root 里找 `[data-element="<name>"]` 滚进视野并闪一下；找不到返回 false */
export function revealIn(root: Element | null | undefined, element: string): boolean {
  const esc = element.replace(/["\\]/g, '\\$&')
  const el = root?.querySelector(`[data-element="${esc}"]`)
  if (!el) return false
  ;(el as HTMLElement).scrollIntoView?.({ block: 'nearest' })
  el.classList.remove('flash')
  void (el as HTMLElement).offsetWidth
  el.classList.add('flash')
  return true
}
