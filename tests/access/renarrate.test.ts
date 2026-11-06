/**
 * 重讲落盘与一轮的接入（T1.2、T1.6，DL-8、DL-14）：讲法要求累积（第二次重讲带第一次的）、含事实改动的产出被拒且文件不动、
 * 题解写入时盖依据；一轮的上下文包带贴图与已有讲法要求；设计里的对话随设计落盘、当前版本上的不落。全部用假 agent 替身。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { explainerStatus, loadModel, type RenarrateBlock } from '../../src/model'
import { createAgentRunner, type DialogueEvent } from '../../vite/agentProcess'
import { recordOutcome, startTurn } from '../../vite/agentTurn'
import { readProject } from '../../vite/readModelDir'
import { applyRenarrate, readNotes } from '../../vite/writeExplainer'

const ROOT = path.resolve(import.meta.dirname, '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-renarrate-'))
const modelRoot = path.join(tmp, 'model')
const P = path.join(modelRoot, 'p')
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

const YAML = `modules:
  - id: m
    name: 模块
    summary: 给宿主一次可靠的会话
    children:
      - { id: m.a, name: 甲, summary: 按序施用全部命令 }
`
const HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body><h1>模块</h1><p><span data-arch="m" data-field="summary"></span></p></body></html>'

function write(rel: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(P, rel)), { recursive: true })
  fs.writeFileSync(path.join(P, rel), text)
}
const read = (rel: string) => fs.readFileSync(path.join(P, rel), 'utf8')

beforeEach(() => {
  fs.rmSync(P, { recursive: true, force: true })
  write('system.yaml', 'system: { id: p, name: P }\n')
  write('modules/m.yaml', YAML)
  write('explainers/m.html', HTML)
  fs.mkdirSync(path.join(P, 'designs', 'd1'), { recursive: true })
})

const block = (notes: string[], extra: Record<string, unknown> = {}): RenarrateBlock =>
  ({ kind: 'renarrate', module: 'm', notes, html: HTML.replace('</h1>', `</h1><p>${notes.join('，')}</p>`), ...extra }) as RenarrateBlock

describe('DL-8 重讲落盘', () => {
  it('讲法要求累积：两次重讲，第二次的文件带着第一次的要求；题解写入并盖上现在的依据', () => {
    expect(applyRenarrate(modelRoot, 'p', tmp, 'm', block(['先讲结论']))).toMatchObject({ applied: true, notes: ['先讲结论'] })
    expect(applyRenarrate(modelRoot, 'p', tmp, 'm', block(['箭头从调用方指向被调方']))).toMatchObject({
      applied: true,
      notes: ['先讲结论', '箭头从调用方指向被调方'],
    })
    expect(readNotes(modelRoot, 'p', 'm')).toEqual(['先讲结论', '箭头从调用方指向被调方'])
    expect(read('explainers/m.html')).toContain('箭头从调用方指向被调方')
    const { index } = loadModel(readProject(modelRoot, 'p', tmp)!.files)
    const st = explainerStatus(index, 'm')!
    expect(st.recorded).toBeTruthy()
    expect(st.stale).toBe(false)
  })

  it('含事实改动的产出整轮拒绝：题解、讲法要求、描述文件一字不动', () => {
    const before = { html: read('explainers/m.html'), yaml: read('modules/m.yaml') }
    const r = applyRenarrate(modelRoot, 'p', tmp, 'm', block(['顺手改职责'], { summary: '改短' }))
    expect(r).toMatchObject({ applied: false, reasons: [expect.stringContaining('事实字段')] })
    expect(read('explainers/m.html')).toBe(before.html)
    expect(read('modules/m.yaml')).toBe(before.yaml)
    expect(fs.existsSync(path.join(P, 'explainers/m.notes.md'))).toBe(false)
  })

  it('重讲的必须是锚点模块', () => {
    expect(applyRenarrate(modelRoot, 'p', tmp, 'm.a', block(['x']))).toMatchObject({ applied: false })
  })
})

describe('一轮的接入（假 agent）', () => {
  const FAKE = path.join(ROOT, 'scripts/agent/fake-agent.mjs')
  const PNG = `data:image/png;base64,${Buffer.from('fake-png').toString('base64')}`

  function turn(body: Record<string, unknown>, scriptDir = path.join(ROOT, 'scripts/agent/scripts')) {
    const dump = path.join(tmp, `pack-${Math.random().toString(36).slice(2)}.json`)
    process.env.FAKE_AGENT_DUMP = dump
    return new Promise<{ events: DialogueEvent[]; pack: Record<string, unknown> }>((resolve, reject) => {
      const events: DialogueEvent[] = []
      const runner = createAgentRunner(
        { command: process.execPath, args: [FAKE, '--dir', scriptDir], protocol: 'thin', input: 'json', timeoutMs: 10_000 },
        (_p, e) => {
          events.push(e)
          if (e.type !== 'text')
            setTimeout(() => {
              delete process.env.FAKE_AGENT_DUMP
              resolve({ events, pack: JSON.parse(fs.readFileSync(dump, 'utf8')) })
            }, 30)
        },
      )
      startTurn({ modelRoot, root: tmp, runner }, 'p', { session: 's', turn: 't1', ...body }).then(r => (r.ok ? undefined : reject(new Error(r.error))), reject)
    })
  }

  it('上下文包带贴图（落到磁盘、只给路径）与已有讲法要求；重讲一轮跑完落盘、done 带结果', async () => {
    applyRenarrate(modelRoot, 'p', tmp, 'm', block(['先讲结论']))
    const { events, pack } = await turn({
      mode: 'renarrate',
      anchor: { kind: 'module', module: 'm' },
      text: '方向反了',
      images: [{ name: 'wb.png', type: 'image/png', dataUrl: PNG }],
    })
    expect(pack.notes).toEqual(['先讲结论'])
    const img = (pack.images as { path: string; mediaType: string }[])[0]
    expect(img.mediaType).toBe('image/png')
    expect(fs.readFileSync(img.path, 'utf8')).toBe('fake-png')
    const done = events.at(-1)!
    expect(done).toMatchObject({ type: 'done', outcome: { applied: true, notes: ['先讲结论', '机制图的箭头从调用方指向被调方'] } })
  })

  it('设计里的对话随设计落盘（转录一行一轮、照片在设计目录）；当前版本上的不落', async () => {
    await turn({
      mode: 'ask',
      anchor: { kind: 'module', module: 'm' },
      text: '#digest 看图',
      design: 'd1',
      images: [{ name: 'wb.png', type: 'image/png', dataUrl: PNG }],
    })
    const lines = read('designs/d1/dialogue/transcript.jsonl').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toMatchObject({
      turn: 't1',
      request: { text: '#digest 看图', images: ['dialogue/photos/t1/01.png'] },
      result: { type: 'done' },
    })
    fs.rmSync(path.join(P, 'designs/d1/dialogue'), { recursive: true })
    await turn({ mode: 'ask', anchor: { kind: 'none' }, text: '这个系统分几块？' })
    expect(fs.existsSync(path.join(P, 'designs/d1/dialogue'))).toBe(false)
  })

  it('收尾 S3（DL-51）：提议卡结果补记成转录的一行 { turn, outcome }；设计不存在、结果不合格、轮次不合法都拒', () => {
    const outcome = { kind: 'proposal', applied: true, round: 2, numbers: [3], impact: { modules: 4, scenarios: 1, fresh: false } }
    expect(recordOutcome(modelRoot, 'p', { design: 'd1', turn: 't9', outcome })).toMatchObject({ ok: false, status: 404 })
    write('designs/d1/design.yaml', 'design: { id: d1, name: D1 }\n')
    expect(recordOutcome(modelRoot, 'p', { design: 'd1', turn: 't9', outcome })).toEqual({ ok: true })
    expect(JSON.parse(read('designs/d1/dialogue/transcript.jsonl').trim())).toMatchObject({ turn: 't9', outcome })
    expect(recordOutcome(modelRoot, 'p', { design: 'd1', turn: 't9', outcome: { kind: 'proposal', applied: true } })).toMatchObject({ ok: false, status: 400 })
    expect(recordOutcome(modelRoot, 'p', { design: '../x', turn: 't9', outcome })).toMatchObject({ ok: false, status: 400 })
    expect(recordOutcome(modelRoot, 'p', { design: 'd1', turn: 'a/b', outcome })).toMatchObject({ ok: false, status: 400 })
  })

  it('请求不合法当场拒：重讲不锚在模块上、不是图片、锚点模块不存在', async () => {
    const runner = createAgentRunner({ command: process.execPath, args: [FAKE], protocol: 'thin', input: 'json', timeoutMs: 1000 }, () => {})
    const ctx = { modelRoot, root: tmp, runner }
    expect(await startTurn(ctx, 'p', { session: 's', turn: 't', mode: 'renarrate', anchor: { kind: 'none' }, text: 'x' })).toMatchObject({
      ok: false,
      status: 400,
    })
    expect(
      await startTurn(ctx, 'p', {
        session: 's',
        turn: 't',
        mode: 'ask',
        anchor: { kind: 'none' },
        text: 'x',
        images: [{ name: 'a', type: 'text/plain', dataUrl: 'data:text/plain;base64,eA==' }],
      }),
    ).toMatchObject({
      ok: false,
      status: 400,
    })
    expect(await startTurn(ctx, 'p', { session: 's', turn: 't', mode: 'ask', anchor: { kind: 'module', module: 'ghost' }, text: 'x' })).toMatchObject({
      ok: false,
    })
    expect(runner.running('p')).toEqual([])
  })
})
