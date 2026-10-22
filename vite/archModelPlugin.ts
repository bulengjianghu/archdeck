/**
 * ModelSource：开发服务器把模型根目录下各项目的描述与本地源码交给页面（本地架构工作台只有这一种运行形态，ADR-0007 修订）。
 * - 描述：GET /projects.json（项目摘要列表，附健康度 Q10）、GET /models/<项目>.json（该项目当前版本全部 YAML 原文）、
 *   GET /models/<项目>/designs/<设计>/<轮次>.json（设计版本某一轮，附对比基线，ADR-0002）实时读取；
 *   文件变化时推送 `arch-model:changed`，载荷 { project } 指明哪个项目变了；
 * - 源码（G1、G2、G17、G11，docs/architecture/source.md §2.1）：GET /source/<项目>.json（文件清单）、
 *   /source/<项目>/file.json?path=（单个文件）、/source/<项目>/exports.json?path=（导出）、/source/<项目>/facts.json（代码事实、基线与拦截记录，K8）。
 * 项目内容只搬运原始文本，解析与校验都在页面侧的模型层完成，与命令行同一套报错。
 */
import path from 'node:path'
import type { Plugin } from 'vite'
import { isModelFile, listProjects, readDesignRevision, readProject } from './readModelDir'
import { readExports, readSourceFile, readSourceTree } from './readSource'
import { readCodeDeps } from './readDeps'
import { readHealth } from './readHealth'
import { LEDGER_PAGE_LIMIT, governanceDir, readBaseline, readLedger } from './governanceStore'
import type { FactsPayload, SourcePayload } from '../src/model'

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
      // 源码清单短暂缓存：取文件、取导出时都要先确认路径在清单中，不必每次重新列出
      const trees = new Map<string, { at: number; tree: SourcePayload | null }>()
      const treeOf = (project: string, fresh = false) => {
        const hit = trees.get(project)
        if (!fresh && hit && Date.now() - hit.at < 5000) return hit.tree
        const tree = readSourceTree(modelRoot, project, root)
        trees.set(project, { at: Date.now(), tree })
        return tree
      }
      server.middlewares.use((req, res, next) => {
        const [url, search = ''] = (req.url ?? '').split('?')
        if (url === `/${PROJECTS_FILE}`)
          return json(
            res,
            listProjects(modelRoot, root, p => readHealth(modelRoot, p.project, p.files, root)),
          )
        const src = /^\/source\/([^/]+?)(?:\/(file|exports|facts))?\.json$/.exec(url)
        if (src) {
          const project = decodeURIComponent(src[1])
          const tree = treeOf(project, !src[2])
          if (!tree) return json(res, { error: `项目不存在：${project}` }, 404)
          if (!src[2]) return json(res, tree)
          const file = new URLSearchParams(search).get('path') ?? ''
          if (tree.status !== 'local') return json(res, { error: tree.reason }, 404)
          if (src[2] === 'facts') {
            const dir = governanceDir(modelRoot, project)
            try {
              const facts: FactsPayload = {
                deps: readCodeDeps(tree.root, tree.files, tree.packages),
                baseline: readBaseline(dir),
                ledger: readLedger(dir, LEDGER_PAGE_LIMIT),
              }
              return json(res, facts)
            } catch (e) {
              return json(res, { error: `提取失败：${e instanceof Error ? e.message : String(e)}` }, 500)
            }
          }
          let out: unknown
          try {
            out = src[2] === 'file' ? readSourceFile(tree.root, tree.files, file) : readExports(tree.root, tree.files, file)
          } catch (e) {
            return json(res, { error: `读取失败：${e instanceof Error ? e.message : String(e)}` }, 500)
          }
          return out ? json(res, out) : json(res, { error: `文件不在源码清单中：${file}` }, 404)
        }
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
  }
}
