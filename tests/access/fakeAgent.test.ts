/**
 * 假 agent 替身（T0.5，DL-11）：四种剧本——正常、延迟到超时、中途崩溃、非法产出——各回放出预期的薄协议输出。
 * 这里直接起替身进程、不经子进程管理，只证明替身本身可靠；子进程管理怎么处理这四种情况见 agentProcess.test.ts。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseEventLine } from '../../src/model/dialogue/protocol'

const ROOT = path.resolve(import.meta.dirname, '../..')
const FAKE = path.join(ROOT, 'scripts/agent/fake-agent.mjs')
const SCRIPTS = path.join(ROOT, 'scripts/agent/scripts')

function run(args: string[], pack: unknown, opts: { killAfter?: number; env?: NodeJS.ProcessEnv } = {}) {
  return new Promise<{ lines: string[]; code: number | null; stderr: string; killed: boolean }>(resolve => {
    const child = spawn(process.execPath, [FAKE, ...args], { env: { ...process.env, ...opts.env } })
    let out = ''
    let stderr = ''
    let killed = false
    child.stdout.on('data', c => (out += c))
    child.stderr.on('data', c => (stderr += c))
    const t = opts.killAfter
      ? setTimeout(() => {
          killed = true
          child.kill('SIGTERM')
        }, opts.killAfter)
      : undefined
    child.on('close', code => {
      clearTimeout(t)
      resolve({ lines: out.split('\n').filter(Boolean), code, stderr, killed })
    })
    child.stdin.end(JSON.stringify(pack))
  })
}

const pack = { anchor: { kind: 'module', module: 'state.desk' }, request: { mode: 'ask', text: '为什么这样分？' } }

describe('假 agent 的四种剧本', () => {
  it('正常：文本片段 → 问答卡（占位符取上下文包）→ 结束，退出码 0', async () => {
    const r = await run(['--script', path.join(SCRIPTS, 'normal.json')], pack)
    expect(r.code).toBe(0)
    const events = r.lines.map(l => parseEventLine(l))
    expect(events.every(e => e?.ok)).toBe(true)
    const values = events.map(e => (e?.ok ? e.value : null))
    expect(values.map(v => v?.type)).toEqual(['text', 'block', 'done'])
    const block = values[1]
    expect(block?.type === 'block' && block.block.kind === 'answer' && block.block.parts[0].cites?.[0]).toEqual({ module: 'state.desk', field: 'summary' })
  })

  it('延迟到超时：只给一个文本片段就一直等，被外面终止前不结束', async () => {
    const r = await run(['--script', path.join(SCRIPTS, 'timeout.json')], pack, { killAfter: 400 })
    expect(r.killed).toBe(true)
    expect(r.lines).toHaveLength(1)
    expect(parseEventLine(r.lines[0])).toEqual({ ok: true, value: { type: 'text', text: '想得有点久……' } })
  })

  it('中途崩溃：文本片段之后非零退出，stderr 有原因，没有 done', async () => {
    const r = await run(['--script', path.join(SCRIPTS, 'crash.json')], pack)
    expect(r.code).toBe(3)
    expect(r.stderr).toContain('崩溃')
    expect(r.lines.some(l => l.includes('"done"'))).toBe(false)
  })

  it('非法产出：结构化块不合法，按薄协议解析即被拒', async () => {
    const r = await run(['--script', path.join(SCRIPTS, 'invalid.json')], pack)
    expect(r.code).toBe(0)
    const bad = r.lines.map(l => parseEventLine(l)).find(e => e && !e.ok)
    expect(bad).toMatchObject({ ok: false })
  })

  it('按目录挑剧本：输入里的「#名字」优先，其次 mode，最后 normal；FAKE_AGENT_DUMP 留下收到的上下文包', async () => {
    const dump = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fake-agent-')), 'pack.json')
    const tagged = await run(['--dir', SCRIPTS], { ...pack, request: { mode: 'ask', text: '#digest 看看这张图' } }, { env: { FAKE_AGENT_DUMP: dump } })
    expect(tagged.lines.some(l => l.includes('"digest"'))).toBe(true)
    expect(JSON.parse(fs.readFileSync(dump, 'utf8')).request.text).toContain('#digest')
    const byMode = await run(['--dir', SCRIPTS], { ...pack, explainer: { html: '<h1>x</h1>' }, request: { mode: 'renarrate', text: '方向反了' } })
    expect(byMode.lines.some(l => l.includes('"renarrate"') && l.includes('renarrated'))).toBe(true)
    const fallback = await run(['--dir', SCRIPTS], pack)
    expect(fallback.lines.some(l => l.includes('"answer"'))).toBe(true)
  })
})
