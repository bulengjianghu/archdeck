/**
 * agent 子进程管理（DA-11，DL-18；ADR-0063 决策 11，ADR-0020 定位不变）：本地开发服务器起子进程，架构台不碰登录态与密钥。
 * - 命令可配：缺省 claude 命令行的流式 JSON 输出模式（--output-format stream-json），只读工具集（Read / Grep / Glob + 架构台 MCP 的只读查询），
 *   工作目录 = 被描述项目的源码根，--add-dir 只加架构台目录（与贴图的临时目录）；环境变量里像密钥的一律不传（safeEnv）。
 *   ARCH_AGENT_COMMAND（JSON 数组）换成别的命令（测试用假 agent：scripts/agent/fake-agent.mjs），它说薄协议、收 JSON 上下文包。
 * - 一个对话会话（一个页面，轮次编号的前缀）同时只有一轮，不同页面互不阻塞；超时（ARCH_AGENT_TIMEOUT_MS，缺省 180s）视同停止；停止 = 终止整个进程组、这一轮什么都不落；
 *   非零退出 = 崩溃，出错误事件；不合法的产出（薄协议之外的行、不合法的结构化块）整轮拒绝。
 * - 结构化块攒到「done」才一次性交出（一轮一步，DL-1）；文本片段随到随推。
 * 只搬运与翻译，不解释上下文包与结构化块的含义（那在模型层 src/model/dialogue/）。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { AGENT_QUERY_TOOLS, parseBlock, parseEventLine, validateEditBlock, type AgentBlock } from '../src/model'

/** 推给页面的事件（页面侧 state/desk/dialogue.ts 的 AgentPush） */
export type DialogueEvent =
  | { turn: string; type: 'text'; text: string }
  | { turn: string; type: 'done'; blocks: AgentBlock[]; outcome?: unknown }
  | { turn: string; type: 'error'; message: string }
  | { turn: string; type: 'stopped'; reason: 'stopped' | 'timeout' }

export interface AgentConfig {
  command: string
  args: string[]
  /** thin：子进程直接说薄协议；claude：claude 命令行的 stream-json，由适配器翻译 */
  protocol: 'thin' | 'claude'
  /** 上下文包怎么给：json 原样、prompt 包一段说明（packPrompt） */
  input: 'json' | 'prompt'
  timeoutMs: number
}

export const DEFAULT_TIMEOUT_MS = 180_000

/** 只读工具集：内置的读文件三件 + 架构台 MCP 里不写记录的查询（AGENT_QUERY_TOOLS） */
export function claudeArgs(deskRoot: string): string[] {
  const mcp = { mcpServers: { arch: { command: 'npm', args: ['run', '--silent', 'arch:mcp'], cwd: deskRoot } } }
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--tools',
    'Read,Grep,Glob',
    '--strict-mcp-config',
    '--mcp-config',
    JSON.stringify(mcp),
    '--allowedTools',
    ['Read', 'Grep', 'Glob', ...AGENT_QUERY_TOOLS.map(t => `mcp__arch__${t}`)].join(','),
    '--add-dir',
    deskRoot,
  ]
}

/** 命令从环境变量读：ARCH_AGENT_COMMAND（JSON 数组，相对路径按本包目录解析）、ARCH_AGENT_TIMEOUT_MS */
export function agentConfigFromEnv(env: NodeJS.ProcessEnv, deskRoot: string): AgentConfig {
  const timeoutMs = Number(env.ARCH_AGENT_TIMEOUT_MS) > 0 ? Number(env.ARCH_AGENT_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS
  const custom = env.ARCH_AGENT_COMMAND ? (JSON.parse(env.ARCH_AGENT_COMMAND) as string[]) : null
  if (custom?.length) {
    const [command, ...args] = custom
    return {
      command,
      args: args.map(a => (a.startsWith('./') || a.startsWith('scripts/') ? path.resolve(deskRoot, a) : a)),
      protocol: 'thin',
      input: 'json',
      timeoutMs,
    }
  }
  return { command: 'claude', args: claudeArgs(deskRoot), protocol: 'claude', input: 'prompt', timeoutMs }
}

/** 不传任何密钥：名字像密钥、令牌、口令、凭据的环境变量一律去掉（claude 用它自己的登录态） */
const SECRET = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION/i
export function safeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !SECRET.test(k)))
}

/** claude 的 stream-json → 薄协议的行（文本里的 JSON 行原样当薄协议；散文按文本片段；``` 围栏丢掉） */
export function claudeLines(raw: string): { lines: string[]; result?: { error: boolean; text?: string } } {
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return { lines: [] }
  }
  if (obj.type === 'assistant') {
    const content = ((obj.message as { content?: unknown[] } | undefined)?.content ?? []) as { type?: string; text?: string }[]
    const lines: string[] = []
    for (const c of content)
      if (c.type === 'text' && c.text)
        for (const l of c.text.split('\n')) {
          const t = l.trim()
          if (!t || t.startsWith('```')) continue
          lines.push(t.startsWith('{') ? t : JSON.stringify({ type: 'text', text: `${l}\n` }))
        }
    return { lines }
  }
  if (obj.type === 'result')
    return { lines: [], result: { error: obj.is_error === true || obj.subtype !== 'success', text: typeof obj.result === 'string' ? obj.result : undefined } }
  return { lines: [] }
}

export interface TurnStart {
  project: string
  /** 对话会话（页面）的编号：同一会话同时只有一轮 */
  session: string
  turn: string
  /** 上下文包：json 模式原样发；prompt 模式发 promptText */
  pack: unknown
  promptText: string
  cwd: string
  addDirs?: string[]
  /** 说完之后、推「done」之前的收尾（重讲落盘等）；返回值随 done 推出 */
  finish?: (blocks: AgentBlock[]) => Promise<unknown>
  /** 一轮以任何方式结束时（落盘转录等） */
  settled?: (e: DialogueEvent) => void
}

interface Running {
  project: string
  turn: string
  child: ChildProcess
  timer: ReturnType<typeof setTimeout>
  /** 已经由我们结束（停止 / 超时 / 拒绝），之后的退出不再报崩溃 */
  ended: boolean
  settled?: (e: DialogueEvent) => void
}

/** 杀整个进程组（claude 会再起 MCP 子进程）；进程组没了退回只杀它自己 */
function killTree(child: ChildProcess) {
  if (child.pid === undefined || child.exitCode !== null) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

export function createAgentRunner(config: AgentConfig, emit: (project: string, e: DialogueEvent) => void) {
  /** 键：项目 + 对话会话 */
  const running = new Map<string, Running>()
  const keyOf = (project: string, session: string) => `${project}\u0000${session}`

  function end(project: string, r: Running, e: DialogueEvent, settled?: (e: DialogueEvent) => void) {
    if (r.ended) return
    r.ended = true
    clearTimeout(r.timer)
    killTree(r.child)
    for (const [k, x] of running) if (x === r) running.delete(k)
    emit(project, e)
    settled?.(e)
  }
  const find = (project: string, turn?: string) => [...running.values()].find(r => r.project === project && (!turn || r.turn === turn))

  function start(t: TurnStart): { ok: true } | { ok: false; error: string } {
    const key = keyOf(t.project, t.session)
    if (running.has(key)) return { ok: false, error: '这个对话已有一轮在进行，先停止或等它说完' }
    if ([...running.values()].some(r => r.turn === t.turn && r.project === t.project)) return { ok: false, error: '轮次编号重复' }
    const args = config.protocol === 'claude' ? [...config.args, ...(t.addDirs ?? []).flatMap(d => ['--add-dir', d])] : config.args
    const child = spawn(config.command, args, { cwd: t.cwd, env: safeEnv(process.env), detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const r: Running = {
      project: t.project,
      turn: t.turn,
      child,
      ended: false,
      settled: t.settled,
      timer: setTimeout(() => end(t.project, r, { turn: t.turn, type: 'stopped', reason: 'timeout' }, t.settled), config.timeoutMs),
    }
    running.set(key, r)
    const blocks: AgentBlock[] = []
    let stderr = ''
    let buf = ''
    let doneSeen = false

    const reject = (why: string) => end(t.project, r, { turn: t.turn, type: 'error', message: `产出不合法，整轮拒绝：${why}` }, t.settled)
    const finish = () => {
      if (doneSeen || r.ended) return
      doneSeen = true
      clearTimeout(r.timer)
      const settle = async () => {
        let outcome: unknown
        try {
          outcome = t.finish ? await t.finish(blocks) : undefined
        } catch (e) {
          return end(t.project, r, { turn: t.turn, type: 'error', message: `收尾失败：${e instanceof Error ? e.message : String(e)}` }, t.settled)
        }
        end(t.project, r, { turn: t.turn, type: 'done', blocks, ...(outcome !== undefined ? { outcome } : {}) }, t.settled)
      }
      void settle()
    }
    const onThin = (line: string) => {
      if (r.ended || doneSeen) return
      const ev = parseEventLine(line)
      if (!ev) return
      if (!ev.ok) return reject(ev.error)
      if (ev.value.type === 'text') emit(t.project, { turn: t.turn, type: 'text', text: ev.value.text })
      else if (ev.value.type === 'block') {
        const b = parseBlock(ev.value.block)
        if (!b.ok) return reject(b.error)
        // DL-21：改动块里每条操作再过编辑操作族的形状校验（AI 不许出位置类与恢复类），不合法整轮拒绝
        if (b.value.kind === 'edit') {
          const ops = validateEditBlock(b.value)
          if (!ops.ok) return reject(ops.error)
        }
        blocks.push(b.value)
      } else finish()
    }
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (chunk: string) => {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const raw = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (config.protocol === 'thin') onThin(raw)
        else {
          const c = claudeLines(raw)
          c.lines.forEach(onThin)
          if (c.result) {
            if (c.result.error) end(t.project, r, { turn: t.turn, type: 'error', message: `claude 出错：${c.result.text ?? '未知原因'}` }, t.settled)
            else finish()
          }
        }
      }
    })
    child.stderr!.setEncoding('utf8')
    child.stderr!.on('data', (c: string) => (stderr = (stderr + c).slice(-2000)))
    child.on('error', e => end(t.project, r, { turn: t.turn, type: 'error', message: `起不来：${e.message}` }, t.settled))
    child.on('close', code => {
      if (r.ended || doneSeen) return
      if (buf.trim() && config.protocol === 'thin') onThin(buf)
      if (r.ended || doneSeen) return
      end(
        t.project,
        r,
        {
          turn: t.turn,
          type: 'error',
          message: code ? `agent 崩溃（退出码 ${code}）${stderr.trim() ? `：${stderr.trim().split('\n').pop()}` : ''}` : 'agent 没说完就退出了',
        },
        t.settled,
      )
    })
    child.stdin!.on('error', () => {})
    child.stdin!.end(config.input === 'json' ? JSON.stringify(t.pack) : t.promptText)
    return { ok: true }
  }

  /** 停止：终止子进程，这一轮什么都不落（DA-11）；给了轮次只停那一轮，不给停这个项目最早的一轮 */
  function stop(project: string, turn?: string): boolean {
    const r = find(project, turn)
    if (!r) return false
    end(project, r, { turn: r.turn, type: 'stopped', reason: 'stopped' }, r.settled)
    return true
  }

  return {
    start,
    stop,
    /** 这个项目进行中的轮次 */
    running: (project: string) => [...running.values()].filter(r => r.project === project).map(r => r.turn),
    /** 进行中的子进程号（测试用：停止后应无残留） */
    pid: (project: string, turn?: string) => find(project, turn)?.child.pid ?? null,
    stopAll: () => [...running.values()].forEach(r => stop(r.project, r.turn)),
  }
}

export type AgentRunner = ReturnType<typeof createAgentRunner>
