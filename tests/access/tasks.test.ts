/**
 * 任务单的出口（DL-37，TK-4）：命令行 `arch tasks` 的快照（Markdown 与 --json），MCP 工具 tasks 与命令行同一份结果。
 * 用临时的模型根目录（ARCH_MODEL_ROOT）起真实的命令行与 MCP 子进程。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createService, tasksOutput } from '../../scripts/agent/service'

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-tasks-'))
const modelRoot = path.join(root, 'model')
const P = path.join(modelRoot, 'p')
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(P, rel)), { recursive: true })
  fs.writeFileSync(path.join(P, rel), text)
}

beforeAll(() => {
  write('system.yaml', 'system: { id: p, name: P }')
  write(
    'intent/skeleton.yaml',
    'sketch:\n  id: skeleton\n  mount: root\n  lifetime: persistent\n  closed: [core]\n  modules:\n    - id: core\n      name: Core\n      kind: layer\n      children:\n        - { id: core.a, name: A }\n',
  )
  write(
    'modules/all.yaml',
    'modules:\n  - { id: core.a.x, name: X, parent: core.a }\n  - { id: core.a.y, name: Y, parent: core.a }\nrelations:\n  - { id: rel.x-y, from: core.a.x, to: core.a.y, type: commands }\n',
  )
  write('designs/d/design.yaml', "design:\n  name: 拆出 Z\n  status: accepted\n  approval: { at: '2026-11-05', sketches: {} }\n")
  write(
    'designs/d/sketches/core.a.yaml',
    'sketch:\n  id: d\n  mount: core.a\n  modules:\n    - { id: core.a.x, name: X }\n    - { id: core.a.y, name: Y }\n    - { id: core.a.z, name: Z }\n  relations:\n    - { id: rel.x-y, from: core.a.x, to: core.a.y, type: commands }\n',
  )
  write(
    'designs/d/changes.json',
    JSON.stringify({ nextNumber: 2, items: [{ n: 1, key: 'added:module:core.a.z', kind: 'added', summary: '新增 Z', round: 1, by: 'ai' }] }),
  )
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

const src = path.join(root, 'src')
fs.mkdirSync(src, { recursive: true })
const env = { ...process.env, ARCH_MODEL_ROOT: modelRoot, ARCH_SOURCE_ROOT_P: src }
const cli = (...args: string[]) => {
  try {
    return execFileSync(path.join(pkg, 'node_modules/.bin/vite-node'), ['scripts/arch.ts', '--', ...args], {
      cwd: pkg,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8')
  } catch (e) {
    throw new Error(`命令行失败：${String((e as { stderr?: Buffer }).stderr ?? e)}${String((e as { stdout?: Buffer }).stdout ?? '')}`)
  }
}

describe('DL-37 命令行 arch tasks', () => {
  it('Markdown 快照：任务单头、语义、每项号 · 状态 · 怎样算做到 · 还差', () => {
    expect(cli('tasks', '--design', 'd', '--project', 'p').trimEnd()).toMatchInlineSnapshot(`
      "# 任务单：设计「拆出 Z」（d）

      > 有效：认可于 2026-11-05
      >
      > 这是任务单，不是问题清单：每一项是「代码现在是这样、草图要它变成那样」的一条差别。把代码改到位、重新生成当前描述后，架构台按核验自动重算——偏差消失即 ✓，还在即「待做」；不要手工勾选，也不要改草图、规则与确认记录。

      进度：✓ 0 · 待做 1 · 不核验 0

      ## #1 待做 · 新增 · 新增 Z

      - 挂在：core.a · 第 1 轮 · AI
      - 怎样算做到：当前版本里有模块 core.a.z（Z）（核验 sketch.missing-module）
      - 还差：草图的模块「core.a.z」（Z）在版本里不存在：AI 必须沿用草图的 ID，重命名或移动只能经草图（sketch.missing-module）"
    `)
  }, 60_000)
  it('--json 为结构化结果，与服务函数同一份', () => {
    const json = JSON.parse(cli('tasks', '--design', 'd', '--project', 'p', '--json'))
    const svc = createService({ root, modelRoot, client: 'cli', env } as Parameters<typeof createService>[0])
    expect(json).toEqual(JSON.parse(JSON.stringify(svc.tasks('p', 'd').list)))
    expect(json).toMatchObject({ design: 'd', state: 'active', counts: { todo: 1 }, rows: [{ n: 1, state: 'todo', kind: 'added' }] })
  }, 60_000)
})

describe('DL-37 MCP 工具 tasks 与命令行同一份结果', () => {
  it('markdown 与 json 两种都与命令行逐字相同', async () => {
    const client = new Client({ name: 'tasks-test', version: '0' })
    await client.connect(
      new StdioClientTransport({
        command: path.join(pkg, 'node_modules/.bin/vite-node'),
        args: ['scripts/arch-mcp.ts'],
        cwd: pkg,
        env: env as Record<string, string>,
        stderr: 'ignore',
      }),
    )
    try {
      const text = async (format: 'markdown' | 'json') => {
        const r = (await client.callTool({ name: 'tasks', arguments: { design: 'd', project: 'p', format } })) as { content: { text: string }[] }
        return r.content[0].text
      }
      // 命令行 console.log 只多一个换行
      expect(`${await text('markdown')}\n`).toBe(cli('tasks', '--design', 'd', '--project', 'p'))
      expect(`${await text('json')}\n`).toBe(cli('tasks', '--design', 'd', '--project', 'p', '--json'))
      const svc = createService({ root, modelRoot, client: 'cli', env } as Parameters<typeof createService>[0])
      expect(await text('json')).toBe(tasksOutput(svc.tasks('p', 'd'), 'json'))
    } finally {
      await client.close()
    }
  }, 60_000)
})
