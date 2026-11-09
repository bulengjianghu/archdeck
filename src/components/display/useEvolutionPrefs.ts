/**
 * 「演化」叠加的本机记忆（J5）：热度种类与时间耦合开关在视图状态里（desk.toggles.heat / coupling，不进 URL），
 * 按项目记在 localStorage；进入项目、模型加载后恢复，之后每次变化写回。只属于这块界面。
 * L49（ADR-0056）：热度的开关在图例的热度行、口径在「显示 ▾」——口径另记一份（useHeatKind），图例打开热度时用它；热度开着时口径跟着记。
 */
import { shallowRef, watch, type Ref } from 'vue'
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

const kindKey = (project: string) => `h5p-arch-desk:heat-kind:${project}`
const kindStores = new Map<string, Ref<HeatKind>>()

/** L49：热度口径（修改 / 缺陷），同一项目共用一份；缺省「修改」 */
export function useHeatKind(project = ''): Ref<HeatKind> {
  const hit = kindStores.get(project)
  if (hit) return hit
  let init: HeatKind = HEAT_KINDS[0]
  try {
    const raw = localStorage.getItem(kindKey(project))
    if (raw && (HEAT_KINDS as readonly string[]).includes(raw)) init = raw as HeatKind
  } catch {
    /* 读不了就用缺省 */
  }
  const kind = shallowRef<HeatKind>(init)
  watch(kind, k => {
    try {
      localStorage.setItem(kindKey(project), k)
    } catch {
      /* 存不了就算了 */
    }
  })
  kindStores.set(project, kind)
  return kind
}

/** 单测用：清掉模块级的口径缓存 */
export function resetHeatKind() {
  kindStores.clear()
}

/**
 * L45、L49：图例热度行的开关——关着打开为记住的口径，开着关掉；菜单选口径——热度开着时立即换，关着只记下。
 * 热度开着时（含从本机记忆恢复）口径跟着视图状态记。
 */
export function heatControls(project: string, desk: Pick<DeskState, 'state' | 'setToggles'>) {
  const kind = useHeatKind(project)
  watch(
    () => desk.state.value.toggles.heat,
    h => {
      if (h !== 'off') kind.value = h
    },
    { immediate: true },
  )
  return {
    kind,
    toggle: () => desk.setToggles({ heat: desk.state.value.toggles.heat === 'off' ? kind.value : 'off' }),
    choose: (k: HeatKind) => {
      kind.value = k
      if (desk.state.value.toggles.heat !== 'off') desk.setToggles({ heat: k })
    },
  }
}
