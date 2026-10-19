/**
 * ModelSource：把模型根目录下各项目的 YAML 交给页面。
 * - 开发态：GET /projects.json（项目摘要列表）、GET /models/<项目>.json（该项目全部 YAML 原文）实时读取；
 *   文件变化时推送 `arch-model:changed`，载荷 { project } 指明哪个项目变了；
 * - 构建态：把上述内容固化为产物中的 projects.json 与 models/<项目>.json。
 * 项目内容只搬运原始文本，解析与校验都在页面侧的模型层完成，保证两种形态报错一致。
 */
import path from 'node:path'
import type { Plugin } from 'vite'
import { isModelFile, listProjectIds, listProjects, readProject } from './readModelDir'

export const MODEL_CHANGED_EVENT = 'arch-model:changed'
export const PROJECTS_FILE = 'projects.json'
export const modelFile = (project: string) => `models/${project}.json`

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
        const m = /^\/models\/([^/]+)\.json$/.exec(url)
        if (!m) return next()
        const payload = readProject(modelRoot, decodeURIComponent(m[1]), root)
        return payload ? json(res, payload) : json(res, { error: `项目不存在：${m[1]}` }, 404)
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: PROJECTS_FILE, source: JSON.stringify(listProjects(modelRoot, root)) })
      for (const id of listProjectIds(modelRoot)) {
        this.emitFile({ type: 'asset', fileName: modelFile(id), source: JSON.stringify(readProject(modelRoot, id, root)) })
      }
    },
  }
}
