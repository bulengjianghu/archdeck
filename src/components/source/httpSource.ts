/**
 * 按 HTTP 端点取被描述项目的源码（开发态由 ModelSource 插件提供，docs/architecture/source.md §2.1），注入给 DeskState 的源码同步。
 * 与 fetchModel 一样由项目视图创建：外界的地址只在呈现层出现。构建态没有这些端点，清单 404 即 unavailable（G2）。
 */
import type { ExportedSymbol, SourceFile, SourcePayload } from '@/model'
import type { SourceFetcher } from '@/state/useDeskState'

export function httpSourceFetcher(project: string, base = ''): SourceFetcher {
  const enc = encodeURIComponent
  const get = async <T>(url: string): Promise<T | null> => {
    const res = await fetch(`${base}${url}`, { cache: 'no-store' })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json() as Promise<T>
  }
  return {
    tree: async () => (await get<SourcePayload>(`source/${enc(project)}.json`)) ?? { status: 'unavailable' },
    file: path => get<SourceFile>(`source/${enc(project)}/file.json?path=${enc(path)}`),
    exports: path => get<ExportedSymbol[]>(`source/${enc(project)}/exports.json?path=${enc(path)}`),
  }
}

