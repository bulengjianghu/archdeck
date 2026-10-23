/**
 * 按 HTTP 端点取被描述项目的源码（开发态由 ModelSource 插件提供，docs/architecture/source.md §2.1），注入给 DeskState 的源码同步。
 * 与 fetchModel 一样由项目视图创建：外界的地址只在呈现层出现。取不到清单时为 error（附原因）。
 */
import type { ExportedSymbol, FactsPayload, SourceFile, SourceHistory, SourcePayload } from '@/model'
import type { DesignSaveOutcome, ModelWriter, SketchSaveOutcome, SourceFetcher, WriteOutcome } from '@/state/useDeskState'

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
      const out = (await res.json()) as { file?: string; error?: string; outcome?: string; reviewed?: { count: number; file: string }; promoted?: string }
      if (!res.ok || !out.file) return { ok: false, error: out.error ?? `HTTP ${res.status}` }
      // X3：归档 / 晋升的结果说明
      const note =
        out.outcome === 'promote'
          ? `已晋升：草图替换了 ${out.promoted}`
          : out.outcome === 'archive'
            ? `已归档：${out.reviewed?.count ?? 0} 条确认记录写入 ${out.reviewed?.file ?? 'reviewed.yaml'}`
            : undefined
      return { ok: true, file: out.file, ...(note ? { note } : {}) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  /** B6：草图整份写回——409 为文件已在外部改动（X7i），422 带服务端校验的问题（X7f） */
  const saveSketch: ModelWriter['saveSketch'] = async body => {
    const kind = body.target.kind === 'design' ? `designs/${encodeURIComponent(body.target.design)}/sketch` : 'sketch'
    try {
      const res = await fetch(`${base}write/${encodeURIComponent(project)}/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const out = (await res.json()) as {
        file?: string
        hash?: string
        error?: string
        issues?: NonNullable<Extract<SketchSaveOutcome, { ok: false }>['issues']>
      }
      if (res.ok && out.file && out.hash) return { ok: true, file: out.file, hash: out.hash }
      return {
        ok: false,
        error: out.error ?? `HTTP ${res.status}`,
        ...(res.status === 409 ? { conflict: true as const } : {}),
        ...(out.issues ? { issues: out.issues } : {}),
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  /** X20：按设计写回——POST /write/<项目>/designs/<设计>/sketches；409 为某个文件已在外部改动，422 带服务端校验的问题 */
  const saveDesignSketches: ModelWriter['saveDesignSketches'] = async ({ design, ...body }) => {
    try {
      const res = await fetch(`${base}write/${encodeURIComponent(project)}/designs/${encodeURIComponent(design)}/sketches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const out = (await res.json()) as Partial<Extract<DesignSaveOutcome, { ok: true }>> & {
        error?: string
        issues?: NonNullable<Extract<DesignSaveOutcome, { ok: false }>['issues']>
      }
      if (res.ok && out.files) return { ok: true, files: out.files, removed: out.removed ?? [], dropped: out.dropped ?? [] }
      return {
        ok: false,
        error: out.error ?? `HTTP ${res.status}`,
        ...(res.status === 409 ? { conflict: true as const } : {}),
        ...(out.issues ? { issues: out.issues } : {}),
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  return {
    saveSketch,
    saveDesignSketches,
    createDesign: b => post('designs', b),
    feedback: b => post('feedback', b),
    allow: b => post('allow', b),
    ignore: b => post('ignore', b),
    reviewed: b => post('reviewed', b),
    accept: b => post('accept', b),
    archive: b => post('archive', b),
  }
}
