/**
 * ModelSource：开发服务器把模型根目录下各项目的描述与本地源码交给页面（本地架构工作台只有这一种运行形态，ADR-0007 修订）。
 * - 描述：GET /projects.json（项目摘要列表，附健康度 Q10）、GET /models/<项目>.json（该项目当前版本全部 YAML 原文）、
 *   GET /models/<项目>/designs/<设计>/<轮次>.json（设计版本某一轮，附对比基线，ADR-0002）、
 *   GET /models/<项目>/commits/<提交>.json?base=<提交|worktree>（描述在某个 git 提交时的快照，附对比基线，E5、E6）实时读取；
 *   各版本附上改动过描述的最近提交（版本切换用）；
 *   文件变化时推送 `arch-model:changed`，载荷 { project } 指明哪个项目变了；
 * - 源码（G1、G2、G17、G11，docs/architecture/source.md §2.1）：GET /source/<项目>.json（文件清单）、
 *   /source/<项目>/file.json?path=（单个文件）、/source/<项目>/exports.json?path=（导出）、/source/<项目>/facts.json（代码事实、基线与拦截记录，K8）、
 *   /source/<项目>/history.json（git 历史，J1）、/source/<项目>/commit.json?hash=（一个提交的说明）。
 * 写入（B1–B6，ADR-0019、ADR-0023；Z1、Z6）：POST /write/<项目>/feedback | allow | ignore | reviewed | accept | archive | role，只追加人拥有的文件（评审意见、例外、忽略项、
 *   确认记录——一条或多条 { module, at, hash, summary, source, note? }，同一模块更新那一条——、认可偏差）；archive 为归档 / 晋升（X3）；
 *   草图整份写回 POST /write/<项目>/sketch（持久草图）、/write/<项目>/designs/<设计>/sketch（设计的一张草图），
 *   按设计写回 POST /write/<项目>/designs/<设计>/sketches（多张、改名、删除，B6、B7、X20），设计状态 POST /write/<项目>/designs/<设计>/status（认可 / 回到起草 / 放弃，DL-33），新建设计 POST /write/<项目>/designs（B6，ADR-0024、ADR-0025）；
 *   持久草图版本 GET /models/<项目>/intent/<草图 ID>.json；写后照常推送变化。
 * 对话（DA-11，ADR-0063）：POST /agent/<项目>/turn 起一轮（子进程见 agentProcess.ts、一轮的接入见 agentTurn.ts）、POST /agent/<项目>/stop 停止、
 *   POST /agent/<项目>/outcome 补记提议卡结果（DL-51）；
 *   输出推送 `arch-agent:event`，载荷 { project, turn, type, … }。
 * 项目内容只搬运原始文本，解析与校验都在页面侧的模型层完成，与命令行同一套报错。
 */
import path from 'node:path'
import type { Plugin } from 'vite'
import { isModelFile, listProjects, readDesignRevision, readIntentVersion, readProject, type ModelPayload } from './readModelDir'
import { readExports, readSourceFile, readSourceTree } from './readSource'
import { readCodeDeps } from './readDeps'
import { readGateErrors, readHealth } from './readHealth'
import { WriteError, appendAccepted, appendAllow, appendFeedback, appendIgnore, appendReviewed, appendRole, archiveDesign, archivePreview } from './writeModel'
import { saveNote } from './designNotes'
import { setDesignStatus, type DesignStatusRequest } from './designStatus'
import {
  DesignLocked,
  SketchInvalid,
  WriteConflict,
  createDesign,
  saveDesignSketches,
  saveSketch,
  type SaveDesignRequest,
  type SaveSketchRequest,
} from './writeSketch'
import { headModel, listModelCommits, readCommitVersion, readFileAtHead, readModelAt } from './readGit'
import { historyOptions, readCommitMessage, readSourceHistory } from './readHistory'
import { loadModel } from '../src/model'
import { LEDGER_PAGE_LIMIT, governanceDir, readBaseline, readLedger } from './governanceStore'
import type { CodeFactsSummary, FactsPayload, ModelIndex, ModuleRole, RuleKind, SourcePayload } from '../src/model'
import { agentConfigFromEnv, createAgentRunner } from './agentProcess'
import { AGENT_EVENT, recordOutcome, startTurn } from './agentTurn'

export const MODEL_CHANGED_EVENT = 'arch-model:changed'
export const PROJECTS_FILE = 'projects.json'

export interface ModelChangedPayload {
  project: string
}

/** Z6：确认记录的正文——一条、数组，或 { entries: [...] } */
function reviewedBatch(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  const entries = (parsed as { entries?: unknown } | null)?.entries
  return Array.isArray(entries) ? entries : [parsed]
}

export function archModelPlugin(options: { modelRoot: string; root: string }): Plugin {
  const { modelRoot, root } = options
  /** 变化的文件属于哪个项目；不在模型根目录下返回 null */
  const projectOf = (file: string): string | null => {
    const rel = path.relative(modelRoot, file)
    if (rel.startsWith('..') || path.isAbsolute(rel) || !(isModelFile(file) || /[\\/]explainers[\\/][^\\/]+\.html$/i.test(file))) return null
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
      // DA-11：对话的子进程（命令、超时由环境变量配，缺省 claude 命令行）；输出经推送通道流到页面
      const runner = createAgentRunner(agentConfigFromEnv(process.env, root), (project, e) =>
        server.ws.send({ type: 'custom', event: AGENT_EVENT, data: { project, ...e } }),
      )
      server.httpServer?.on('close', () => runner.stopAll())
      // 代码事实摘要（上下文包，DL-14）：架构治理的查询核心按需加载、按项目缓存
      let service: Promise<import('../scripts/agent/service').ArchService> | null = null
      const facts = async (project: string, module: string): Promise<CodeFactsSummary | null> => {
        service ??= import('../scripts/agent/service').then(m => m.createService({ root, client: 'mcp' }))
        const svc = await service
        const imp = svc.impact(module, project)
        const row = imp.metrics as { ca?: number; ce?: number; instability?: number }
        return { ca: row.ca, ce: row.ce, instability: row.instability, impactIn: imp.incoming?.modules, cycles: imp.inCycle ? 1 : 0 }
      }
      server.middlewares.use((req, res, next) => {
        const [url] = (req.url ?? '').split('?')
        const a = /^\/agent\/([^/]+)\/(turn|stop|outcome)$/.exec(url)
        if (!a) return next()
        if (req.method !== 'POST') return json(res, { error: '只接受 POST' }, 405)
        const origin = req.headers.origin
        if (origin && new URL(origin).host !== req.headers.host) return json(res, { error: '只接受同源请求' }, 403)
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, { error: '只接受 JSON' }, 415)
        let raw = ''
        req.on('data', (c: Buffer) => {
          raw += c.toString('utf8')
          // 贴图走 data URL：4 张 × 5 MB 的 base64 再留余量
          if (raw.length > 28 * 1024 * 1024) req.destroy()
        })
        req.on('end', () => {
          const project = decodeURIComponent(a[1])
          let body: unknown
          try {
            body = JSON.parse(raw || '{}')
          } catch {
            return json(res, { error: '正文不是 JSON' }, 400)
          }
          if (a[2] === 'stop') return json(res, { stopped: runner.stop(project, (body as { turn?: string }).turn) })
          if (a[2] === 'outcome') {
            const r = recordOutcome(modelRoot, project, body)
            return r.ok ? json(res, r) : json(res, { error: r.error }, r.status)
          }
          startTurn({ modelRoot, root, runner, facts }, project, body).then(
            r => (r.ok ? json(res, r) : json(res, { error: r.error }, r.status)),
            e => json(res, { error: e instanceof Error ? e.message : String(e) }, 500),
          )
        })
      })
      // B1–B6：人拥有的文件的追加写入与草图整份写回，只收同源的 JSON POST
      server.middlewares.use((req, res, next) => {
        const [url] = (req.url ?? '').split('?')
        const many = /^\/write\/([^/]+)\/designs\/([^/]+)\/(sketches|notes|status)$/.exec(url)
        const w =
          /^\/write\/([^/]+)\/(feedback|allow|ignore|reviewed|accept|archive|sketch|designs|role)$/.exec(url) ??
          (/^\/write\/([^/]+)\/designs\/[^/]+\/sketch$/.test(url) ? [url, /^\/write\/([^/]+)\//.exec(url)![1], 'sketch'] : null) ??
          (many ? [url, many[1], many[3]] : null)
        if (!w) return next()
        if (req.method !== 'POST') return json(res, { error: '只接受 POST' }, 405)
        const origin = req.headers.origin
        if (origin && new URL(origin).host !== req.headers.host) return json(res, { error: '只接受同源请求' }, 403)
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, { error: '只接受 JSON' }, 415)
        let raw = ''
        req.on('data', (c: Buffer) => {
          raw += c.toString('utf8')
          // B5：正文上限 64 KB；草图整份写回放宽到 256 KB（骨架级草图约 20 KB）
          if (raw.length > (w[2] === 'sketch' || w[2] === 'sketches' || w[2] === 'designs' || w[2] === 'notes' ? 256 : 64) * 1024) req.destroy()
        })
        req.on('end', () => {
          try {
            const parsed = JSON.parse(raw || '{}') as unknown
            const body = (parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}) as Record<string, string>
            const project = decodeURIComponent(w[1])
            // DL-47 第二关：当前版本的门禁错误（U8），按源码现算
            const ratchet = (index: ModelIndex) => readGateErrors(modelRoot, project, index, root)
            const out =
              w[2] === 'feedback'
                ? appendFeedback(modelRoot, project, body.design, body.revision, body.text, root)
                : w[2] === 'allow'
                  ? appendAllow(
                      modelRoot,
                      project,
                      { from: body.from, to: body.to, rule: (body.rule || undefined) as RuleKind | undefined, reason: body.reason },
                      root,
                    )
                  : w[2] === 'ignore'
                    ? appendIgnore(modelRoot, project, body.pattern, root)
                    : w[2] === 'reviewed'
                      ? appendReviewed(modelRoot, project, reviewedBatch(parsed), root, { origin: 'page' })
                      : w[2] === 'accept'
                        ? appendAccepted(modelRoot, project, body.design, body.deviation, body.reason, root)
                        : w[2] === 'role'
                          ? appendRole(modelRoot, project, { module: body.module, role: body.role as ModuleRole }, root)
                          : w[2] === 'sketch'
                            ? saveSketch(modelRoot, project, parsed as SaveSketchRequest, root)
                            : w[2] === 'status'
                              ? setDesignStatus(modelRoot, project, decodeURIComponent(many![2]), parsed as DesignStatusRequest, root)
                              : w[2] === 'notes'
                                ? saveNote(modelRoot, project, decodeURIComponent(many![2]), parsed as Record<string, unknown>)
                                : w[2] === 'sketches'
                                  ? saveDesignSketches(modelRoot, project, decodeURIComponent(many![2]), parsed as SaveDesignRequest, root)
                                  : w[2] === 'designs'
                                    ? createDesign(modelRoot, project, parsed as Parameters<typeof createDesign>[2], root, { base: headModel })
                                    : (parsed as { preview?: unknown }).preview === true
                                      ? { preview: archivePreview(modelRoot, project, body.design, root, { ratchet }) }
                                      : archiveDesign(modelRoot, project, body.design, root, { ratchet })
            json(res, out)
          } catch (e) {
            const status =
              e instanceof WriteConflict || e instanceof DesignLocked ? 409 : e instanceof SketchInvalid ? 422 : e instanceof WriteError ? 400 : 500
            json(res, { error: e instanceof Error ? e.message : String(e), ...(e instanceof SketchInvalid ? { issues: e.validation.issues } : {}) }, status)
          }
        })
      })
      server.middlewares.use((req, res, next) => {
        const [url, search = ''] = (req.url ?? '').split('?')
        if (url === `/${PROJECTS_FILE}`)
          return json(
            res,
            listProjects(modelRoot, root, p => readHealth(modelRoot, p.project, p.files, root)),
          )
        const src = /^\/source\/([^/]+?)(?:\/(file|exports|facts|history|commit))?\.json$/.exec(url)
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
          // J1：git 历史，窗口与缺陷匹配取自描述的 system.source.history
          if (src[2] === 'history') {
            const payload = readProject(modelRoot, project, root)
            const system = payload ? loadModel(payload.files).index.model.system : undefined
            return json(res, readSourceHistory(tree.root, tree.files, historyOptions(system)))
          }
          if (src[2] === 'commit') {
            const hash = new URLSearchParams(search).get('hash') ?? ''
            const message = readCommitMessage(tree.root, hash)
            return message === null ? json(res, { error: `提交不存在：${hash}` }, 404) : json(res, { hash, message })
          }
          let out: unknown
          try {
            out = src[2] === 'file' ? readSourceFile(tree.root, tree.files, file) : readExports(tree.root, tree.files, file)
          } catch (e) {
            return json(res, { error: `读取失败：${e instanceof Error ? e.message : String(e)}` }, 500)
          }
          return out ? json(res, out) : json(res, { error: `文件不在源码清单中：${file}` }, 404)
        }
        // E5：版本切换要列出改动过描述的提交，各版本都附上
        const withCommits = (project: string, payload: ModelPayload) => ({
          ...payload,
          commits: payload.commits ?? listModelCommits(path.join(modelRoot, project)),
        })
        const c = /^\/models\/([^/]+)\/commits\/([^/]+)\.json$/.exec(url)
        if (c) {
          const [project, rev] = c.slice(1).map(decodeURIComponent)
          const base = new URLSearchParams(search).get('base') ?? undefined
          const payload = readCommitVersion(modelRoot, project, rev, base, root)
          return payload ? json(res, payload) : json(res, { error: `提交不存在或当时没有该项目的描述：${project} @ ${rev}` }, 404)
        }
        const d = /^\/models\/([^/]+)\/designs\/([^/]+)\/([^/]+)\.json$/.exec(url)
        if (d) {
          const [project, design, revision] = d.slice(1).map(decodeURIComponent)
          const payload = readDesignRevision(modelRoot, project, design, revision, root, { committed: readFileAtHead, baseline: readModelAt })
          return payload ? json(res, withCommits(project, payload)) : json(res, { error: `设计版本不存在：${project} / ${design} / ${revision}` }, 404)
        }
        const i = /^\/models\/([^/]+)\/intent\/([^/]+)\.json$/.exec(url)
        if (i) {
          const [project, sketch] = i.slice(1).map(decodeURIComponent)
          const payload = readIntentVersion(modelRoot, project, sketch, root)
          return payload ? json(res, withCommits(project, payload)) : json(res, { error: `持久草图不存在：${project} / ${sketch}` }, 404)
        }
        const m = /^\/models\/([^/]+)\.json$/.exec(url)
        if (!m) return next()
        const project = decodeURIComponent(m[1])
        const payload = readProject(modelRoot, project, root)
        return payload ? json(res, withCommits(project, payload)) : json(res, { error: `项目不存在：${m[1]}` }, 404)
      })
    },
  }
}
