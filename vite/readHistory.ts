/**
 * 源码历史读取（J1，docs/architecture/evolution.md §2）：读被描述项目源码仓库的 git 历史，交给模型层算热度与时间耦合。
 * 只搬运 git log 的输出：每条提交的哈希、日期、标题、是否缺陷修复、涉及的源码清单内文件及增删行数；不判断归属（在模型层）。
 * 参数经 execFile 传给 git，不经 shell；不在 git 仓库内、没有提交、git 不可用时返回原因，不抛异常。按 HEAD 与窗口缓存。
 */
import { execFileSync } from 'node:child_process'
import { historyOptions, isFixSubject, type HistoryCommit, type HistoryOptions, type SourceHistory } from '../src/model'
import { isRev } from './readGit'

export { historyOptions }

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8')

/** 按 <根目录>|<HEAD>|<天数>|<起点日期>|<缺陷正则> 缓存解析后的全部提交（未按清单过滤，清单每次都可能不同） */
const cache = new Map<string, { head: string; since: string; commits: HistoryCommit[] }>()

/** 窗口起点：now 往前 days 天的日期（ISO，到秒） */
export function sinceOf(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** 一条提交的头：`\x01<hash>\x1f<short>\x1f<date>\x1f<subject>` */
const HEAD = '\x01'
const SEP = '\x1f'

/**
 * 解析 `git log --numstat` 的输出；prefix 为源码根目录在仓库中的相对路径（含末尾 /，仓库根为空串）；
 * 给了 files 时只保留清单内的文件、去掉没有清单内文件的提交（J1）。
 */
export function parseNumstat(out: string, prefix: string, files: ReadonlySet<string> | null, fixPatterns: readonly string[]): HistoryCommit[] {
  const commits: HistoryCommit[] = []
  let cur: HistoryCommit | null = null
  for (const line of out.split('\n')) {
    if (line.startsWith(HEAD)) {
      const [hash, short, date, subject = ''] = line.slice(1).split(SEP)
      cur = { hash, short, date, subject, fix: isFixSubject(subject, fixPatterns), files: [] }
      commits.push(cur)
      continue
    }
    if (!cur || !line) continue
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (!m) continue
    let p = m[3]
    if (prefix) {
      if (!p.startsWith(prefix)) continue
      p = p.slice(prefix.length)
    }
    if (files && !files.has(p)) continue
    cur.files.push({ path: p, added: m[1] === '-' ? 0 : Number(m[1]), deleted: m[2] === '-' ? 0 : Number(m[2]) })
  }
  // J1：只记触及源码清单内文件的提交
  return files ? onlyListed(commits, files) : commits
}

/** J1：只保留清单内的文件，去掉没有清单内文件的提交 */
export function onlyListed(commits: readonly HistoryCommit[], files: ReadonlySet<string>): HistoryCommit[] {
  return commits.map(c => ({ ...c, files: c.files.filter(f => files.has(f.path)) })).filter(c => c.files.length > 0)
}

/**
 * J1：窗口内的提交（新的在前），不计合并提交本身，只取源码清单内的文件；按 HEAD 与窗口缓存。
 * now 只供测试指定窗口起点。
 */
export function readSourceHistory(root: string, files: readonly string[], opts: HistoryOptions, now?: Date): SourceHistory {
  let head: string
  let prefix: string
  try {
    head = git(root, ['rev-parse', 'HEAD']).trim()
    prefix = git(root, ['rev-parse', '--show-prefix']).trim()
  } catch {
    return { status: 'error', reason: `源码根目录不是 git 仓库或没有提交（git rev-parse HEAD 失败）：${root}` }
  }
  const since = sinceOf(opts.days, now)
  const key = `${root}|${head}|${opts.days}|${since.slice(0, 10)}|${opts.fixPatterns.join('|')}`
  const hit = cache.get(key)
  if (hit) return { status: 'ok', head, days: opts.days, since: hit.since, commits: onlyListed(hit.commits, new Set(files)) }
  let out: string
  try {
    out = git(root, [
      'log',
      '--no-merges',
      '--numstat',
      '--no-renames',
      `--since=${since}`,
      '--date=short',
      `--format=${HEAD}%H${SEP}%h${SEP}%ad${SEP}%s`,
      '--',
      '.',
    ])
  } catch (e) {
    return { status: 'error', reason: `读取 git 历史失败：${e instanceof Error ? e.message : String(e)}` }
  }
  const all = parseNumstat(out, prefix, null, opts.fixPatterns)
  cache.set(key, { head, since, commits: all })
  return { status: 'ok', head, days: opts.days, since, commits: onlyListed(all, new Set(files)) }
}

/** 一个提交的完整说明（面板展开时按需取）；提交号只收十六进制，不存在为 null */
export function readCommitMessage(root: string, hash: string): string | null {
  if (!isRev(hash)) return null
  try {
    return git(root, ['show', '-s', '--format=%B', hash]).trimEnd()
  } catch {
    return null
  }
}
