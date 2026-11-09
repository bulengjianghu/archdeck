/**
 * git 读取（E5、E6）：在临时 git 仓库里提交两版描述，列出提交、读快照、附对比基线。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isRev, listModelCommits, readCommitVersion, readModelAt } from '../../vite/readGit'

let repo: string
let modelRoot: string
const hashes: string[] = []

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim()
function write(rel: string, text: string) {
  const full = path.join(modelRoot, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, text)
}
function commit(msg: string) {
  git('add', '-A')
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', msg)
  hashes.unshift(git('rev-parse', 'HEAD'))
}

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-git-'))
  modelRoot = path.join(repo, 'model')
  git('init', '-q')
  write('p/system.yaml', 'system: { id: p, name: P }')
  write('p/modules/m.yaml', 'modules: [{ id: a, name: A, responsibility: x }]')
  commit('第一版')
  write('p/modules/m.yaml', 'modules: [{ id: a, name: A, responsibility: x }, { id: b, name: B, responsibility: y }]')
  write('p/designs/d/design.yaml', 'design: { name: D }')
  write('p/governance/baseline.json', '{}')
  commit('加模块 B')
  write('other/system.yaml', 'system: { id: other, name: O }')
  commit('别的项目')
  // 工作区：再改一次，未提交
  write('p/modules/m.yaml', 'modules: [{ id: a, name: A2, responsibility: x }]')
})
afterAll(() => fs.rmSync(repo, { recursive: true, force: true }))

describe('E5 提交版本', () => {
  it('只列改动过该项目描述的提交，新的在前', () => {
    const list = listModelCommits(path.join(modelRoot, 'p'))
    expect(list.map(c => c.subject)).toEqual(['加模块 B', '第一版'])
    expect(list[0]).toMatchObject({ hash: hashes[1], short: expect.any(String), date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
  })

  it('读描述在某个提交时的快照：跳过 designs/ 与 governance/；提交号只收十六进制', () => {
    const files = readModelAt(path.join(modelRoot, 'p'), hashes[1])!
    expect(files.map(f => f.path)).toEqual(['modules/m.yaml', 'system.yaml'])
    expect(files[0].text).toContain('id: b')
    expect(readModelAt(path.join(modelRoot, 'p'), 'HEAD;rm')).toBeNull()
    expect(isRev('abc1234')).toBe(true)
    expect(isRev('--all')).toBe(false)
    // 项目当时还不存在
    expect(readModelAt(path.join(modelRoot, 'other'), hashes[2])).toBeNull()
  })

  it('E6：对比基线缺省为更早的一个提交；可指定 worktree（当前版本）或另一个提交；最早的提交缺省对比当前版本', () => {
    const v = readCommitVersion(modelRoot, 'p', hashes[1], undefined, repo)!
    expect(v.version).toEqual({ commit: hashes[1], base: hashes[2] })
    expect(v.compare?.current.label).toMatch(/^提交 /)
    expect(v.compare?.current.files.find(f => f.path === 'modules/m.yaml')!.text).not.toContain('id: b')
    expect(v.commits?.length).toBe(2)
    const w = readCommitVersion(modelRoot, 'p', hashes[1], 'worktree', repo)!
    expect(w.compare?.current).toMatchObject({ label: '当前版本' })
    expect(w.compare?.current.files.find(f => f.path === 'modules/m.yaml')!.text).toContain('A2')
    expect(readCommitVersion(modelRoot, 'p', hashes[2], undefined, repo)!.version).toEqual({ commit: hashes[2], base: 'worktree' })
    expect(readCommitVersion(modelRoot, 'p', 'deadbeef', undefined, repo)).toBeNull()
  })
})
