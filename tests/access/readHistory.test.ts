/**
 * 源码历史读取（J1）：在临时 git 仓库里造 5 次提交与 1 次合并，验证文件、增删行、缺陷标记、窗口、合并提交不计、只取清单内文件、缓存与出错原因。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseNumstat, readCommitMessage, readSourceHistory, sinceOf } from '../../vite/readHistory'
import { historyOptions, isFixSubject } from '../../src/model'

let repo: string
const hashes: Record<string, string> = {}
const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim()
function write(rel: string, text: string) {
  const full = path.join(repo, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, text)
}
function commit(key: string, msg: string, date?: string) {
  git('add', '-A')
  const env = date ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : process.env
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', msg], { cwd: repo, env, stdio: ['ignore', 'pipe', 'ignore'] })
  hashes[key] = git('rev-parse', 'HEAD')
}
const OPTS = historyOptions(undefined)
const FILES = ['src/a/a.ts', 'src/b/b.ts', 'src/c/c.ts']

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-hist-'))
  git('init', '-q', '-b', 'main')
  write('src/a/a.ts', 'a\n')
  commit('old', 'feat: 很久以前', '2020-01-01T00:00:00Z')
  write('src/a/a.ts', 'a\nb\n')
  write('src/b/b.ts', 'b\n')
  commit('c1', 'feat: init')
  write('src/a/a.ts', 'a\nb\nc\n')
  commit('c2', 'fix: a bug')
  write('src/a/a.ts', 'x\n')
  write('src/b/b.ts', 'b\nb2\n')
  commit('c3', '修复 共同问题')
  write('src/b/b.ts', 'b\nb2\nb3\n')
  write('docs/readme.md', 'doc\n')
  commit('c4', 'chore: docs and b')
  // 分支上的提交被合并：被合并的提交计、合并提交本身不计
  git('checkout', '-q', '-b', 'side')
  write('src/c/c.ts', 'c\n')
  commit('c5', 'Hotfix(c): 新文件')
  git('checkout', '-q', 'main')
  git('merge', '-q', '--no-ff', '-m', 'Merge side', 'side')
  hashes.merge = git('rev-parse', 'HEAD')
})
afterAll(() => fs.rmSync(repo, { recursive: true, force: true }))

describe('J1 源码历史读取', () => {
  it('缺陷修复按标题判定：前缀 fix / hotfix / bugfix（不分大小写）或含「修复」，项目可补充正则', () => {
    expect(isFixSubject('fix: a')).toBe(true)
    expect(isFixSubject('Hotfix(c): x')).toBe(true)
    expect(isFixSubject('bugfix x')).toBe(true)
    expect(isFixSubject('fixture: x')).toBe(false)
    expect(isFixSubject('chore: 修复链接')).toBe(true)
    expect(isFixSubject('bug: x')).toBe(false)
    expect(isFixSubject('bug: x', ['^bug[:(]'])).toBe(true)
    expect(isFixSubject('bug: x', ['('])).toBe(false)
  })

  it('选项：窗口缺省 180 天，耦合阈值缺省 5 / 30%，描述可改', () => {
    expect(OPTS).toEqual({ days: 180, fixPatterns: [], coupling: { min: 5, ratio: 0.3 } })
    expect(historyOptions({ source: { history: { days: 30, fixPatterns: ['x'], coupling: { min: 3 } } } })).toEqual({
      days: 30,
      fixPatterns: ['x'],
      coupling: { min: 3, ratio: 0.3 },
    })
    expect(historyOptions({ source: { history: { days: -1, coupling: { ratio: 2 } } } }).days).toBe(180)
  })

  it('窗口内的提交新的在前：文件、增删行、缺陷标记正确；只取清单内文件；不计合并提交本身，计被合并的提交；窗口外的不计', () => {
    const h = readSourceHistory(repo, FILES, OPTS)
    expect(h.status).toBe('ok')
    if (h.status !== 'ok') return
    expect(h.head).toBe(hashes.merge)
    expect(h.days).toBe(180)
    expect(h.commits.map(c => c.subject)).toEqual(['Hotfix(c): 新文件', 'chore: docs and b', '修复 共同问题', 'fix: a bug', 'feat: init'])
    expect(h.commits.map(c => c.fix)).toEqual([true, false, true, true, false])
    expect(h.commits[2]).toMatchObject({ hash: hashes.c3, short: expect.any(String), date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    expect(h.commits[2].files).toEqual([
      { path: 'src/a/a.ts', added: 1, deleted: 3 },
      { path: 'src/b/b.ts', added: 1, deleted: 0 },
    ])
    // docs/readme.md 不在清单中
    expect(h.commits[1].files).toEqual([{ path: 'src/b/b.ts', added: 1, deleted: 0 }])
    expect(h.commits.some(c => c.hash === hashes.merge)).toBe(false)
    expect(h.commits.some(c => c.hash === hashes.old)).toBe(false)
  })

  it('没有清单内文件的提交不记；只有 docs 的清单得到空历史；缓存按 HEAD 与窗口', () => {
    const h = readSourceHistory(repo, ['docs/readme.md'], OPTS)
    expect(h.status === 'ok' && h.commits.map(c => c.subject)).toEqual(['chore: docs and b'])
    const a = readSourceHistory(repo, FILES, OPTS)
    const b = readSourceHistory(repo, FILES, OPTS)
    expect(a).toEqual(b)
    const c = readSourceHistory(repo, FILES, { ...OPTS, days: 90 })
    expect(c.status === 'ok' && c.days).toBe(90)
    expect(c.status === 'ok' && c.commits).toEqual(a.status === 'ok' && a.commits)
  })

  it('窗口起点可指定；很久以前的提交在足够大的窗口里出现', () => {
    const h = readSourceHistory(repo, FILES, { ...OPTS, days: 20_000 })
    expect(h.status === 'ok' && h.commits.at(-1)!.subject).toBe('feat: 很久以前')
    expect(sinceOf(1, new Date('2026-10-22T00:00:00Z'))).toBe('2026-10-21T00:00:00Z')
  })

  it('不在 git 仓库内时给出原因，不报错', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-nogit-'))
    try {
      const h = readSourceHistory(dir, FILES, OPTS)
      expect(h.status).toBe('error')
      expect(h.status === 'error' && h.reason).toMatch(/git/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('源码根目录是仓库的子目录时路径换算为相对根目录（--show-prefix）', () => {
    const sub = path.join(repo, 'src')
    const h = readSourceHistory(sub, ['a/a.ts', 'b/b.ts'], OPTS)
    expect(h.status === 'ok' && h.commits.map(c => c.subject)).toEqual(['chore: docs and b', '修复 共同问题', 'fix: a bug', 'feat: init'])
    expect(h.status === 'ok' && h.commits[1].files.map(f => f.path)).toEqual(['a/a.ts', 'b/b.ts'])
  })

  it('解析 numstat：二进制文件的增删为 0；非法行跳过', () => {
    const out = ['\x01h1\x1fh\x1f2026-01-01\x1ffix: x', '', '-\t-\timg.png', '3\t1\ta.ts', 'garbage', '\x01h2\x1fh\x1f2026-01-02\x1fy', '', '1\t1\tnot-listed.ts'].join('\n')
    const list = parseNumstat(out, '', new Set(['img.png', 'a.ts']), [])
    expect(list).toHaveLength(1)
    expect(list[0].files).toEqual([
      { path: 'img.png', added: 0, deleted: 0 },
      { path: 'a.ts', added: 3, deleted: 1 },
    ])
  })

  it('提交说明按需取：提交号只收十六进制，不存在为 null', () => {
    expect(readCommitMessage(repo, hashes.c3)).toBe('修复 共同问题')
    expect(readCommitMessage(repo, 'deadbeef')).toBeNull()
    expect(readCommitMessage(repo, '--all')).toBeNull()
  })
})
