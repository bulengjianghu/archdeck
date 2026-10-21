/**
 * 舞台显示（V8、V9）：只属于画布这块界面，不进视图状态与 URL。由项目视图创建并注入，画布读取、面板写入。
 * - 静态关系显示方式：隐藏（默认）/ 淡显 / 全显，按项目记在本地；
 * - 「在画布上显示」的临时对象（视图节点 ID）：进度、选中、层次任一变化即收回。
 */
import { inject, ref, watch, type InjectionKey, type Ref } from 'vue'
import type { StaticMode } from '@/layout/stage'
import type { DeskState } from '@/state/useDeskState'

const MODES: readonly StaticMode[] = ['hide', 'dim', 'show']
const key = (project: string) => `h5p-arch-desk:stage-static:${project}`

function readMode(project: string): StaticMode {
  try {
    const v = localStorage.getItem(key(project)) as StaticMode | null
    return v && MODES.includes(v) ? v : 'hide'
  } catch {
    return 'hide'
  }
}

export interface StageDisplayState {
  mode: Ref<StaticMode>
  setMode(mode: StaticMode): void
  /** 「在画布上显示」的视图节点；为空表示没有 */
  reveal: Ref<readonly string[]>
  toggleReveal(nodeIds: readonly string[]): void
}

export function useStageDisplay(project: string, desk: Pick<DeskState, 'playback' | 'selection' | 'levelId'>): StageDisplayState {
  const mode = ref<StaticMode>(readMode(project))
  const reveal = ref<readonly string[]>([])

  function setMode(m: StaticMode) {
    mode.value = m
    try {
      localStorage.setItem(key(project), m)
    } catch {
      /* 存不了就算了 */
    }
  }
  function toggleReveal(nodeIds: readonly string[]) {
    const same = reveal.value.length === nodeIds.length && nodeIds.every(id => reveal.value.includes(id))
    reveal.value = same ? [] : [...nodeIds]
  }

  // V9：进度、选中、层次任一变化即收回
  watch(
    () => [desk.playback.value?.frameId, desk.playback.value?.scenarioId, desk.selection.value, desk.levelId.value] as const,
    () => (reveal.value = []),
  )

  return { mode, setMode, reveal, toggleReveal }
}

export const STAGE_DISPLAY: InjectionKey<StageDisplayState> = Symbol('h5p-arch-desk:stage-display')

/** 没有项目视图注入时（单测挂载组件）：照常显示、无临时对象 */
export const useStage = () =>
  inject(STAGE_DISPLAY, () => ({ mode: ref<StaticMode>('hide'), setMode: () => {}, reveal: ref<readonly string[]>([]), toggleReveal: () => {} }), true)
