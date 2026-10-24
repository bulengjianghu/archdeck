/**
 * 「显示」面板的本机记忆（ADR-0017）：面板展开、各组折叠，按视角分别记在 localStorage；运行视角默认只展开「回放」。
 * 只属于这块界面，不进视图状态与 URL。
 */
import { ref, watch, type Ref } from 'vue'
import type { Perspective } from '@/state/transition'

export type DisplayGroup = 'rel' | 'node' | 'facts' | 'asm' | 'evo' | 'play'

const DEFAULT_GROUPS: Record<Perspective, Record<DisplayGroup, boolean>> = {
  structure: { rel: true, node: true, facts: true, asm: true, evo: true, play: true },
  run: { rel: false, node: false, facts: true, asm: true, evo: true, play: true },
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

export function useDisplayPrefs(perspective: Readonly<Ref<Perspective>>) {
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
  return { open, groups, toggleOpen, toggleGroup }
}
