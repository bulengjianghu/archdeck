/**
 * LY-15：视图里悬停一个模块引用，画布上提示它的位置——取它在当前层次可见的那个节点（自己，或最近的可见祖先），
 * 设为悬停（画布按悬停突出，不移动视口）；离开即清除。纯函数 + 一个给视图区用的事件处理器。
 */
export function peekNodeOf(path: readonly string[], visible: ReadonlySet<string>): string | null {
  for (let i = path.length - 1; i >= 0; i--) if (visible.has(path[i])) return path[i]
  return null
}

export interface PeekDeps {
  pathOf: (id: string) => readonly string[] | undefined
  visible: () => ReadonlySet<string>
  setHover: (id: string | null) => void
}

/** 视图区的委托处理：鼠标进到带 data-ref-module 的元素即提示，离开即清除；只在变化时发意图 */
export function createRefPeek(deps: PeekDeps) {
  let current: string | null = null
  const peek = (module: string | null) => {
    const node = module ? peekNodeOf(deps.pathOf(module) ?? [module], deps.visible()) : null
    if (node === current) return
    current = node
    deps.setHover(node)
  }
  const onOver = (e: Event) => {
    const el = e.target instanceof Element ? e.target.closest('[data-ref-module]') : null
    peek(el?.getAttribute('data-ref-module') ?? null)
  }
  const onLeave = () => peek(null)
  return { peek, onOver, onLeave }
}
