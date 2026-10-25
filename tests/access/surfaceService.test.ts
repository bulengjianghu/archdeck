/** Q16、K19：agent 接口的模块表面（arch surface 与 MCP surface 同一查询核心）与 metrics 的 W / B——真实读取的源码、依赖与入口导出 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createService } from '../../scripts/agent/service'

let ws: string
let projectRoot: string

function write(base: string, rel: string, text: string) {
  const full = path.join(base, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, text)
}

beforeAll(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-surface-'))
  projectRoot = path.join(ws, 'demo', 'packages', 'desk')
  const repo = path.join(ws, 'app')
  write(repo, 'packages/core/package.json', JSON.stringify({ name: '@demo/core', main: 'src/index.ts' }))
  write(repo, 'packages/core/src/index.ts', "export * from './engine'\nexport { helper as assist } from './helper'\nexport function unused() {}\n")
  write(repo, 'packages/core/src/engine.ts', 'export class Engine {}\nexport interface Port { go(): void }\n')
  write(repo, 'packages/core/src/helper.ts', 'export function helper() {}\nexport function inner() {}\n')
  write(
    repo,
    'src/a.ts',
    "import { Engine, assist } from '@demo/core'\nimport { inner } from '../packages/core/src/helper'\nexport const run = () => { new Engine(); assist(); inner() }\n",
  )
  write(repo, 'src/b.ts', "import type { Port } from '@demo/core'\nexport class Impl implements Port { go() {} }\n")
  write(projectRoot, 'model/app/system.yaml', 'system: { id: app, name: App, source: { repo: app } }')
  write(
    projectRoot,
    'model/app/modules.yaml',
    `
modules:
  - { id: a, name: A, responsibility: 用核心, codeRefs: [src/a.ts] }
  - { id: b, name: B, responsibility: 实现端口, codeRefs: [src/b.ts] }
  - { id: core, name: Core, responsibility: 核心, codeRefs: [packages/core/**], provides: [if.port, if.gone] }
interfaces:
  - { id: if.port, name: Port, owner: core, implementedBy: [b] }
  - { id: if.gone, name: 'gone()', owner: core }
relations:
  - { id: r.1, from: a, to: core, type: commands }
`,
  )
})

afterAll(() => fs.rmSync(ws, { recursive: true, force: true }))

describe('Q16 模块表面', () => {
  const svc = () => createService({ root: projectRoot, client: 'cli', env: { ARCH_WORKSPACE_ROOT: ws } })

  it('元素清单（种类 · 声明状态 · 扇入）、W / B、越过入口清单与建议；再导出穿透到声明文件', () => {
    const r = svc().surface('core')
    expect(r).toMatchObject({ entry: 'packages/core/src/index.ts', exports: true, w: 3, b: 1 })
    expect(r.elements.map(e => `${e.name}:${e.kind}:${e.state}:${e.fanIn}`)).toEqual([
      'Port:port:declared-exported:1',
      'assist:operation:exported-only:1',
      'Engine:operation:exported-only:1',
      'unused:operation:exported-only:0',
      'gone:operation:declared-only:0',
    ])
    expect(r.elements.find(e => e.name === 'Engine')!.at).toBe('packages/core/src/engine.ts:1')
    expect(r.bypasses).toEqual([{ at: 'src/a.ts:2', to: 'packages/core/src/helper.ts', names: ['inner'] }])
    expect(r.suggestions.join('\n')).toMatch(/越过入口 1 处.*U18/)
    expect(r.suggestions.join('\n')).toMatch(/gone.*G12/)
  })

  it('没有入口的模块：W / B 不给并说明；不是模块报错', () => {
    const r = svc().surface('a')
    expect(r).toMatchObject({ entry: null, w: null, b: null })
    expect(r.suggestions[0]).toMatch(/没有入口/)
    expect(() => svc().surface('nope')).toThrow(/不是模块/)
  })

  it('K19：metrics 的行有入口的模块带 W / B', () => {
    const r = svc().metrics(undefined, {})
    if (r.kind !== 'list') throw new Error('应为列表')
    expect(r.modules.find(m => m.id === 'core')).toMatchObject({ w: 3, b: 1 })
    expect(r.modules.find(m => m.id === 'a')).not.toHaveProperty('w')
    const d = svc().metrics(undefined, { module: 'core' })
    expect(d.kind === 'module' && d.module).toMatchObject({ w: 3, b: 1 })
  })
})
