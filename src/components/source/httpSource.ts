/**
 * 按 HTTP 端点取被描述项目的源码（开发态由 ModelSource 插件提供，docs/architecture/source.md §2.1），注入给 DeskState 的源码同步。
 * 与 fetchModel 一样由项目视图创建：外界的地址只在呈现层出现。取不到清单时为 error（附原因）。
 */
import type { ExportedSymbol, FactsPayload, SourceFile, SourceHistory, SourcePayload } from '@/model'
import type { ModelWriter, SourceFetcher, WriteOutcome } from '@/state/useDeskState'

export function httpSourceFetcher(project: string, base = ''): SourceFetcher {
  const enc = encodeURIComponent
  const get = async <T>(url: string): Promise<T | null> => {
    const res = await fetch(`${base}${url}`, { cache: 'no-store' })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json() as Promise<T>
  }
  return {
    tree: async () => (await get<SourcePayload>(`source/${enc(project)}.json`)) ?? { status: 'error', reason: `开发服务器没有项目 ${project} 的源码端点` },
    file: path => get<SourceFile>(`source/${enc(project)}/file.json?path=${enc(path)}`),
    exports: path => get<ExportedSymbol[]>(`source/${enc(project)}/exports.json?path=${enc(path)}`),
    facts: () => get<FactsPayload>(`source/${enc(project)}/facts.json`),
    history: () => get<SourceHistory>(`source/${enc(project)}/history.json`),
    commit: hash => get<{ hash: string; message: string }>(`source/${enc(project)}/commit.json?hash=${enc(hash)}`),
  }
}

/** 描述写入（B1–B5）：POST /write/<项目>/<种类>，开发服务器只追加人拥有的文件 */
export function httpModelWriter(project: string, base = ''): ModelWriter {
  const post = async (kind: string, body: unknown): Promise<WriteOutcome> => {
    try {
      const res = await fetch(`${base}write/${encodeURIComponent(project)}/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const out = (await res.json()) as { file?: string; error?: string }
      return res.ok && out.file ? { ok: true, file: out.file } : { ok: false, error: out.error ?? `HTTP ${res.status}` }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  return { feedback: b => post('feedback', b), allow: b => post('allow', b), ignore: b => post('ignore', b), reviewed: b => post('reviewed', b) }
}
