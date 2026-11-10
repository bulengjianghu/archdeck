/** 视图区里正在拖的标签（LY-10）：视图区提供、各组的标签栏取用；只属于这块界面 */
import { ref, type InjectionKey, type Ref } from 'vue'

export const TAB_DRAG: InjectionKey<Ref<string | null>> = Symbol('h5p-arch-desk:tab-drag')
export const noDrag = () => ref<string | null>(null)
