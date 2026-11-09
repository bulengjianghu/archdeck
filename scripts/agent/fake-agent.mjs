#!/usr/bin/env node
/**
 * 假 agent 替身（第二十一轮 T0.5，DL-11）：所有单测与 E2E 都用它代替真实 claude。
 * 读 stdin 的上下文包（JSON），按剧本文件回放薄协议的流式输出（一行一个 JSON：text / block / done）。
 *
 * 用法：node scripts/agent/fake-agent.mjs --script <剧本.json>
 *       node scripts/agent/fake-agent.mjs --dir <剧本目录>   按上下文包挑剧本：输入里的「#名字」→ <名字>.json；否则 <mode>.json；否则 normal.json
 *
 * 剧本：{ "steps": [ … ] }，每步一种——
 *   { "wait": 毫秒 }                       等一会儿（「超时」剧本就是等很久）
 *   { "text": "…" }                        文本片段
 *   { "block": { … }, "replace": [[a, b]] } 结构化块；replace 在占位符替换后对块里的字符串做文本替换
 *   { "done": true }                       结束
 *   { "raw": "…" }                         原样输出一行（造非法产出）
 *   { "exit": 码, "stderr": "…" }           立即退出（「崩溃」剧本用非零码）
 * 字符串里的 {{a.b}} 取上下文包里该路径的字符串值（如 {{anchor.module}}、{{explainer.html}}）。
 * 环境变量 FAKE_AGENT_DUMP=<文件> 时把收到的上下文包原样写进该文件（测试断言上下文包用）。
 */
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const flag = name => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const readStdin = () =>
  new Promise(resolve => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', c => (buf += c))
    process.stdin.on('end', () => resolve(buf))
  })

const get = (obj, p) => p.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj)

function fill(value, pack, replace) {
  if (typeof value === 'string') {
    let s = value.replace(/\{\{([\w.]+)\}\}/g, (_, p) => {
      const v = get(pack, p)
      return typeof v === 'string' ? v : ''
    })
    for (const [a, b] of replace ?? []) s = s.split(a).join(b)
    return s
  }
  if (Array.isArray(value)) return value.map(v => fill(v, pack, replace))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, pack, replace)]))
  return value
}

function pickScript(pack) {
  const explicit = flag('--script')
  if (explicit) return explicit
  const dir = flag('--dir') ?? path.join(path.dirname(new URL(import.meta.url).pathname), 'scripts')
  const text = String(get(pack, 'request.text') ?? '')
  const tag = /(?:^|\s)#([a-z][\w-]*)/i.exec(text)?.[1]
  for (const name of [tag, get(pack, 'request.mode'), 'normal']) {
    if (typeof name !== 'string') continue
    const file = path.join(dir, `${name}.json`)
    if (fs.existsSync(file)) return file
  }
  throw new Error(`剧本目录 ${dir} 里没有可用的剧本`)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const line = obj => process.stdout.write(`${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n`)

const input = await readStdin()
let pack = {}
try {
  pack = input.trim() ? JSON.parse(input) : {}
} catch {
  // 真实 claude 收的是文本提示；假 agent 也容忍非 JSON 输入（当作 request.text）
  pack = { request: { text: input } }
}
if (process.env.FAKE_AGENT_DUMP) fs.writeFileSync(process.env.FAKE_AGENT_DUMP, JSON.stringify(pack, null, 2))

const script = JSON.parse(fs.readFileSync(pickScript(pack), 'utf8'))
for (const step of script.steps ?? []) {
  if (typeof step.wait === 'number') await sleep(step.wait)
  else if (typeof step.text === 'string') line({ type: 'text', text: fill(step.text, pack) })
  else if (step.block) line({ type: 'block', block: fill(step.block, pack, step.replace) })
  else if (step.done) line({ type: 'done' })
  else if (typeof step.raw === 'string') line(step.raw)
  else if (typeof step.exit === 'number') {
    if (step.stderr) process.stderr.write(`${step.stderr}\n`)
    process.exit(step.exit)
  }
}
