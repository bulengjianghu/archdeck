/**
 * 依赖提取、治理存储与 agent 接口（docs/02-domain.md K1–K3、K8、U7、Q3–Q6）：在临时目录里搭工作区与被描述项目验证。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createResolver, parseImports, parseVueImports, readCodeDeps, resolveImport } from '../../vite/readDeps'
import { appendLedger, readBaseline, readLedger, writeBaseline } from '../../vite/governanceStore'
import { listSourceFiles } from '../../vite/readSource'
import { readModelDir } from '../../vite/readModelDir'
import { createService } from '../../scripts/agent/service'

let ws: string
let projectRoot: string
let repo: string
let files: string[]

function write(base: string, rel: string, text: string) {
  const full = path.join(base, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, text)
}

const PACKAGES = {
  'packages/core': { name: '@demo/core', main: 'dist/index.js' },
  'packages/util': { name: '@demo/util', exports: { '.': { import: './src/main.ts' } } },
}

beforeAll(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-deps-'))
  projectRoot = path.join(ws, 'demo', 'packages', 'desk')
  repo = path.join(ws, 'app')
  write(repo, 'tsconfig.json', '{ /* 注释 */ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }')
  write(repo, 'packages/core/package.json', JSON.stringify(PACKAGES['packages/core']))
  write(repo, 'packages/core/src/index.ts', "export * from './engine'\nexport { helper as assist } from './helper'\nexport const version = 1\n")
  write(repo, 'packages/core/src/engine.ts', 'export class Engine {}\nexport type Mode = string\n')
  write(repo, 'packages/core/src/helper.ts', 'export function helper() {}\n')
  write(repo, 'packages/util/package.json', JSON.stringify(PACKAGES['packages/util']))
  write(repo, 'packages/util/src/main.ts', 'export const u = 1\n')
  write(
    repo,
    'src/app.ts',
    [
      "import { Engine, assist } from '@demo/core'",
      "import type { Mode } from '@demo/core'",
      "import * as all from '@demo/core'",
      "import { u } from '@demo/util'",
      "import { x } from '@/lib/x.js'",
      "import vue from 'vue'",
      "import './side'",
      "const lazy = () => import('./lazy')",
      "const req = require('./side')",
      'export { all, lazy, req, Engine, assist, u, x, vue }',
      'type T = import("./lazy").L',
    ].join('\n'),
  )
  write(repo, 'src/lib/x.ts', "export const x = 1\nexport { u } from '@demo/util'\n")
  write(repo, 'src/side.ts', '')
  write(repo, 'src/lazy.ts', 'export type L = 1\n')
  write(repo, 'src/View.vue', '<template><div /></template>\n<script setup lang="ts">\nimport { x } from \'./lib/x\'\n</script>\n')
  write(repo, 'src/types.d.ts', "import './side'\n")
  files = listSourceFiles(repo)

  write(projectRoot, 'model/app/system.yaml', 'system: { id: app, name: App, source: { repo: app } }')
  write(
    projectRoot,
    'model/app/modules/layers.yaml',
    `
modules:
  - { id: top, name: Top, kind: layer, order: 1, abstraction: 上, responsibility: 上层, mayDependOn: [], codeRefs: [src/**] }
  - { id: base, name: Base, kind: layer, order: 2, abstraction: 下, responsibility: 下层, mayDependOn: [], codeRefs: [packages/**] }
`,
  )
  write(projectRoot, 'model/app/governance/baseline.json', '{ "not": "a description file" }')
})

afterAll(() => fs.rmSync(ws, { recursive: true, force: true }))

describe('K1 提取导入', () => {
  it('静态导入、类型导入、命名空间、副作用、动态导入、require、import type', () => {
    const imps = parseImports('src/app.ts', fs.readFileSync(path.join(repo, 'src/app.ts'), 'utf8'))
    expect(imps.map(i => `${i.line}:${i.spec}:${i.kind}:${i.names.join(',')}`)).toEqual([
      '1:@demo/core:value:Engine,assist',
      '2:@demo/core:type:Mode',
      '3:@demo/core:value:',
      '4:@demo/util:value:u',
      '5:@/lib/x.js:value:x',
      '6:vue:value:',
      '7:./side:value:',
      '8:./lazy:value:',
      '9:./side:value:',
      '11:./lazy:type:',
    ])
  })

  it('export … from 也是依赖；全部为类型时为 type', () => {
    const imps = parseImports('a.ts', "export type { A } from './a'\nexport * from './b'\nexport { c } from './c'")
    expect(imps.map(i => `${i.spec}:${i.kind}:${i.names.join(',')}`)).toEqual(['./a:type:A', './b:value:', './c:value:c'])
  })

  it('Vue 取 <script> 块，行号按文件计', () => {
    const imps = parseVueImports('src/View.vue', fs.readFileSync(path.join(repo, 'src/View.vue'), 'utf8'))
    expect(imps).toEqual([{ spec: './lib/x', line: 3, kind: 'value', names: ['x'] }])
  })
})

describe('K2 说明符解析', () => {
  it('相对路径补全扩展名与 .js 写法；tsconfig paths；工作区包入口（产物退回 src）与 exports；外部为 null', () => {
    const r = createResolver(repo, files, PACKAGES)
    expect(r.resolve('src/app.ts', './side')).toBe('src/side.ts')
    expect(r.resolve('src/app.ts', '@/lib/x.js')).toBe('src/lib/x.ts')
    expect(r.resolve('src/app.ts', '@demo/core')).toBe('packages/core/src/index.ts')
    expect(r.resolve('src/app.ts', '@demo/core/src/engine')).toBe('packages/core/src/engine.ts')
    expect(r.resolve('src/app.ts', '@demo/util')).toBe('packages/util/src/main.ts')
    expect(r.resolve('src/app.ts', 'vue')).toBeNull()
    expect(r.resolve('src/app.ts', './missing')).toBeNull()
  })
})

describe('K3 穿透再导出', () => {
  it('命名导入追到声明文件，经由为直接导入的文件；命名空间导入以经由为目标；外部依赖按包名计数', () => {
    const code = readCodeDeps(repo, files, PACKAGES)
    const fromApp = code.deps.filter(d => d.from === 'src/app.ts').map(d => `${d.line}:${d.to}<${d.via}:${d.kind}`)
    expect(fromApp).toEqual([
      '1:packages/core/src/engine.ts<packages/core/src/index.ts:value',
      '1:packages/core/src/helper.ts<packages/core/src/index.ts:value',
      '2:packages/core/src/engine.ts<packages/core/src/index.ts:type',
      '3:packages/core/src/index.ts<packages/core/src/index.ts:value',
      '4:packages/util/src/main.ts<packages/util/src/main.ts:value',
      '5:src/lib/x.ts<src/lib/x.ts:value',
      '7:src/side.ts<src/side.ts:value',
      '8:src/lazy.ts<src/lazy.ts:value',
      '9:src/side.ts<src/side.ts:value',
      '11:src/lazy.ts<src/lazy.ts:type',
    ])
    expect(code.external).toEqual({ vue: 1 })
    // 声明文件（.d.ts）不作为依赖方
    expect(code.deps.some(d => d.from === 'src/types.d.ts')).toBe(false)
    expect(code.deps.some(d => d.from === 'src/View.vue' && d.to === 'src/lib/x.ts')).toBe(true)
  })

  it('写前判定用的说明符解析', () => {
    expect(resolveImport(repo, files, PACKAGES, 'src/app.ts', '@demo/core', ['assist'])).toEqual([
      { to: 'packages/core/src/helper.ts', via: 'packages/core/src/index.ts' },
    ])
    expect(resolveImport(repo, files, PACKAGES, 'src/app.ts', 'react')).toEqual([])
  })
})

describe('U7、Q4 治理存储', () => {
  it('基线写入后可读回，违规键排序；拦截记录追加、坏行跳过、取最近 N 行', () => {
    const dir = path.join(ws, 'gov')
    expect(readBaseline(dir)).toBeNull()
    writeBaseline(dir, { createdAt: 't', violations: ['b', 'a'], cyclicity: { modules: 1, files: 2 } })
    expect(readBaseline(dir)!.violations).toEqual(['a', 'b'])
    appendLedger(dir, { at: '1', tool: 'rescan', client: 'cli', violations: 1, newViolations: 0, cyclicity: { modules: 0, files: 0 } })
    fs.appendFileSync(path.join(dir, 'ledger.jsonl'), 'not json\n')
    appendLedger(dir, { at: '2', tool: 'rescan', client: 'cli', violations: 0, newViolations: 0, cyclicity: { modules: 0, files: 0 } })
    expect(readLedger(dir).map(e => e.at)).toEqual(['1', '2'])
    expect(readLedger(dir, 1).map(e => e.at)).toEqual(['2'])
  })

  it('读取描述时跳过 governance/', () => {
    const { files: model } = readModelDir(path.join(projectRoot, 'model/app'), projectRoot)
    expect(model.map(f => f.path)).toEqual(['modules/layers.yaml', 'system.yaml'])
  })
})

describe('Q2–Q6 agent 接口的查询核心', () => {
  const svc = () => createService({ root: projectRoot, client: 'cli', env: { ARCH_WORKSPACE_ROOT: ws } })

  it('Q6：唯一项目为缺省；不存在的项目报错', () => {
    expect(svc().overview().project).toBe('app')
    expect(() => svc().overview('nope')).toThrow(/项目不存在/)
  })

  it('Q2：按说明符判定并写拦截记录；外部依赖无约束', () => {
    const s = svc()
    const r = s.check('src/app.ts', '@demo/core', undefined, ['Engine'])
    expect(r.verdict).toBe('denied')
    expect(r.resolved).toEqual([{ to: 'packages/core/src/engine.ts', via: 'packages/core/src/index.ts' }])
    expect(s.check('src/app.ts', 'vue').verdict).toBe('unconstrained')
    const report = s.report()
    expect(report.checks).toBe(2)
    expect(report.byVerdict.denied).toBe(1)
  })

  it('Q3：重新扫描与上一次、与基线比较；U7：生成基线后门禁不再失败', () => {
    const s = svc()
    const first = s.rescan()
    expect(first.violations).toBeGreaterThan(0)
    expect(first.sinceBaseline).toBeNull()
    const b = s.baseline()
    expect(b.file).toBe('model/app/governance/baseline.json')
    const again = s.rescan()
    expect(again.sinceBaseline).toEqual({ added: [], removed: [] })
    expect(again.sinceLastScan).toEqual({ added: [], removed: [] })
    expect(again.gateFailed).toBe(false)
  })
})
