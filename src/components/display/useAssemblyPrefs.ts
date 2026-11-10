/**
 * 「组装」叠加的本机记忆（O12）：开关在视图状态里（desk.toggles.assembly，不进 URL），按项目记在 localStorage；
 * 进入项目、模型加载后恢复，之后每次变化写回。只属于这块界面（同 useEvolutionPrefs）。
 */
import { watch } from 'vue'
import type { DeskState } from '@/state/useDeskState'

const key = (project: string) => `h5p-arch-desk:assembly:${project}`

export function readAssemblyPref(project: string): boolean {
  try {
    return localStorage.getItem(key(project)) === 'true'
  } catch {
    return false
  }
}

export function writeAssemblyPref(project: string, on: boolean) {
  try {
    localStorage.setItem(key(project), String(on))
  } catch {
    /* 存不了就算了 */
  }
}

/** 模型加载后调用：恢复记住的开关，并在之后每次变化时写回 */
export function useAssemblyPrefs(project: string, desk: Pick<DeskState, 'state' | 'setToggles'>) {
  const restore = () => {
    if (readAssemblyPref(project)) desk.setToggles({ assembly: true })
    watch(
      () => desk.state.value.toggles.assembly,
      on => writeAssemblyPref(project, on),
    )
  }
  return { restore }
}
