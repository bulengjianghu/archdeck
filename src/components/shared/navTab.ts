/** 导航树的页签（T1）由项目视图持有：画布上的问题角标要能切到「问题」页签（W-6）。只属于这块界面，不进视图状态与 URL */
import { inject, ref, type InjectionKey, type Ref } from 'vue'

export type NavTab = 'modules' | 'files' | 'steps' | 'issues' | 'changes'

export const NAV_TAB: InjectionKey<Ref<NavTab>> = Symbol('h5p-arch-desk:nav-tab')

/** 没有项目视图提供时（单测直接挂导航树）用自己的页签 */
export const useNavTab = (initial: NavTab) => inject(NAV_TAB, () => ref<NavTab>(initial), true)
