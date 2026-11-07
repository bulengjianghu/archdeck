/**
 * 侧栏的页（LY-4，ADR-0064）：模块、场景、改动（只在设计的草图编辑时可用）。页由项目视图持有（画布的改动徽标、场景胶囊要能切页），
 * 只属于这块界面，不进视图状态与 URL。模块页里「按模块 / 按文件」两种树（LY-4b）同样只属于界面。
 */
import { inject, ref, type InjectionKey, type Ref } from 'vue'

export type SidePage = 'modules' | 'scenes' | 'changes'
export type ModulesMode = 'modules' | 'files'

export interface SideNav {
  page: Ref<SidePage>
  mode: Ref<ModulesMode>
}

export const SIDE_NAV: InjectionKey<SideNav> = Symbol('h5p-arch-desk:side-nav')

/** 没有项目视图提供时（单测直接挂侧栏）用自己的 */
export const useSideNav = (): SideNav => inject(SIDE_NAV, () => ({ page: ref<SidePage>('modules'), mode: ref<ModulesMode>('modules') }), true)
