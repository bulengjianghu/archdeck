/**
 * 副栏的页签与预览文件（G15）：只属于这块界面，不进视图状态与 URL。
 * - 选中文件 → 「源代码」并以它为预览文件；打开场景、移动播放头 → 「时序图」；
 * - 预览文件保留到用户关闭；副栏在运行视角或有预览文件时出现，结构视角下关闭预览后消失。
 */
import { computed, ref, watch } from 'vue'
import type { DeskState } from '@/state/useDeskState'

export type AsideTab = 'sequence' | 'source'

export function useAside(desk: Pick<DeskState, 'files' | 'perspective' | 'playback'>) {
  const previewPath = ref<string | null>(null)
  const tab = ref<AsideTab>('sequence')
  const run = computed(() => desk.perspective.value === 'run')

  function open(path: string) {
    previewPath.value = path
    tab.value = 'source'
  }
  function close() {
    previewPath.value = null
    tab.value = 'sequence'
  }

  watch(
    () => desk.files.selected.value,
    f => f && open(f),
    { immediate: true },
  )
  watch(
    () => [run.value, desk.playback.value?.scenarioId, desk.playback.value?.frameId] as const,
    ([r], prev) => {
      if (r) tab.value = 'sequence'
      else if (prev?.[0] && previewPath.value) tab.value = 'source'
    },
  )

  return {
    previewPath,
    tab,
    run,
    hidden: computed(() => !run.value && !previewPath.value),
    open,
    close,
  }
}
