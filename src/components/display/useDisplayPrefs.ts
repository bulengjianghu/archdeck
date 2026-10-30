/**
 * 图例的本机记忆（L48，ADR-0056）：图例的收放按项目记在 localStorage，没记过（第一次进入这个项目）为展开；
 * 各组折叠按视角分别记，运行视角默认只展开「回放」。
 * 结构视角的显示偏好（ADR-0031、ADR-0032）：只引类型的束是否画出（typeOnly，L15、B1，缺省收起）、只看交互使用（invokesOnly，B1）、
 * 只看交互未覆盖（uncoveredOnly，B4）、总是展开表面（surfaceAlways，C6）、
 * 只看值依赖（valuesOnly，K16、U17，缺省否）——开关缺省都关；影响面方向第十一轮起是视图状态的一次性查询 impactQuery（K15b，ADR-0037），不在这里，本地记着的旧 impactMode 忽略；按项目记在本地、各组件共享同一份（画布读、面板写），不进视图状态与 URL。
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

export interface StructurePrefsValue {
  /** L15：只引类型的依赖边画出（缺省 false：收起，画布角计数） */
  typeOnly: boolean
  /** K16、U17：只看值依赖（去掉只引类型重算指标与逆稳定；影响面查询另有「含只引类型」，K15b） */
  valuesOnly: boolean
  /** B1：只画交互使用档的束（值使用也收起；基线外违规、环上的、逆稳定的照画） */
  invokesOnly: boolean
  /** B4：只画交互覆盖数为 0 的束（K17，查缺口） */
  uncoveredOnly: boolean
  /** C6：本层全部模块总是展开表面 */
  surfaceAlways: boolean
}

export const DEFAULT_STRUCTURE_PREFS: StructurePrefsValue = {
  typeOnly: false,
  valuesOnly: false,
  invokesOnly: false,
  uncoveredOnly: false,
  surfaceAlways: false,
}

export interface StructurePrefs {
  prefs: Readonly<Ref<StructurePrefsValue>>
  setTypeOnly(v: boolean): void
  setValuesOnly(v: boolean): void
  setInvokesOnly(v: boolean): void
  setUncoveredOnly(v: boolean): void
  setSurfaceAlways(v: boolean): void
}

const FLAGS = ['typeOnly', 'valuesOnly', 'invokesOnly', 'uncoveredOnly', 'surfaceAlways'] as const

const structureStores = new Map<string, StructurePrefs>()

/** 结构视角的显示偏好：同一项目共用一份（模块级），改动即记到 localStorage（键 h5p-arch-desk:structure-prefs:<项目>） */
export function useStructurePrefs(project = ''): StructurePrefs {
  const hit = structureStores.get(project)
  if (hit) return hit
  const key = `h5p-arch-desk:structure-prefs:${project}`
  const raw = read<Partial<StructurePrefsValue>>(key, {})
  const prefs = shallowRef<StructurePrefsValue>({
    ...DEFAULT_STRUCTURE_PREFS,
    ...Object.fromEntries(FLAGS.flatMap(k => (typeof raw[k] === 'boolean' ? [[k, raw[k]]] : []))),
  })
  const set = (patch: Partial<StructurePrefsValue>) => {
    prefs.value = { ...prefs.value, ...patch }
    write(key, prefs.value)
  }
  const store: StructurePrefs = {
    prefs,
    setTypeOnly: v => set({ typeOnly: v }),
    setValuesOnly: v => set({ valuesOnly: v }),
    setInvokesOnly: v => set({ invokesOnly: v }),
    setUncoveredOnly: v => set({ uncoveredOnly: v }),
    setSurfaceAlways: v => set({ surfaceAlways: v }),
  }
  structureStores.set(project, store)
  return store
}

/** 单测用：清掉模块级的偏好缓存 */
export function resetStructurePrefs() {
  structureStores.clear()
}

/** L48：图例收放的键——按项目，不分视角 */
export const legendOpenKey = (project = '') => `h5p-arch-desk:legend-open:${project}`

export function useDisplayPrefs(perspective: Readonly<Ref<Perspective>>, project?: string) {
  const GROUPS_KEY = () => `h5p-arch-desk:display-groups:${perspective.value}`
  const readGroups = () => ({ ...DEFAULT_GROUPS[perspective.value], ...read<Partial<Record<DisplayGroup, boolean>>>(GROUPS_KEY(), {}) })

  // L48：第一次进入项目（没有记过）展开，之后按记住的
  const open = ref(read(legendOpenKey(project), true))
  const groups = ref(readGroups())
  watch(perspective, () => (groups.value = readGroups()))

  function toggleOpen() {
    open.value = !open.value
    write(legendOpenKey(project), open.value)
  }
  function toggleGroup(g: DisplayGroup) {
    groups.value = { ...groups.value, [g]: !groups.value[g] }
    write(GROUPS_KEY(), groups.value)
  }
  // ADR-0031：结构视角的显示偏好（与画布共享同一份）
  const structure = useStructurePrefs(project)
  return { open, groups, toggleOpen, toggleGroup, ...structure }
}
