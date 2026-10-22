/**
 * git 读取（E5、E6，docs/architecture/loading-and-versions.md §2.2）：列出改动过项目描述的提交，读描述在某个提交时的快照。
 * 只搬运文本（git log / ls-tree / show），对比在页面侧的模型层完成，与设计版本同一套差异计算。
 * 提交号只接受十六进制，参数经 execFile 传给 git，不经 shell。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { WORKTREE, type ModelCommit, type RawFile } from '../src/model'
import { DESIGNS_DIR, GOVERNANCE_DIR, isModelFile, readProject, type ModelPayload } from './readModelDir'

/** E5：版本切换列出的提交数上限 */
export const COMMIT_LIMIT = 50

export const isRev = (rev: string) => /^[0-9a-f]{4,40}$/i.test(rev)

const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8')

/** 项目描述目录所在的 git 仓库根目录与目录在仓库中的相对路径；不在 git 仓库内为 null */
function locate(projectDir: string): { top: string; rel: string } | null {
  try {
    const top = git(projectDir, ['rev-parse', '--show-toplevel']).trim()
    return { top, rel: path.relative(fs.realpathSync(top), fs.realpathSync(projectDir)).split(path.sep).join('/') }
  } catch {
    return null
  }
}

/** E5：改动过该项目描述（不含 designs/、governance/ 的变化也列出，按 git log 的路径过滤）的最近提交，新的在前 */
export function listModelCommits(projectDir: string, limit = COMMIT_LIMIT): ModelCommit[] {
  const at = locate(projectDir)
  if (!at) return []
  try {
    const out = git(at.top, ['log', `-n${limit}`, '--format=%H%x1f%h%x1f%ad%x1f%s', '--date=short', '--', at.rel])
    return out
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [hash, short, date, subject] = line.split('\x1f')
        return { hash, short, date, subject }
      })
  } catch {
    return []
  }
}

/** L-2：项目描述目录下一个文件在 HEAD 时的内容（草图的「上一次提交」）；没有提交过、不在 git 仓库内为 null */
export function readFileAtHead(projectDir: string, rel: string): string | null {
  const at = locate(projectDir)
  if (!at || rel.split('/').includes('..')) return null
  try {
    return git(at.top, ['show', `HEAD:${at.rel ? `${at.rel}/` : ''}${rel}`])
  } catch {
    return null
  }
}

/** E5：项目描述在某个提交时的全部描述文件（跳过 designs/ 与 governance/，同当前版本）；提交不存在或目录当时不存在为 null */
export function readModelAt(projectDir: string, rev: string): RawFile[] | null {
  const at = locate(projectDir)
  if (!at || !isRev(rev)) return null
  try {
    const prefix = at.rel ? `${at.rel}/` : ''
    const names = git(at.top, ['ls-tree', '-r', '--name-only', rev, '--', prefix || '.'])
      .split('\n')
      .filter(Boolean)
      .map(n => n.slice(prefix.length))
      .filter(n => isModelFile(n) && !n.startsWith(`${DESIGNS_DIR}/`) && !n.startsWith(`${GOVERNANCE_DIR}/`))
    if (!names.includes('system.yaml')) return null
    return names.map(n => ({ path: n, text: git(at.top, ['show', `${rev}:${prefix}${n}`]) })).sort((a, b) => a.path.localeCompare(b.path))
  } catch {
    return null
  }
}

/**
 * E5、E6：提交版本的描述，附对比基线（作为 compare.current）：base 为另一个提交、`worktree`（当前版本），
 * 缺省为历史中更早的一个改动过描述的提交，没有时为当前版本。提交不存在返回 null。
 */
export function readCommitVersion(modelRoot: string, project: string, rev: string, base: string | undefined, projectRoot: string): ModelPayload | null {
  const current = readProject(modelRoot, project, projectRoot)
  if (!current || !isRev(rev)) return null
  const dir = path.join(modelRoot, project)
  const files = readModelAt(dir, rev)
  if (!files) return null
  const commits = listModelCommits(dir)
  const self = commits.findIndex(c => c.hash.startsWith(rev.toLowerCase()))
  const fallback = self >= 0 ? commits[self + 1]?.hash : undefined
  const baseRev = base ?? fallback ?? WORKTREE
  const short = (r: string) => commits.find(c => c.hash.startsWith(r.toLowerCase()))?.short ?? r.slice(0, 8)
  let compare: ModelPayload['compare']
  if (baseRev === WORKTREE) compare = { current: { label: '当前版本', dir: current.dir, files: current.files } }
  else {
    const baseFiles = isRev(baseRev) ? readModelAt(dir, baseRev) : null
    compare = baseFiles ? { current: { label: `提交 ${short(baseRev)}`, dir: `${current.dir}@${short(baseRev)}`, files: baseFiles } } : undefined
  }
  return {
    project,
    dir: `${current.dir}@${short(rev)}`,
    files,
    designs: current.designs,
    commits,
    version: { commit: rev, base: baseRev },
    ...(compare ? { compare } : {}),
  }
}
