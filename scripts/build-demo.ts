/**
 * 静态 demo 预渲染：把开发服务器（ModelSource 插件）实时读出的载荷，在构建期产出为静态 JSON 树，
 * 供 `vite build --mode demo` 的产物在 GitHub Pages 等纯静态托管上运行（ADR-0007 的本地形态不变）。
 * 与插件复用同一批读取函数——同一套解析、校验与报错，不另写实现。
 *
 * 白名单内项目逐个产出：projects.json、models/<项目>.json（含各设计轮次与持久草图版本）、
 * source/<项目>.json（清单）、facts.json、history.json、commit/<哈希>.json（提交说明）、
 * files/<路径>.json 与 exports/<路径>.json（逐文件预览与导出，路径段 URL——静态托管不吃 query 参数）。
 * 白名单外（外部项目）不产出：页面访问得到 404，DeskView 有「不存在」的错误页。
 *
 * 用法：vite-node scripts/build-demo.ts -- --out dist [--project <ID>]…（缺省 h5p-arch-desk）
 * 前提：仓库检出带完整 git 历史（演化事实与版本列表要读 git）；只依赖白名单项目的本地源码，
 * 自项目（G22）源码根即本仓库，所以 CI 上无需 ARCH_WORKSPACE_ROOT。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadModel } from '../src/model'
import { resolveModelRoot, readProject, readDesignRevision, readIntentVersion, summarizeProject } from '../vite/readModelDir'
import { readSourceTree, readSourceFile, readExports } from '../vite/readSource'
import { readCodeDeps } from '../vite/readDeps'
import { readHealth } from '../vite/readHealth'
import { LEDGER_PAGE_LIMIT, governanceDir, readBaseline, readLedger } from '../vite/governanceStore'
import { readFileAtHead, listModelCommits, readModelAt } from '../vite/readGit'
import { historyOptions, readCommitMessage, readSourceHistory } from '../vite/readHistory'

const argv = process.argv.slice(process.argv.indexOf('--') + 1)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', flag('--out') ?? 'dist')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const modelRoot = resolveModelRoot(root)
const projects = argv.flatMap((a, i) => (a === '--project' && argv[i + 1] ? [argv[i + 1]] : []))
if (projects.length === 0) projects.push('h5p-arch-desk')
/** 逐文件端点的提交说明上限（history 窗口内通常远小于此） */
const COMMIT_MESSAGE_LIMIT = 300

const enc = encodeURIComponent
/** 逐文件端点在 demo 下是路径段 URL，路径逐段转义 */
const seg = (rel: string) => rel.split('/').map(encodeURIComponent).join('/')
let bytes = 0
const write = (rel: string, data: unknown) => {
  const full = path.join(outDir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  const text = JSON.stringify(data)
  bytes += Buffer.byteLength(text)
  fs.writeFileSync(full, text)
}

fs.mkdirSync(outDir, { recursive: true })
for (const project of projects) {
  const payload = readProject(modelRoot, project, root)
  if (!payload) throw new Error(`项目不存在：${project}（model/${project} 下没有 system.yaml）`)
  const e = enc(project)
  const commits = listModelCommits(path.join(modelRoot, project))

  // 当前版本、设计轮次、持久草图版本——与插件的 models 路由同参同形（含版本切换用的提交列表）
  write(`models/${e}.json`, { ...payload, commits })
  for (const design of payload.designs ?? [])
    for (const revision of design.revisions ?? []) {
      const p = readDesignRevision(modelRoot, project, design.id, revision.id, root, { committed: readFileAtHead, baseline: readModelAt })
      if (p) write(`models/${e}/designs/${enc(design.id)}/${enc(revision.id)}.json`, { ...p, commits })
    }
  // intent/ 下的每个 yaml 都试一次：持久草图为非 null，roles / strata 等非草图返回 null（与插件路由一致）
  for (const file of payload.files.filter(f => f.path.startsWith('intent/') && f.path.endsWith('.yaml'))) {
    const id = file.path.slice('intent/'.length).replace(/\.yaml$/, '')
    const p = readIntentVersion(modelRoot, project, id, root)
    if (p) write(`models/${e}/intent/${enc(id)}.json`, { ...p, commits })
  }

  // 源码清单、代码事实（基线 + 拦截记录）、git 演化窗口与逐提交说明（demo 的提交说明也是路径段 URL）
  const tree = readSourceTree(modelRoot, project, root)
  if (!tree) throw new Error(`项目不存在：${project}`)
  if (tree.status !== 'local') throw new Error(`项目 ${project} 源码不可用：${tree.reason}`)
  write(`source/${e}.json`, tree)
  const dir = governanceDir(modelRoot, project)
  write(`source/${e}/facts.json`, {
    deps: readCodeDeps(tree.root, tree.files, tree.packages),
    baseline: readBaseline(dir),
    ledger: readLedger(dir, LEDGER_PAGE_LIMIT),
  })
  const system = loadModel(payload.files).index.model.system
  const history = readSourceHistory(tree.root, tree.files, historyOptions(system))
  write(`source/${e}/history.json`, history)
  if (history.status === 'ok')
    for (const c of history.commits.slice(0, COMMIT_MESSAGE_LIMIT)) {
      const message = readCommitMessage(tree.root, c.hash)
      if (message !== null) write(`source/${e}/commit/${c.hash}.json`, { hash: c.hash, message })
    }
  // 逐文件预览与导出；不在清单中的（source-ignore 命中的目录逐个跳过即可）返回 null
  for (const rel of tree.files) {
    try {
      const f = readSourceFile(tree.root, tree.files, rel)
      if (f) write(`source/${e}/files/${seg(rel)}.json`, f)
    } catch {
      /* 单文件失败不阻断整个 demo（与插件的 500 等价，页面按取不到处理） */
    }
    try {
      const x = readExports(tree.root, tree.files, rel)
      if (x) write(`source/${e}/exports/${seg(rel)}.json`, x)
    } catch {
      /* 同上 */
    }
  }

  // projects.json：白名单内逐个汇总（与 listProjects 的映射一致，只是不做白名单外的项目）
  const summary = summarizeProject(payload, readHealth(modelRoot, project, payload.files, root), { modelRoot, projectRoot: root })
  const prev = fs.existsSync(path.join(outDir, 'projects.json')) ? (JSON.parse(fs.readFileSync(path.join(outDir, 'projects.json'), 'utf8')) as unknown[]) : []
  write('projects.json', prev.concat(summary))
  const count = (sub: string): number => {
    const full = path.join(outDir, `source/${e}/${sub}`)
    if (!fs.existsSync(full)) return 0
    return fs.readdirSync(full, { withFileTypes: true }).reduce((n, ent) => n + (ent.isDirectory() ? count(`${sub}/${ent.name}`) : 1), 0)
  }
  console.log(
    `✓ ${project}：模型 ${payload.files.length} 文件、设计 ${(payload.designs ?? []).length} 个、提交说明 ${count('commit')} 条、文件预览 ${count('files')} 个、导出 ${count('exports')} 个`,
  )
}
console.log(`✓ demo 预渲染完成 → ${path.relative(process.cwd(), outDir)}（JSON 共 ${(bytes / 1024 / 1024).toFixed(1)} MB）`)
