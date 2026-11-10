/** 测试用：竖栏 + 侧栏，共用项目视图持有的页（SIDE_NAV）与筛选（SIDE_FILTERS），同 DeskView */
import { defineComponent, h, provide, ref } from 'vue'
import SideBar from '../../src/components/tree/SideBar.vue'
import SideRail from '../../src/components/tree/SideRail.vue'
import { SIDE_NAV, type ModulesMode, type SidePage } from '../../src/components/shared/navTab'
import { SIDE_FILTERS, createSideFilters } from '../../src/components/shared/sideFilters'

export const SideHost = defineComponent({
  name: 'SideHost',
  setup() {
    provide(SIDE_NAV, { page: ref<SidePage>('modules'), mode: ref<ModulesMode>('modules') })
    provide(SIDE_FILTERS, createSideFilters())
    return () => [h(SideRail), h(SideBar)]
  },
})

const RAIL: Record<string, string> = { 模块: 'modules', 场景: 'scenes', 改动: 'changes' }

/** 切到侧栏某一页（竖栏图标）；「文件」= 模块页「筛选 ▾」里的按文件树（LY-4b、LY-4d） */
export function sideTab(wrapper: { find: (s: string) => { trigger: (e: string) => Promise<void>; exists: () => boolean } }, name: string) {
  return {
    trigger: async (e: string) => {
      if (name !== '文件') return wrapper.find(`[data-rail=${RAIL[name]}]`).trigger(e)
      if (!wrapper.find('[data-side-mode=files]').exists()) await wrapper.find('[data-side-filter]').trigger('click')
      return wrapper.find('[data-side-mode=files]').trigger(e)
    },
  }
}
