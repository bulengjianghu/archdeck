/**
 * 源码同步（docs/architecture/view-state.md §4）：取被描述项目的源码清单、单个文件与导出。
 * 只负责外界：清单在进入项目、描述重新加载、用户刷新时重新取；文件与导出按路径按需取并缓存，刷新清单时作废。
 * 取数的方式由项目视图注入（开发态按 HTTP 端点，见 components/source/httpSource.ts；构建态拿到 404 即「构建产物不含源码」，G2）。
 */
import { shallowRef, type ShallowRef } from 'vue'
import type { ExportedSymbol, SourceFile, SourcePayload } from '@/model'

export interface SourceFetcher {
  tree(): Promise<SourcePayload>
  file(path: string): Promise<SourceFile | null>
  exports(path: string): Promise<ExportedSymbol[] | null>
}

export type Resource<T> = { status: 'loading' } | { status: 'ok'; value: T } | { status: 'missing' } | { status: 'error'; message: string }

/** 没有源码来源时（测试、未注入）：等同构建态 */
export const NO_SOURCE: SourceFetcher = {
  tree: async () => ({ status: 'unavailable' }),
  file: async () => null,
  exports: async () => null,
}

export function createSourceSync(fetcher: SourceFetcher) {
  /** null = 正在取清单 */
  const tree = shallowRef<SourcePayload | null>(null)
  let files = new Map<string, ShallowRef<Resource<SourceFile>>>()
  let exports = new Map<string, ShallowRef<Resource<ExportedSymbol[]>>>()
  let seq = 0

  async function refresh() {
    const my = ++seq
    files = new Map()
    exports = new Map()
    let next: SourcePayload
    try {
      next = await fetcher.tree()
    } catch (e) {
      next = { status: 'absent', reason: `读取源码清单失败：${e instanceof Error ? e.message : String(e)}` }
    }
    if (my === seq) tree.value = next
  }

  function cached<T>(cache: Map<string, ShallowRef<Resource<T>>>, path: string, get: (p: string) => Promise<T | null>): ShallowRef<Resource<T>> {
    let r = cache.get(path)
    if (r) return r
    const res = shallowRef<Resource<T>>({ status: 'loading' })
    r = res
    cache.set(path, res)
    get(path).then(
      v => (res.value = v === null ? { status: 'missing' } : { status: 'ok', value: v }),
      e => (res.value = { status: 'error', message: e instanceof Error ? e.message : String(e) }),
    )
    return res
  }

  return {
    tree,
    refresh,
    file: (path: string) => cached(files, path, fetcher.file),
    exports: (path: string) => cached(exports, path, fetcher.exports),
  }
}
