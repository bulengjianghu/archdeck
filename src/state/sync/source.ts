/**
 * 源码同步（docs/architecture/view-state.md §4）：取被描述项目的源码清单、单个文件与导出。
 * 只负责外界：清单在进入项目、描述重新加载、用户刷新时重新取；文件与导出按路径按需取并缓存，刷新清单时作废。
 * 取数的方式由项目视图注入（开发服务器的 HTTP 端点，见 components/source/httpSource.ts）；源码在本地是前提，取不到清单为 error（G1）。
 */
import { shallowRef, type ShallowRef } from 'vue'
import type { ExportedSymbol, FactsPayload, SourceFile, SourceHistory, SourcePayload } from '@/model'
import type { Resource, SourceSyncPort } from '../desk/ports'

export interface SourceFetcher {
  tree(): Promise<SourcePayload>
  file(path: string): Promise<SourceFile | null>
  exports(path: string): Promise<ExportedSymbol[] | null>
  /** K8：代码事实、基线与拦截记录；没有注入时为 null */
  facts?(): Promise<FactsPayload | null>
  /** J1：git 历史；没有注入时为 null */
  history?(): Promise<SourceHistory | null>
  /** 一个提交的完整说明（面板展开时按需取）；不存在为 null */
  commit?(hash: string): Promise<{ hash: string; message: string } | null>
}

export type CommitMessage = { hash: string; message: string }

export type { Resource } from '../desk/ports'

/** 没有注入源码来源时（只看描述的测试）：清单为 error */
export const NO_SOURCE: SourceFetcher = {
  tree: async () => ({ status: 'error', reason: '没有注入源码来源' }),
  file: async () => null,
  exports: async () => null,
}

export function createSourceSync(fetcher: SourceFetcher): SourceSyncPort {
  /** null = 正在取清单 */
  const tree = shallowRef<SourcePayload | null>(null)
  /** K8：清单取到后随后取代码事实；null = 没有（清单读取失败、未注入） */
  const facts = shallowRef<Resource<FactsPayload> | null>(null)
  /** J1：清单取到后随事实一起取 git 历史；null = 没有（清单读取失败、未注入） */
  const history = shallowRef<Resource<SourceHistory> | null>(null)
  let files = new Map<string, ShallowRef<Resource<SourceFile>>>()
  let exports = new Map<string, ShallowRef<Resource<ExportedSymbol[]>>>()
  let commits = new Map<string, ShallowRef<Resource<CommitMessage>>>()
  let seq = 0

  async function refresh() {
    const my = ++seq
    files = new Map()
    exports = new Map()
    commits = new Map()
    let next: SourcePayload
    try {
      next = await fetcher.tree()
    } catch (e) {
      next = { status: 'error', reason: `读取源码清单失败：${e instanceof Error ? e.message : String(e)}` }
    }
    if (my !== seq) return
    tree.value = next
    if (next.status !== 'local') {
      facts.value = null
      history.value = null
      return
    }
    // 事实与历史各自取、互不等待
    const fetchFacts = async () => {
      if (!fetcher.facts) return (facts.value = null)
      facts.value = { status: 'loading' }
      try {
        const f = await fetcher.facts()
        if (my === seq) facts.value = f ? { status: 'ok', value: f } : null
      } catch (e) {
        if (my === seq) facts.value = { status: 'error', message: e instanceof Error ? e.message : String(e) }
      }
    }
    const fetchHistory = async () => {
      if (!fetcher.history) return (history.value = null)
      history.value = { status: 'loading' }
      try {
        const h = await fetcher.history()
        if (my === seq) history.value = h ? { status: 'ok', value: h } : null
      } catch (e) {
        if (my === seq) history.value = { status: 'error', message: e instanceof Error ? e.message : String(e) }
      }
    }
    await Promise.all([fetchFacts(), fetchHistory()])
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
    facts,
    history,
    refresh,
    file: (path: string) => cached(files, path, fetcher.file),
    exports: (path: string) => cached(exports, path, fetcher.exports),
    commit: (hash: string) => cached(commits, hash, fetcher.commit ?? (async () => null)),
  }
}
