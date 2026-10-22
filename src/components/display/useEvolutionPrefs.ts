/**
 * 「演化」叠加的本机记忆（J5）：热度种类与时间耦合开关在视图状态里（desk.toggles.heat / coupling，不进 URL），
 * 按项目记在 localStorage；进入项目、模型加载后恢复，之后每次变化写回。只属于这块界面。
 */
import { watch } from 'vue'
import { HEAT_KINDS, type HeatKind } from '@/model'
import type { DeskState } from '@/state/useDeskState'

const key = (project: string) => `h5p-arch-desk:evolution:${project}`

export interface EvolutionPrefs {
  heat: 'off' | HeatKind
  coupling: boolean
}

export function readEvolutionPrefs(project: string): EvolutionPrefs {
  try {
    const raw = localStorage.getItem(key(project))
    const v = raw ? (JSON.parse(raw) as Partial<EvolutionPrefs>) : {}
    return {
      heat: v.heat === 'off' || (typeof v.heat === 'string' && (HEAT_KINDS as readonly string[]).includes(v.heat)) ? (v.heat as EvolutionPrefs['heat']) : 'off',
      coupling: v.coupling === true,
    }
  } catch {
    return { heat: 'off', coupling: false }
  }
}

export function writeEvolutionPrefs(project: string, prefs: EvolutionPrefs) {
  try {
    localStorage.setItem(key(project), JSON.stringify(prefs))
  } catch {
    /* 存不了就算了 */
  }
}

/** 模型加载后调用：恢复记住的开关，并在之后每次变化时写回 */
export function useEvolutionPrefs(project: string, desk: Pick<DeskState, 'state' | 'setToggles'>) {
  const restore = () => {
    const p = readEvolutionPrefs(project)
    if (p.heat !== 'off' || p.coupling) desk.setToggles(p)
    watch(
      () => [desk.state.value.toggles.heat, desk.state.value.toggles.coupling] as const,
      ([heat, coupling]) => writeEvolutionPrefs(project, { heat, coupling }),
    )
  }
  return { restore }
}
