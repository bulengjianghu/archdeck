/**
 * 对话的模型层（第二十一轮波 1）：薄协议（DL-11）、上下文包三种锚点的快照（DL-14）、引用解析（DL-13）、梳理卡（DL-15）、重讲的三问判别与讲法要求（DL-8）。
 */
import { describe, expect, it } from 'vitest'
import {
  buildContextPack,
  digestView,
  formatNotes,
  judgeRenarrate,
  loadModel,
  mergeNotes,
  packPrompt,
  parseBlock,
  parseEventLine,
  parseNotes,
  resolveCitation,
  THREE_QUESTIONS,
  type RawFile,
  type RenarrateBlock,
} from '../../src/model'

const YAML = `
system: { id: s, name: 系统, description: 一个用来测试对话的系统 }
modules:
  - id: p
    name: 父模块
    summary: 给宿主一次可靠的会话
    responsibility: 父模块的职责。
    principle: 命令走单通道
    invariants: [命令单通道串行施用]
    children:
      - { id: p.a, name: 甲, summary: 按序施用全部命令, invariants: [甲只读不写会话状态] }
      - { id: p.b, name: 乙, summary: 决定会话变成什么 }
  - { id: q, name: 别处, summary: 提供别处的能力 }
interfaces:
  - { id: if1, name: 施用口, owner: p.a, signature: apply(cmd) }
relations:
  - { id: r1, from: p.a, to: p.b, type: commands, description: 交给决定 }
  - { id: r2, from: p.b, to: q, type: queries }
`
const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body><h1>父模块</h1>${body}</body></html>`
const P_HTML = page('<p><span data-arch="p" data-field="summary"></span>，然后 <span data-arch="p.a">甲</span>。</p>')
const files = (extra: Record<string, string> = { 'explainers/p.html': P_HTML }): RawFile[] => [
  { path: 'modules/m.yaml', text: YAML },
  ...Object.entries(extra).map(([path, text]) => ({ path, text })),
]
const { index } = loadModel(files())

describe('DL-11 薄协议', () => {
  it('三种事件；空行跳过；不是 JSON、不认识的类型、块不合法都给出原因', () => {
    expect(parseEventLine('  ')).toBeNull()
    expect(parseEventLine('{"type":"done"}')).toEqual({ ok: true, value: { type: 'done' } })
    expect(parseEventLine('{"type":"text","text":"x"}')).toEqual({ ok: true, value: { type: 'text', text: 'x' } })
    expect(parseEventLine('hello')).toMatchObject({ ok: false })
    expect(parseEventLine('{"type":"tool"}')).toMatchObject({ ok: false, error: expect.stringContaining('tool') })
    expect(parseEventLine('{"type":"block","block":{"kind":"answer","parts":[]}}')).toMatchObject({ ok: false })
  })

  it('问答卡的引用只认 {module, field}，field 取固定几种；梳理卡只有四组', () => {
    expect(parseBlock({ kind: 'answer', parts: [{ text: 'a', cites: [{ module: 'p', field: 'summary' }], inferred: true }] })).toMatchObject({ ok: true })
    expect(parseBlock({ kind: 'answer', parts: [{ text: 'a', cites: [{ module: 'p', field: 'code' }] }] })).toMatchObject({ ok: false })
    expect(parseBlock({ kind: 'digest', groups: { matched: [{ label: 'x' }] } })).toMatchObject({ ok: true })
    expect(parseBlock({ kind: 'digest', groups: { matched: [], weird: [] } })).toMatchObject({ ok: false, error: expect.stringContaining('weird') })
  })
})

describe('DL-14 上下文包（三种锚点）', () => {
  const facts = { ca: 2, ce: 1, instability: 0.33, impactIn: 3, cycles: 0 }

  it('模块锚点：骨架字段（职责、一句话、原则、不变式、子模块、关系、接口）、它的题解、代码事实摘要、可用查询', () => {
    const pack = buildContextPack(index, { project: 's', anchor: { kind: 'module', module: 'p' }, mode: 'ask', text: '为什么这样分？', facts })
    expect(pack).toMatchSnapshot()
    expect(pack.explainer?.path).toBe('explainers/p.html')
  })

  it('步骤锚点：两端模块的骨架，锚点带两端与场景名；没有题解', () => {
    const pack = buildContextPack(index, {
      project: 's',
      anchor: { kind: 'step', scenario: 'sc', frame: 'f1', from: 'p.a', to: 'p.b', label: '施用' },
      mode: 'ask',
      text: '这一步谁负责？',
    })
    expect(pack).toMatchSnapshot()
    expect(pack.skeleton.map(m => m.id)).toEqual(['p.a', 'p.b'])
  })

  it('无选中：系统根与第二级的概览', () => {
    const pack = buildContextPack(index, { project: 's', anchor: { kind: 'none' }, mode: 'ask', text: '这个系统分几块？' })
    expect(pack).toMatchSnapshot()
    expect(pack.skeleton[0].children?.map(c => c.id)).toEqual(['p', 'q'])
  })

  it('重讲带讲法要求与重讲的输出约定；问不带讲法要求；提示文本附整个包', () => {
    const r = buildContextPack(index, { project: 's', anchor: { kind: 'module', module: 'p' }, mode: 'renarrate', text: '方向反了', notes: ['先讲结论'] })
    expect(r.notes).toEqual(['先讲结论'])
    expect(r.output.join('\n')).toContain('"kind":"renarrate"')
    expect(buildContextPack(index, { project: 's', anchor: { kind: 'module', module: 'p' }, mode: 'ask', text: '?', notes: ['x'] }).notes).toEqual([])
    expect(packPrompt(r)).toContain('"protocol": "arch-agent/1"')
  })
})

describe('DL-13 引用解析', () => {
  it('成功：原文由架构台从描述填（一句话、职责、不变式、接口、关系、题解）', () => {
    expect(resolveCitation(index, { module: 'p', field: 'summary' })).toEqual({ ok: true, module: 'p', name: '父模块', field: 'summary', text: '给宿主一次可靠的会话' })
    expect(resolveCitation(index, { module: 'p.a', field: 'interfaces' })).toMatchObject({ ok: true, text: '施用口：apply(cmd)' })
    expect(resolveCitation(index, { module: 'p.b', field: 'relations' })).toMatchObject({ ok: true, text: '乙 → 别处（queries）；甲 → 乙（commands）：交给决定' })
    expect(resolveCitation(index, { module: 'p', field: 'explainer' })).toMatchObject({ ok: true })
  })

  it('失败：模块不存在、字段在描述里是空的、没有题解——不替 AI 补', () => {
    expect(resolveCitation(index, { module: 'nope', field: 'summary' })).toMatchObject({ ok: false, reason: expect.stringContaining('不存在') })
    expect(resolveCitation(index, { module: 'q', field: 'responsibility' })).toMatchObject({ ok: false, reason: expect.stringContaining('空的') })
    expect(resolveCitation(index, { module: 'q', field: 'explainer' })).toMatchObject({ ok: false })
  })
})

describe('DL-15 梳理卡', () => {
  it('四组按固定次序与标题；模块名从描述取，描述里没有的标出；不确定计数', () => {
    const v = digestView(index, {
      kind: 'digest',
      groups: {
        matched: [{ label: '父', modules: ['p'] }],
        mismatched: [{ label: '甲乙', modules: ['p.a', 'p.b'], note: '一个框两个模块' }],
        extra: [{ label: '缓存', modules: ['cache'], uncertain: true }],
        missing: [{ label: '别处', modules: ['q'] }],
      },
    })
    expect(v.groups.map(g => g.title)).toEqual(['对上', '对不上', '多', '少'])
    expect(v.groups[1].items[0].modules.map(m => m.name)).toEqual(['甲', '乙'])
    expect(v.groups[2].items[0]).toMatchObject({ uncertain: true, modules: [{ id: 'cache', known: false }] })
    expect(v).toMatchObject({ total: 4, uncertain: 1 })
  })
})

describe('DL-8 重讲', () => {
  const block = (extra: Record<string, unknown> = {}, html = P_HTML.replace('</h1>', '</h1><p>新讲法</p>')): RenarrateBlock =>
    ({ kind: 'renarrate', module: 'p', notes: ['箭头从调用方指向被调方'], html, ...extra }) as RenarrateBlock

  it('三问判别表：题解与讲法要求三否；职责、一句话、不变式、关系、接口至少一问为是', () => {
    for (const k of ['html', 'notes']) expect(Object.values(THREE_QUESTIONS[k]).some(Boolean)).toBe(false)
    for (const k of ['summary', 'responsibility', 'invariants', 'relations', 'interfaces']) expect(Object.values(THREE_QUESTIONS[k]).some(Boolean)).toBe(true)
  })

  it('只动讲法：放行，路径为模块的题解', () => {
    const candidate = loadModel(files({ 'explainers/p.html': block().html })).index
    expect(judgeRenarrate(index, block(), candidate)).toEqual({ ok: true, path: 'explainers/p.html' })
  })

  it('含事实字段改动整轮拒绝：说出进了哪一问；表外的键按事实对待', () => {
    const v = judgeRenarrate(index, block({ summary: '改短的职责' }))
    expect(v).toMatchObject({ ok: false, reasons: [expect.stringContaining('进确认层指纹')] })
    expect(judgeRenarrate(index, block({ foo: 1 }))).toMatchObject({ ok: false, reasons: [expect.stringContaining('按事实对待')] })
  })

  it('新题解过同一套检查：抄写一句话原文、引用不存在的模块被拒', () => {
    const copied = block({}, P_HTML.replace('</h1>', '</h1><p>给宿主一次可靠的会话</p>'))
    expect(judgeRenarrate(index, copied, loadModel(files({ 'explainers/p.html': copied.html })).index)).toMatchObject({ ok: false })
    const bad = block({}, P_HTML.replace('</h1>', '</h1><span data-arch="ghost">鬼</span>'))
    expect(judgeRenarrate(index, bad, loadModel(files({ 'explainers/p.html': bad.html })).index)).toMatchObject({ ok: false })
  })

  it('讲法要求累积：已有的在前、新的追加、重复不记；文件一条一行，读回相同', () => {
    const first = mergeNotes([], ['先讲结论'])
    const second = mergeNotes(first, ['箭头从调用方指向被调方', '先讲结论'])
    expect(second).toEqual(['先讲结论', '箭头从调用方指向被调方'])
    expect(parseNotes(formatNotes('p', second))).toEqual(second)
  })
})
