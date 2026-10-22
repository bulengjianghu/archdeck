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
  /** S18：预览要滚到的行；没有时从头显示 */
  const previewLine = ref<number | null>(null)
  const tab = ref<AsideTab>('sequence')
  const run = computed(() => desk.perspective.value === 'run')

  function open(path: string, line?: number) {
    previewPath.value = path
    previewLine.value = line ?? null
    tab.value = 'source'
  }
  function close() {
    previewPath.value = null
    previewLine.value = null
    tab.value = 'sequence'
  }

  watch(
    () => desk.files.selected.value,
    f => f && open(f),
    { immediate: true },
  )
  // 三个值分开监听：只在视角、场景或帧真的变了时切页签；描述重新加载（N5）后 playback 换了对象但场景与帧不变，不切
  watch([run, () => desk.playback.value?.scenarioId, () => desk.playback.value?.frameId], ([r], prev) => {
    if (r) tab.value = 'sequence'
    else if (prev?.[0] && previewPath.value) tab.value = 'source'
  })

  return {
    previewPath,
    previewLine,
    tab,
    run,
    hidden: computed(() => !run.value && !previewPath.value),
    open,
    close,
  }
}
