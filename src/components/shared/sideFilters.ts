/**
 * 侧栏页的筛选（LY-4d，负责人 2026-11-08 走查）：模块页——树（按模块 / 按文件，模式在 SIDE_NAV）、排序（J8）、只看需复核（Z3）；
 * 场景页——范围（本层相关 / 全部，R4）、类别（主流程 / 全部类别，R17，记在本机）、发起者（R4a）。
 * 都收进侧栏页名一行右端的「筛选 ▾」弹层；画布页头的「场景 ▾」下拉（LY-5a，与场景页同一组件）读同一份。
 * 只属于界面，由项目视图持有，不进视图状态与 URL。
 */
import { inject, ref, watch, type InjectionKey, type Ref } from 'vue'

export interface SideFilters {
  sort: Ref<'order' | 'heat'>
  onlyStale: Ref<boolean>
  scope: Ref<'level' | 'all'>
  kinds: Ref<'main' | 'all'>
  trigger: Ref<string>
}

export const SIDE_FILTERS: InjectionKey<SideFilters> = Symbol('h5p-arch-desk:side-filters')

/** R17：类别筛选记在本机（所有项目共用），不进 URL */
const KINDS_KEY = 'h5p-arch-desk:scenario-kinds'
const readKinds = (): 'main' | 'all' => {
  try {
    return localStorage.getItem(KINDS_KEY) === 'all' ? 'all' : 'main'
  } catch {
    return 'main'
  }
}

export function createSideFilters(): SideFilters {
  const kinds = ref<'main' | 'all'>(readKinds())
  watch(kinds, v => {
    try {
      localStorage.setItem(KINDS_KEY, v)
    } catch {
      /* 存不了就算了 */
    }
  })
  return { sort: ref('order'), onlyStale: ref(false), scope: ref('level'), kinds, trigger: ref('') }
}

/** 没有项目视图提供时（单测直接挂组件）用自己的 */
export const useSideFilters = (): SideFilters => inject(SIDE_FILTERS, createSideFilters, true)

/** 生效的筛选数（「筛选 · N」）：模块页不是缺省的项；场景页没选「全部」的项（本层相关、主流程也在筛） */
export function activeFilterCount(page: 'modules' | 'scenes', f: SideFilters, mode: 'modules' | 'files'): number {
  return page === 'modules'
    ? Number(mode !== 'modules') + Number(f.sort.value !== 'order') + Number(f.onlyStale.value)
    : Number(f.scope.value !== 'all') + Number(f.kinds.value !== 'all') + Number(!!f.trigger.value)
}
