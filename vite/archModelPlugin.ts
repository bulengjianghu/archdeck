/**
 * ModelSource：把模型根目录下各项目的 YAML 交给页面。
 * - 开发态：GET /projects.json（项目摘要列表）、GET /models/<项目>.json（该项目当前版本全部 YAML 原文）、
 *   GET /models/<项目>/designs/<设计>/<轮次>.json（设计版本某一轮，附对比基线，ADR-0002）实时读取；
 *   文件变化时推送 `arch-model:changed`，载荷 { project } 指明哪个项目变了；
 * - 构建态：把上述内容固化为产物中的同名静态文件。
 * 项目内容只搬运原始文本，解析与校验都在页面侧的模型层完成，保证两种形态报错一致。
 */
import path from 'node:path'
import type { Plugin } from 'vite'
import { isModelFile, listProjectIds, listProjects, readDesignRevision, readProject, versionFile } from './readModelDir'

export const MODEL_CHANGED_EVENT = 'arch-model:changed'
export const PROJECTS_FILE = 'projects.json'

export interface ModelChangedPayload {
  project: string
}

export function archModelPlugin(options: { modelRoot: string; root: string }): Plugin {
  const { modelRoot, root } = options
  /** 变化的文件属于哪个项目；不在模型根目录下返回 null */
  const projectOf = (file: string): string | null => {
    const rel = path.relative(modelRoot, file)
    if (rel.startsWith('..') || path.isAbsolute(rel) || !isModelFile(file)) return null
    return rel.split(path.sep)[0] || null
  }
  const json = (res: import('node:http').ServerResponse, body: unknown, status = 200) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(body))
  }
  return {
    name: 'h5p-arch-desk:model-source',
    configureServer(server) {
      server.watcher.add(modelRoot)
      // AI 重新生成时会连续写多个文件，按项目合并成一次通知
      const timers = new Map<string, ReturnType<typeof setTimeout>>()
      server.watcher.on('all', (_event, file) => {
        const project = projectOf(file)
        if (!project) return
        clearTimeout(timers.get(project))
        timers.set(
          project,
          setTimeout(() => server.ws.send({ type: 'custom', event: MODEL_CHANGED_EVENT, data: { project } satisfies ModelChangedPayload }), 150),
        )
      })
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (url === `/${PROJECTS_FILE}`) return json(res, listProjects(modelRoot, root))
        const d = /^\/models\/([^/]+)\/designs\/([^/]+)\/([^/]+)\.json$/.exec(url)
        if (d) {
          const [project, design, revision] = d.slice(1).map(decodeURIComponent)
          const payload = readDesignRevision(modelRoot, project, design, revision, root)
          return payload ? json(res, payload) : json(res, { error: `设计版本不存在：${project} / ${design} / ${revision}` }, 404)
        }
        const m = /^\/models\/([^/]+)\.json$/.exec(url)
        if (!m) return next()
        const payload = readProject(modelRoot, decodeURIComponent(m[1]), root)
        return payload ? json(res, payload) : json(res, { error: `项目不存在：${m[1]}` }, 404)
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: PROJECTS_FILE, source: JSON.stringify(listProjects(modelRoot, root)) })
      for (const id of listProjectIds(modelRoot)) {
        const current = readProject(modelRoot, id, root)!
        this.emitFile({ type: 'asset', fileName: versionFile(id), source: JSON.stringify(current) })
        for (const d of current.designs ?? []) {
          for (const r of d.revisions) {
            const v = { design: d.id, revision: r.id }
            this.emitFile({ type: 'asset', fileName: versionFile(id, v), source: JSON.stringify(readDesignRevision(modelRoot, id, d.id, r.id, root)) })
          }
        }
      }
    },
  }
}
