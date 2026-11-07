/**
 * 工作区的本机记忆（LY-3、LY-10b、LY-11b、LY-12a，ADR-0064）：同步适配器——启动时把本机记下的排布、视图区开合与宽度、
 * 侧栏开合与宽度读进工作区状态（restore），之后状态里这几样一变就写回。工作区状态本身不知道存储。
 * 没有记忆时侧栏按窗口宽度推出缺省（LY-3：≥ 1440 展开）。读回的值形状不对就丢弃、按缺省。
 */
import { watch, type ShallowRef } from 'vue'
import {
  DEFAULT_SIDEBAR_WIDTH,
  LAYOUT_CONTEXTS,
  defaultSidebarOpen,
  validArrangement,
  type Arrangement,
  type LayoutContext,
  type SidebarState,
  type WorkspaceAction,
  type WorkspaceState,
} from '../transition'

/** 本机存储（浏览器里是 localStorage 的包装；读写失败当作没有） */
export interface WorkspaceMemory {
  get(key: string): string | null
  set(key: string, value: string): void
  /** 窗口宽度（LY-3 的缺省） */
  windowWidth(): number
}

export const WORKSPACE_KEY = 'h5p-arch-desk:workspace'

interface Stored {
  memory?: Partial<Record<LayoutContext, Arrangement>>
  collapsed?: boolean
  width?: number
  sidebar?: SidebarState
}

/** 读回本机记下的工作区（纯：只依赖传入的存储）；形状不对的项按缺省 */
export function readWorkspaceMemory(store: WorkspaceMemory): Extract<WorkspaceAction, { type: 'restore' }> {
  let raw: Stored = {}
  try {
    const text = store.get(WORKSPACE_KEY)
    const parsed: unknown = text ? JSON.parse(text) : {}
    if (parsed && typeof parsed === 'object') raw = parsed as Stored
  } catch {
    raw = {}
  }
  const memory: Partial<Record<LayoutContext, Arrangement>> = {}
  for (const c of LAYOUT_CONTEXTS) {
    const a = validArrangement(raw.memory?.[c])
    if (a) memory[c] = a
  }
  const sb = raw.sidebar
  const sidebar: SidebarState =
    sb && typeof sb.open === 'boolean' && typeof sb.width === 'number' && Number.isFinite(sb.width)
      ? { open: sb.open, width: sb.width }
      : { open: defaultSidebarOpen(store.windowWidth()), width: DEFAULT_SIDEBAR_WIDTH }
  return {
    type: 'restore',
    memory,
    sidebar,
    ...(typeof raw.collapsed === 'boolean' ? { collapsed: raw.collapsed } : {}),
    ...(typeof raw.width === 'number' && Number.isFinite(raw.width) ? { width: raw.width } : {}),
  }
}

export function storedOf(s: WorkspaceState): Stored {
  return { memory: s.memory, collapsed: s.collapsed, width: s.width, sidebar: s.sidebar }
}

/** 启动时读回一次，之后记忆、开合与宽度变化即写回（排布本身随标签开关时时在变，只写人改过而记下的 memory） */
export function attachWorkspaceMemory(store: WorkspaceMemory, state: ShallowRef<WorkspaceState>, dispatch: (a: WorkspaceAction) => void) {
  dispatch(readWorkspaceMemory(store))
  watch(
    () => JSON.stringify(storedOf(state.value)),
    text => {
      try {
        store.set(WORKSPACE_KEY, text)
      } catch {
        /* 存不了就算了 */
      }
    },
  )
}

/** 浏览器的本机存储（读写失败当作没有） */
export function browserMemory(): WorkspaceMemory {
  return {
    get: key => {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    set: (key, value) => {
      try {
        localStorage.setItem(key, value)
      } catch {
        /* 存不了就算了 */
      }
    },
    windowWidth: () => (typeof window === 'undefined' ? 0 : window.innerWidth),
  }
}
