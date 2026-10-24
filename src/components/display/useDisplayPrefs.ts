/**
 * 「显示」面板的本机记忆（ADR-0017）：面板展开、各组折叠，按视角分别记在 localStorage；运行视角默认只展开「回放」。
 * 结构视角的显示偏好（ADR-0031）：只引类型的依赖边是否显示（typeOnly，L15）、影响面方向（impactMode，K15）、只看值依赖（valuesOnly，K15、K16），
 * 按项目记在 localStorage，画布与面板共用同一份（模块级），同 V8 的处理不进视图状态与 URL。
 * 只属于这块界面，不进视图状态与 URL。
 */
import { computed, ref, watch, type Ref, type WritableComputedRef } from 'vue'
import type { Perspective } from '@/state/transition'

export type DisplayGroup = 'rel' | 'node' | 'facts' | 'asm' | 'evo' | 'play' | 'struct' | 'rule' | 'metric' | 'shared'

const DEFAULT_GROUPS: Record<Perspective, Record<DisplayGroup, boolean>> = {
  interaction: { rel: true, node: true, facts: true, asm: true, evo: true, play: true, struct: true, rule: true, metric: true, shared: false },
  structure: { rel: true, node: true, facts: true, asm: true, evo: true, play: true, struct: true, rule: true, metric: true, shared: false },
  run: { rel: false, node: false, facts: true, asm: true, evo: true, play: true, struct: true, rule: true, metric: true, shared: false },
}

/** K15：影响面的方向——传入闭包（影响面）、传出闭包（依赖面）、两者 */
export type ImpactMode = 'in' | 'out' | 'both'

/** 结构视角的显示偏好（ADR-0031）：缺省只引类型收起、看影响面、计入只引类型 */
export interface StructurePrefs {
  typeOnly: boolean
  impactMode: ImpactMode
  valuesOnly: boolean
}

export const DEFAULT_STRUCTURE_PREFS: StructurePrefs = { typeOnly: false, impactMode: 'in', valuesOnly: false }
const IMPACT_MODES: readonly ImpactMode[] = ['in', 'out', 'both']
const structureKey = (project: string) => `h5p-arch-desk:structure:${project}`
/** 画布与面板共用：按项目一份 */
const structureStores = new Map<string, Ref<StructurePrefs>>()

function readStructure(project: string): StructurePrefs {
  const v = read<Partial<StructurePrefs>>(structureKey(project), {})
  return {
    typeOnly: v.typeOnly === true,
    impactMode: IMPACT_MODES.includes(v.impactMode as ImpactMode) ? (v.impactMode as ImpactMode) : 'in',
    valuesOnly: v.valuesOnly === true,
  }
}

/** 结构视角的显示偏好（按项目）：三个可写的 ref，写入即记到本机 */
export function useStructurePrefs(project = ''): { [K in keyof StructurePrefs]: WritableComputedRef<StructurePrefs[K]> } {
  const store = structureStores.get(project) ?? structureStores.set(project, ref(readStructure(project))).get(project)!
  const field = <K extends keyof StructurePrefs>(k: K) =>
    computed<StructurePrefs[K]>({
      get: () => store.value[k],
      set: v => {
        store.value = { ...store.value, [k]: v }
        write(structureKey(project), store.value)
      },
    })
  return { typeOnly: field('typeOnly'), impactMode: field('impactMode'), valuesOnly: field('valuesOnly') }
}

/** 测试用：丢掉内存里的偏好（下次按 localStorage 重读） */
export function resetStructurePrefs() {
  structureStores.clear()
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

export function useDisplayPrefs(perspective: Readonly<Ref<Perspective>>, project = '') {
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
  return { open, groups, toggleOpen, toggleGroup, ...useStructurePrefs(project) }
}
