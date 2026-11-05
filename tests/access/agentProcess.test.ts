/**
 * agent 子进程管理（T1.1，DA-11，DL-18）：一律用假 agent 替身——正常一轮、超时视同停止、停止后无残留进程、崩溃出错误事件、非法产出整轮拒绝；
 * 外加 claude stream-json 的适配与「不传密钥」。
 */
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { agentConfigFromEnv, claudeLines, createAgentRunner, safeEnv, type AgentConfig, type DialogueEvent } from '../../vite/agentProcess'

const ROOT = path.resolve(import.meta.dirname, '../..')
const FAKE = path.join(ROOT, 'scripts/agent/fake-agent.mjs')
const script = (name: string) => path.join(ROOT, 'scripts/agent/scripts', `${name}.json`)

const config = (name: string, timeoutMs = 10_000): AgentConfig => ({
  command: process.execPath,
  args: [FAKE, '--script', script(name)],
  protocol: 'thin',
  input: 'json',
  timeoutMs,
})

function runTurn(cfg: AgentConfig, opts: { stopAfter?: number } = {}) {
  const events: DialogueEvent[] = []
  let pid: number | null = null
  return new Promise<{ events: DialogueEvent[]; pid: number | null }>(resolve => {
    const runner = createAgentRunner(cfg, (_p, e) => {
      events.push(e)
      if (e.type !== 'text') setTimeout(() => resolve({ events, pid }), 50)
    })
    const r = runner.start({
      project: 'p',
      session: 's',
      turn: 't1',
      pack: { anchor: { kind: 'module', module: 'm' }, request: { mode: 'ask', text: '?' } },
      promptText: '',
      cwd: ROOT,
    })
    expect(r.ok).toBe(true)
    pid = runner.pid('p')
    if (opts.stopAfter) setTimeout(() => runner.stop('p', 't1'), opts.stopAfter)
  })
}

const alive = (pid: number | null) => {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('子进程一轮（假 agent）', () => {
  it('正常一轮：文本片段随到随推，结构化块攒到 done 一次交出', async () => {
    const { events } = await runTurn(config('normal'))
    expect(events.map(e => e.type)).toEqual(['text', 'done'])
    const done = events[1]
    expect(done.type === 'done' && done.blocks.map(b => b.kind)).toEqual(['answer'])
  })

  it('超时视同停止：推 stopped（timeout），子进程被终止', async () => {
    const { events, pid } = await runTurn(config('timeout', 300))
    expect(events.at(-1)).toEqual({ turn: 't1', type: 'stopped', reason: 'timeout' })
    await new Promise(r => setTimeout(r, 100))
    expect(alive(pid)).toBe(false)
  })

  it('停止后无残留进程：推 stopped（stopped），这一轮没有 done、没有块', async () => {
    const { events, pid } = await runTurn(config('timeout'), { stopAfter: 300 })
    expect(events.map(e => e.type)).toEqual(['text', 'stopped'])
    expect(events.at(-1)).toMatchObject({ reason: 'stopped' })
    await new Promise(r => setTimeout(r, 100))
    expect(alive(pid)).toBe(false)
  })

  it('崩溃出错误事件：非零退出码与 stderr 最后一行进消息', async () => {
    const { events } = await runTurn(config('crash'))
    const e = events.at(-1)!
    expect(e.type).toBe('error')
    expect(e.type === 'error' && e.message).toMatch(/退出码 3.*崩溃/)
  })

  it('非法产出整轮拒绝：结构化块不合法 → 错误事件，前面说过的块也不交出', async () => {
    const { events } = await runTurn(config('invalid'))
    expect(events.some(e => e.type === 'done')).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('整轮拒绝') })
  })

  it('一个对话会话同时只有一轮，不同会话（页面）互不阻塞；停止只停给定的那一轮', async () => {
    const runner = createAgentRunner(config('timeout'), () => {})
    const base = { project: 'p', pack: {}, promptText: '', cwd: ROOT }
    expect(runner.start({ ...base, session: 'a', turn: 'a-1' }).ok).toBe(true)
    expect(runner.start({ ...base, session: 'a', turn: 'a-2' })).toMatchObject({ ok: false })
    expect(runner.start({ ...base, session: 'b', turn: 'b-1' }).ok).toBe(true)
    expect(runner.stop('p', 'nope')).toBe(false)
    expect(runner.running('p').sort()).toEqual(['a-1', 'b-1'])
    expect(runner.stop('p', 'a-1')).toBe(true)
    expect(runner.running('p')).toEqual(['b-1'])
    runner.stopAll()
    expect(runner.running('p')).toEqual([])
  })
})

describe('配置与边界', () => {
  it('缺省 claude 命令行：流式 JSON、只读工具集（读文件三件 + 只读查询）、add-dir 架构台；ARCH_AGENT_COMMAND 换成假 agent', () => {
    const c = agentConfigFromEnv({}, ROOT)
    expect(c.command).toBe('claude')
    expect(c.args).toEqual(
      expect.arrayContaining(['-p', '--output-format', 'stream-json', '--tools', 'Read,Grep,Glob', '--strict-mcp-config', '--add-dir', ROOT]),
    )
    const allowed = c.args[c.args.indexOf('--allowedTools') + 1]
    expect(allowed).toContain('mcp__arch__impact')
    expect(allowed).not.toMatch(/rescan|sketch_archive|check_dependency|Bash|Edit|Write/)
    const fake = agentConfigFromEnv({ ARCH_AGENT_COMMAND: JSON.stringify(['node', 'scripts/agent/fake-agent.mjs']), ARCH_AGENT_TIMEOUT_MS: '500' }, ROOT)
    expect(fake).toMatchObject({ command: 'node', args: [FAKE], protocol: 'thin', input: 'json', timeoutMs: 500 })
  })

  it('不传密钥：像密钥、令牌、口令的环境变量都去掉，PATH 与 HOME 留着', () => {
    const env = safeEnv({ PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'x', GITHUB_TOKEN: 'y', DB_PASSWORD: 'z', AWS_SECRET_ACCESS_KEY: 'w' })
    expect(Object.keys(env).sort()).toEqual(['HOME', 'PATH'])
  })

  it('claude stream-json 适配：assistant 文本里的 JSON 行即薄协议，散文成文本片段，围栏丢掉；result 收尾', () => {
    const msg = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: '先看看\n```json\n{"type":"block","block":{"kind":"answer","parts":[{"text":"x"}]}}\n```' }] },
    }
    const { lines } = claudeLines(JSON.stringify(msg))
    expect(lines).toEqual([JSON.stringify({ type: 'text', text: '先看看\n' }), '{"type":"block","block":{"kind":"answer","parts":[{"text":"x"}]}}'])
    expect(claudeLines(JSON.stringify({ type: 'result', subtype: 'success', result: 'ok' })).result).toEqual({ error: false, text: 'ok' })
    expect(claudeLines(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true })).result?.error).toBe(true)
  })
})
