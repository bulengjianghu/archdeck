/**
 * 源码读取（docs/02-domain.md G1、G2、G11、G17）：在临时目录里搭工作区与被描述项目验证。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  MAX_PREVIEW_BYTES,
  countLines,
  langOf,
  listSourceFiles,
  readExports,
  readSourceFile,
  readSourceTree,
  resolveSourceRoot,
  sourceRootEnvKey,
  workspaceRoot,
} from '../../vite/readSource'

let ws: string
let projectRoot: string
let modelRoot: string
let repo: string

function write(base: string, rel: string, text: string | Buffer) {
  const full = path.join(base, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, text)
}

beforeAll(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-ws-'))
  projectRoot = path.join(ws, 'demo', 'packages', 'desk')
  modelRoot = path.join(projectRoot, 'model')
  write(modelRoot, 'app/system.yaml', 'system: { id: app, name: App, source: { repo: app-repo } }')
  write(modelRoot, 'gone/system.yaml', 'system: { id: gone, name: Gone, source: { repo: elsewhere/gone } }')
  write(modelRoot, 'norepo/system.yaml', 'system: { id: norepo, name: NoRepo }')
  repo = path.join(ws, 'app-repo')
  write(
    repo,
    'src/index.ts',
    `
export * from './a'
export { b as renamed, type B } from './b'
export * as ns from './c'
export { ext } from 'some-package'
export default function main(x: number): string {
  return String(x)
}
const local = 1
export { local as exposed }
`,
  )
  write(
    repo,
    'src/a.ts',
    `
/** 注释 */
export function alpha(a: string, b?: number): Promise<void> {
  console.log(a, b)
  return Promise.resolve()
}
export const beta = (n: number): number => n * 2
export const gamma: Map<string, number> = new Map()
export interface Shape { w: number; h: number }
export type Id = string
export enum Color { Red, Green }
export class Store<T> extends Base {
  private secret = 1
  readonly size: number = 0
  get(id: string): T | undefined {
    return undefined
  }
}
export default 42
`,
  )
  write(repo, 'src/b.ts', 'export function b(): void {}\nexport type B = { b: 1 }\n')
  write(repo, 'src/c.ts', 'export const c = 1\n')
  write(repo, 'big.txt', 'x'.repeat(MAX_PREVIEW_BYTES + 1))
  write(repo, 'logo.png', Buffer.from([0x89, 0x50, 0x00, 0x01]))
  write(repo, 'node_modules/dep/index.js', 'module.exports = 1')
  write(repo, 'dist/out.js', '')
  write(repo, 'package.json', JSON.stringify({ main: 'dist/out.js', exports: { '.': { import: './src/index.ts' } } }))
})

afterAll(() => fs.rmSync(ws, { recursive: true, force: true }))

describe('G1 源码根目录', () => {
  it('工作区根目录默认为本包往上三级，ARCH_WORKSPACE_ROOT 可覆盖', () => {
    expect(workspaceRoot(projectRoot, {})).toBe(ws)
    expect(workspaceRoot(projectRoot, { ARCH_WORKSPACE_ROOT: '/tmp/x' })).toBe('/tmp/x')
  })
  it('工作区根目录 + source.repo', () => {
    expect(resolveSourceRoot('app', { id: 'app', name: 'App', source: { repo: 'app-repo' } }, ws, {})).toEqual({ status: 'local', root: repo })
  })
  it('ARCH_SOURCE_ROOT_<项目> 单独覆盖（项目 ID 大写，非字母数字换成 _）', () => {
    expect(sourceRootEnvKey('h5p-arch-desk')).toBe('ARCH_SOURCE_ROOT_H5P_ARCH_DESK')
    const r = resolveSourceRoot('norepo', { id: 'norepo', name: 'N' }, '/nowhere', { ARCH_SOURCE_ROOT_NOREPO: repo })
    expect(r).toEqual({ status: 'local', root: repo })
  })
  it('目录不存在或未写 repo：源码不在本地，不抛错', () => {
    expect(readSourceTree(modelRoot, 'gone', projectRoot, {})).toEqual({
      status: 'absent',
      repo: 'elsewhere/gone',
      tried: path.join(ws, 'elsewhere/gone'),
      reason: '源码不在本地',
    })
    expect(readSourceTree(modelRoot, 'norepo', projectRoot, {})).toMatchObject({ status: 'absent', reason: expect.stringContaining('repo') })
    expect(readSourceTree(modelRoot, 'nope', projectRoot, {})).toBeNull()
  })
})

describe('G2 文件清单', () => {
  it('不在 git 仓库内：遍历并排除 node_modules、dist 等目录', () => {
    const files = listSourceFiles(repo)
    expect(files).toContain('src/index.ts')
    expect(files.some(f => f.startsWith('node_modules/') || f.startsWith('dist/'))).toBe(false)
  })
  it('在 git 仓库内：按 git 的忽略规则（已跟踪 + 未跟踪且未忽略）', () => {
    const g = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-git-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: g })
      write(g, '.gitignore', 'secret/\n')
      write(g, 'a.ts', '')
      write(g, 'secret/key.ts', '')
      write(g, 'dist/kept.js', '')
      expect(listSourceFiles(g)).toEqual(['.gitignore', 'a.ts', 'dist/kept.js'])
    } finally {
      fs.rmSync(g, { recursive: true, force: true })
    }
  })
  it('readSourceTree 附带每个 package.json 的入口字段', () => {
    const tree = readSourceTree(modelRoot, 'app', projectRoot, {})
    expect(tree).toMatchObject({ status: 'local', root: repo, packages: { '': { main: 'dist/out.js', exports: { '.': { import: './src/index.ts' } } } } })
  })
})

describe('G17 读单个文件', () => {
  const files = () => listSourceFiles(repo)
  it('文本文件带语言', () => {
    expect(readSourceFile(repo, files(), 'src/b.ts')).toMatchObject({ path: 'src/b.ts', lang: 'typescript', text: expect.stringContaining('function b') })
    expect(langOf('x.vue')).toBe('vue')
    expect(langOf('Makefile')).toBe('text')
  })
  it('过大、二进制只给提示', () => {
    expect(readSourceFile(repo, files(), 'big.txt')).toEqual({ path: 'big.txt', tooLarge: MAX_PREVIEW_BYTES + 1 })
    expect(readSourceFile(repo, files(), 'logo.png')).toEqual({ path: 'logo.png', binary: true })
  })
  it('路径必须在清单中（防穿越）', () => {
    expect(readSourceFile(repo, files(), '../demo/packages/desk/model/app/system.yaml')).toBeNull()
    expect(readSourceFile(repo, files(), 'node_modules/dep/index.js')).toBeNull()
  })
})

describe('G11 导出解析', () => {
  const exportsOf = (f: string) => readExports(repo, listSourceFiles(repo), f)!
  it('各类声明：名称、类别、签名去掉函数体', () => {
    const a = exportsOf('src/a.ts')
    const by = (n: string) => a.find(s => s.name === n)!
    expect(by('alpha')).toMatchObject({ kind: 'function', signature: 'function alpha(a: string, b?: number): Promise<void>', line: 3 })
    expect(by('beta')).toMatchObject({ kind: 'const', signature: 'const beta = (n: number): number => …' })
    expect(by('gamma').signature).toBe('const gamma: Map<string, number>')
    expect(by('Shape')).toMatchObject({ kind: 'interface', signature: 'interface Shape { w: number; h: number }' })
    expect(by('Id').kind).toBe('type')
    expect(by('Color').kind).toBe('enum')
    expect(by('Store')).toMatchObject({ kind: 'class' })
    expect(by('Store').signature).toContain('get(id: string): T | undefined')
    expect(by('Store').signature).toContain('readonly size: number')
    expect(by('Store').signature).not.toContain('secret')
    expect(by('default')).toMatchObject({ kind: 'default' })
  })
  it('顺着相对路径的再导出：export *（不含默认导出）、export { a as b } from、export * as、本地 export { x as y }', () => {
    const e = exportsOf('src/index.ts')
    const names = e.map(s => s.name)
    expect(names).toEqual(expect.arrayContaining(['alpha', 'beta', 'Store', 'renamed', 'B', 'ns', 'ext', 'default', 'exposed']))
    expect(e.filter(s => s.name === 'default')).toHaveLength(1)
    expect(e.find(s => s.name === 'alpha')).toMatchObject({ from: 'src/a.ts', kind: 'function' })
    expect(e.find(s => s.name === 'renamed')).toMatchObject({ from: 'src/b.ts', signature: 'function b(): void' })
    expect(e.find(s => s.name === 'ns')).toMatchObject({ kind: 'namespace', from: 'src/c.ts' })
    expect(e.find(s => s.name === 'ext')).toMatchObject({ kind: 'reexport' })
    expect(e.find(s => s.name === 'exposed')).toMatchObject({ kind: 'const', signature: 'const local' })
    expect(e.find(s => s.name === 'default')).toMatchObject({ kind: 'default', signature: expect.stringContaining('function main(x: number): string') })
  })
  it('非 TS / JS 文件为空数组，不在清单中为 null', () => {
    expect(exportsOf('package.json')).toEqual([])
    expect(readExports(repo, listSourceFiles(repo), 'nope.ts')).toBeNull()
  })
})

describe('G19 行数', () => {
  it('只统计 TS / JS / Vue 等；按物理行数，末行无换行另计 1，空文件为 0；文件变化后重新统计', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-lines-'))
    write(dir, 'a.ts', 'a\nb\nc\n')
    write(dir, 'b.vue', 'x\ny')
    write(dir, 'c.ts', '')
    write(dir, 'd.md', '1\n2\n')
    expect(countLines(dir, ['a.ts', 'b.vue', 'c.ts', 'd.md', 'missing.ts'])).toEqual({ 'a.ts': 3, 'b.vue': 2, 'c.ts': 0 })
    write(dir, 'a.ts', 'a\nb\nc\nd\ne\n')
    expect(countLines(dir, ['a.ts'])['a.ts']).toBe(5)
  })
})
