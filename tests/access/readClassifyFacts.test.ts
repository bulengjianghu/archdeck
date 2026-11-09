/**
 * 分类用的源码事实（ADR-0029 §5，`arch classify`）：调用点（结果是否被使用、句柄上的成员、Vue 模板里的事件与插值）、
 * 签名的返回形态（写了返回类型按类型、没写按函数体）、目标文件的状态持有。在临时目录里搭源码验证。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readCodeDeps } from '../../vite/readDeps'
import { readClassifyCode } from '../../vite/readClassifyFacts'
import type { ClassifyCode } from '../../src/model'

let root: string
let code: ClassifyCode

const FILES: Record<string, string> = {
  'src/calc.ts': [
    'export function total(xs: number[]): number { return xs.length }',
    'export const isEmpty = (xs: number[]) => xs.length === 0',
    'export async function load(): Promise<void> { await Promise.resolve() }',
    'export function reset() { console.log(1) }',
    'export async function fetchAll() { return [1] }',
    'export class Box { put(x: number): void { this.x = x }; x = 0 }',
  ].join('\n'),
  'src/store.ts':
    "import { reactive } from 'vue'\nexport const state = reactive({ n: 0 })\nexport function useStore() { return { bump() { state.n++ }, count: () => state.n } }\n",
  'src/io.ts': "import fs from 'node:fs'\nexport function save(t: string) { fs.writeFileSync('a', t) }\n",
  'src/view.ts': [
    "import { total, isEmpty, load, reset, fetchAll, Box } from './calc'",
    "import { useStore } from './store'",
    "import { save } from './io'",
    'const t = total([1])',
    'if (isEmpty([])) reset()',
    'async function go() { await load(); const xs = await fetchAll(); return xs }',
    'Box.prototype',
    'const s = useStore()',
    's.bump()',
    'const n = s.count()',
    "save('x')",
    'export { t, n, go }',
  ].join('\n'),
  'src/Panel.vue': [
    '<template><button @click="s.bump()">{{ s.count() }}</button></template>',
    '<script setup lang="ts">',
    "import { useStore } from './store'",
    'const s = useStore()',
    '</script>',
  ].join('\n'),
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-classify-'))
  for (const [rel, text] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), text)
  }
  const files = Object.keys(FILES)
  const deps = readCodeDeps(root, files, {})
  code = readClassifyCode(root, files, {}, deps.deps, new Map([['m.calc', ['src/calc.ts']]]))
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

const sites = (from: string, to: string) => code.sites.get(`${from}\0${to}`) ?? []

describe('调用点', () => {
  it('结果被赋值、作条件、await 后赋值为 used；语句调用为 not used', () => {
    const s = sites('src/view.ts', 'src/calc.ts')
    expect(s.find(x => x.name === 'total')).toMatchObject({ called: true, used: true })
    expect(s.find(x => x.name === 'isEmpty')).toMatchObject({ called: true, used: true })
    expect(s.find(x => x.name === 'reset')).toMatchObject({ called: true, used: false })
    expect(s.find(x => x.name === 'load')).toMatchObject({ called: true, used: false, awaited: true })
    expect(s.find(x => x.name === 'fetchAll')).toMatchObject({ called: true, used: true, awaited: true })
    expect(s.find(x => x.name === 'Box')).toMatchObject({ member: 'prototype', called: false })
  })

  it('句柄（const s = useStore()）上的成员调用记为 handle', () => {
    const s = sites('src/view.ts', 'src/store.ts')
    expect(s.find(x => x.member === 'bump')).toMatchObject({ handle: true, used: false })
    expect(s.find(x => x.member === 'count')).toMatchObject({ handle: true, used: true })
  })

  it('Vue 模板：事件处理里的调用不取结果，插值里的取结果', () => {
    const s = sites('src/Panel.vue', 'src/store.ts')
    expect(s.find(x => x.member === 'bump' && x.used !== undefined)).toMatchObject({ used: false })
    expect(s.find(x => x.member === 'count' && x.used !== undefined)).toMatchObject({ used: true })
  })
})

describe('签名与状态持有', () => {
  it('返回形态：写了返回类型按类型，没写按函数体与 async', () => {
    const d = (n: string) => code.decls.get(`src/calc.ts\0${n}`)
    expect(d('total')).toMatchObject({ kind: 'function', returns: 'value' })
    expect(d('isEmpty')?.returns).toBe('value')
    expect(d('load')?.returns).toBe('promise-void')
    expect(d('reset')?.returns).toBe('void')
    expect(d('fetchAll')?.returns).toBe('promise-value')
    expect(d('Box')?.kind).toBe('class')
    expect(d('Box.put')?.returns).toBe('void')
  })

  it('状态持有：模块级 reactive、类实例字段、写文件', () => {
    expect(code.state.get('src/store.ts')?.store).toBe('reactive')
    expect(code.state.get('src/calc.ts')?.instance).toContain('this.x')
    expect(code.state.get('src/io.ts')?.io).toContain('writeFileSync')
    expect(code.state.has('src/view.ts')).toBe(false)
  })
})
