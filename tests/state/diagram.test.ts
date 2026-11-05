/**
 * 对话里的机制图（第二十一轮波 4 T4.0）在会话里的一面：回答到达那一刻检查（DL-41，当前版本查描述、草图里查当前张），
 * 结果随条目留下；显示数据与引用（DL-42）；存为设计说明的围栏块经接入层写盘再读回，往返不变（DL-43）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { shallowRef } from 'vue'
import { describe, expect, it } from 'vitest'
import { loadModel, type AgentBlock } from '../../src/model'
import { createDialogue, dialogueTransition, EMPTY_DIALOGUE, type AgentPush, type AgentTransport, type DialogueSketchPort } from '../../src/state/desk/dialogue'
import { saveNote } from '../../vite/designNotes'

const YAML = `
system: { id: s, name: 系统, description: 测机制图 }
modules:
  - id: p
    name: 父模块
    summary: 给宿主一次可靠的会话
    children:
      - { id: p.a, name: 甲 }
`
const { index } = loadModel([{ path: 'modules/m.yaml', text: YAML }])
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">${body}</svg>`
const ANSWER: AgentBlock = { kind: 'answer', parts: [{ text: '拆分后这样运作' }] }
const good = (ids: string[]): AgentBlock => ({
  kind: 'diagram',
  svg: svg(ids.map(id => `<g data-arch="${id}"><text data-arch="${id}" data-field="summary">x</text></g>`).join('')),
  caption: '一张图',
})
const BAD: AgentBlock = { kind: 'diagram', svg: svg('<script>x()</script><g data-arch="ghost"/>'), caption: '坏图' }

function harness(sketch?: DialogueSketchPort) {
  let push: (e: AgentPush) => void = () => {}
  const transport: AgentTransport = { turn: async () => ({ ok: true }), stop: async () => {}, subscribe: (_p, cb) => ((push = cb), () => {}) }
  const d = createDialogue({
    project: 'p',
    index: shallowRef(index),
    selection: shallowRef(null),
    step: shallowRef(null),
    perspective: shallowRef(sketch ? 'sketch' : 'structure'),
    transport,
    openTab: () => {},
    ...(sketch ? { sketch } : {}),
  })
  const answer = (blocks: AgentBlock[]) => {
    d.send({ text: '画一张图', mode: sketch ? 'edit' : 'ask', images: [] })
    push({ turn: (d.state.value.run as { turn: string }).turn, type: 'done', blocks })
    return d.state.value.transcript.at(-1)!
  }
  return { d, answer }
}

const sketchPort = (sheet: Set<string>): DialogueSketchPort => ({
  active: () => true,
  design: () => 'd1',
  mount: () => 'p',
  context: () => null,
  apply: () => undefined,
  nameOf: id => ({ 'p.session': '会话' })[id],
  sheetHas: id => sheet.has(id),
})

describe('DL-41 回答到达那一刻检查机制图块', () => {
  it('当前版本上按描述查：合格的给图与引用（描述原文按 EX-2 填，不附「图解 ›」），不合格的只拒那一块、问答卡照常', () => {
    const { d, answer } = harness()
    const e = answer([ANSWER, good(['p', 'p.a']), BAD])
    expect(e).toMatchObject({ role: 'agent', diagrams: { 1: { ok: true, modules: ['p', 'p.a'] }, 2: { ok: false } } })
    expect(e.role === 'agent' && e.blocks[0]).toEqual(ANSWER)
    const v = d.diagram(e, 1)!
    expect(v).toMatchObject({ ok: true, caption: '一张图', aspect: 0.5 })
    expect(v.ok && v.refs.p).toEqual({ name: '父模块', summary: { text: '给宿主一次可靠的会话', pending: false }, invariants: [], explainer: false })
    const bad = d.diagram(e, 2)!
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.reasons.join()).toContain('<script>')
    expect(!bad.ok && bad.reasons.join()).toContain('ghost')
    // 只有合格的图进设计说明
    expect(d.diagramFences(e)).toHaveLength(1)
    expect(d.diagram(e, 0)).toBeNull()
  })

  it('草图里按当前张查：描述里有、当前张上没有的不算；草图才有的框给名称；之后当前张再改不重判', () => {
    const sheet = new Set(['p', 'p.session'])
    const { d, answer } = harness(sketchPort(sheet))
    const e = answer([ANSWER, good(['p.session']), good(['p.a'])])
    expect(e).toMatchObject({ diagrams: { 1: { ok: true }, 2: { ok: false, reasons: ['data-arch 指向的模块不存在：p.a'] } } })
    const v = d.diagram(e, 1)!
    expect(v.ok && v.refs['p.session']).toEqual({ name: '会话', summary: null, invariants: [], explainer: false })
    // 框后来被删掉：检查结果不变（仍显示），引用不再给（显示时删除线，EX-2）
    sheet.delete('p.session')
    expect(d.diagram(e, 1)).toMatchObject({ ok: true, refs: {} })
  })

  it('转移函数把检查结果原样落进条目；没有图块的回答不带 diagrams', () => {
    const s = dialogueTransition(
      dialogueTransition({ ...EMPTY_DIALOGUE, anchor: { kind: 'none' } }, { type: 'send', input: { text: 'x', mode: 'ask', images: [] } }),
      {
        type: 'event',
        event: { turn: 's-t1', type: 'done', blocks: [ANSWER] },
      },
    )
    expect(s.transcript.at(-1)).not.toHaveProperty('diagrams')
  })
})

describe('DL-43 存为设计说明：图随文字写盘，读回切成文字段与图段', () => {
  it('saveNote 写下正文与围栏块；NoteDoc 读回得到同一张图（只过形状与安全检查）', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-note-'))
    try {
      fs.mkdirSync(path.join(root, 'proj', 'designs', 'd1'), { recursive: true })
      fs.writeFileSync(path.join(root, 'proj', 'designs', 'd1', 'design.yaml'), 'id: d1\n')
      fs.writeFileSync(path.join(root, 'proj', 'system.yaml'), 'id: proj\n')
      const { d, answer } = harness()
      const e = answer([ANSWER, good(['p.a'])])
      const text = ['拆分后这样运作', ...d.diagramFences(e)].join('\n\n')
      const r = saveNote(root, 'proj', 'd1', { title: '画一张图', text, module: 'p' })
      const saved = fs.readFileSync(path.join(root, 'proj', 'designs', 'd1', r.file), 'utf8')
      const body = saved
        .replace(/^#\s+.*\n/, '')
        .replace(/^\s*>\s*.*\n/, '')
        .trim()
      const segs = d.noteSegments(body)
      expect(segs.map(x => x.kind)).toEqual(['text', 'diagram'])
      const g = good(['p.a']) as Extract<AgentBlock, { kind: 'diagram' }>
      expect(segs[1]).toMatchObject({ kind: 'diagram', ok: true, svg: g.svg, caption: '一张图' })
      // 被人改坏的图段：只出原因
      expect(d.noteSegments('```arch-diagram 坏\n<svg viewBox="0 0 10 10"><script/></svg>\n```')[0]).toMatchObject({ kind: 'diagram', ok: false })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
