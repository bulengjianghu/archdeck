/**
 * 「显示」面板的本机记忆（ADR-0017）：面板展开、各组折叠，按视角分别记在 localStorage；运行视角默认只展开「回放」。
 * 结构视角的显示偏好（ADR-0031）：只引类型的依赖边是否画出（typeOnly，L15，缺省收起）、影响面画哪个方向（impactMode，K15，缺省传入）、
 * 只看值依赖（valuesOnly，K15、K16，缺省否）——按项目记在本地、各组件共享同一份（画布读、面板写），不进视图状态与 URL。
 * 只属于这块界面，不进视图状态与 URL。
 */
import { ref, shallowRef, watch, type Ref } from 'vue'
import type { Perspective } from '@/state/transition'

export type DisplayGroup = 'rel' | 'node' | 'facts' | 'asm' | 'evo' | 'play' | 'struct' | 'rule' | 'metric' | 'shared'

const DEFAULT_GROUPS: Record<Perspective, Record<DisplayGroup, boolean>> = {
  interaction: { rel: true, node: true, facts: true, asm: true, evo: true, play: true, struct: true, rule: true, metric: true, shared: false },
  structure: { rel: true, node: true, facts: true, asm: true, evo: true, play: true, struct: true, rule: true, metric: true, shared: false },
  run: { rel: false, node: false, facts: true, asm: true, evo: true, play: true, struct: true, rule: true, metric: true, shared: false },
}

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 存不了就算了 */
  }
}

/** K15：影响面画哪个方向——传入（影响面，缺省）、传出（依赖面）、两者 */
export type ImpactMode = 'in' | 'out' | 'both'
const IMPACT_MODES: readonly ImpactMode[] = ['in', 'out', 'both']

export interface StructurePrefsValue {
  /** L15：只引类型的依赖边画出（缺省 false：收起，画布角计数） */
  typeOnly: boolean
  /** K15：影响面的方向 */
  impactMode: ImpactMode
  /** K15、K16：只看值依赖（去掉只引类型重算影响面与指标） */
  valuesOnly: boolean
}

export const DEFAULT_STRUCTURE_PREFS: StructurePrefsValue = { typeOnly: false, impactMode: 'in', valuesOnly: false }

export interface StructurePrefs {
  prefs: Readonly<Ref<StructurePrefsValue>>
  setTypeOnly(v: boolean): void
  setImpactMode(v: ImpactMode): void
  setValuesOnly(v: boolean): void
}

const structureStores = new Map<string, StructurePrefs>()

/** 结构视角的显示偏好：同一项目共用一份（模块级），改动即记到 localStorage（键 h5p-arch-desk:structure-prefs:<项目>） */
export function useStructurePrefs(project = ''): StructurePrefs {
  const hit = structureStores.get(project)
  if (hit) return hit
  const key = `h5p-arch-desk:structure-prefs:${project}`
  const raw = read<Partial<StructurePrefsValue>>(key, {})
  const prefs = shallowRef<StructurePrefsValue>({
    typeOnly: typeof raw.typeOnly === 'boolean' ? raw.typeOnly : DEFAULT_STRUCTURE_PREFS.typeOnly,
    impactMode: raw.impactMode && IMPACT_MODES.includes(raw.impactMode) ? raw.impactMode : DEFAULT_STRUCTURE_PREFS.impactMode,
    valuesOnly: typeof raw.valuesOnly === 'boolean' ? raw.valuesOnly : DEFAULT_STRUCTURE_PREFS.valuesOnly,
  })
  const set = (patch: Partial<StructurePrefsValue>) => {
    prefs.value = { ...prefs.value, ...patch }
    write(key, prefs.value)
  }
  const store: StructurePrefs = {
    prefs,
    setTypeOnly: v => set({ typeOnly: v }),
    setImpactMode: v => set({ impactMode: v }),
    setValuesOnly: v => set({ valuesOnly: v }),
  }
  structureStores.set(project, store)
  return store
}

/** 单测用：清掉模块级的偏好缓存 */
export function resetStructurePrefs() {
  structureStores.clear()
}

export function useDisplayPrefs(perspective: Readonly<Ref<Perspective>>, project?: string) {
  const OPEN_KEY = () => `h5p-arch-desk:display-open:${perspective.value}`
  const GROUPS_KEY = () => `h5p-arch-desk:display-groups:${perspective.value}`
  const readOpen = () => read(OPEN_KEY(), perspective.value !== 'run')
  const readGroups = () => ({ ...DEFAULT_GROUPS[perspective.value], ...read<Partial<Record<DisplayGroup, boolean>>>(GROUPS_KEY(), {}) })

  const open = ref(readOpen())
  const groups = ref(readGroups())
  watch(perspective, () => {
    open.value = readOpen()
    groups.value = readGroups()
  })

  function toggleOpen() {
    open.value = !open.value
    write(OPEN_KEY(), open.value)
  }
  function toggleGroup(g: DisplayGroup) {
    groups.value = { ...groups.value, [g]: !groups.value[g] }
    write(GROUPS_KEY(), groups.value)
  }
  // ADR-0031：结构视角的显示偏好（与画布共享同一份）
  const structure = useStructurePrefs(project)
  return { open, groups, toggleOpen, toggleGroup, ...structure }
}
