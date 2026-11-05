/**
 * 假 agent 的机制图剧本（第二十一轮波 4 T4.0，DL-40、DL-41）：合格的图（草图里引用当前张的框；当前版本上引用锚点模块与它的子模块）
 * 与不合格的图（脚本 + 外链 + 不存在的模块）——协议都收（形状合法），检查分出合格与不合格。
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkDiagram, parseEventLine, type AgentBlock } from '../../src/model'

const ROOT = path.resolve(import.meta.dirname, '../..')
const FAKE = path.join(ROOT, 'scripts/agent/fake-agent.mjs')

function blocks(text: string, pack: Record<string, unknown>): AgentBlock[] {
  const out = execFileSync(process.execPath, [FAKE], { input: JSON.stringify({ ...pack, request: { mode: 'edit', text } }), encoding: 'utf8' })
  const events = out
    .split('\n')
    .filter(Boolean)
    .map(l => parseEventLine(l))
  expect(events.every(e => e?.ok)).toBe(true)
  return events.flatMap(e => (e?.ok && e.value.type === 'block' ? [e.value.block] : []))
}
const diagram = (bs: AgentBlock[]) => bs.find(b => b.kind === 'diagram') as Extract<AgentBlock, { kind: 'diagram' }>

describe('机制图剧本', () => {
  const sketchPack = { anchor: { kind: 'module', module: 'state.desk' }, sketch: { mount: 'state.desk', current: { modules: [{ id: 'state.desk.edit' }, { id: 'state.desk.writer' }] } } }

  it('#diagram：问答卡 + 一张合格的图，引用当前张的两个框', () => {
    const bs = blocks('#diagram 画一张图讲拆分后怎么运作', sketchPack)
    expect(bs.map(b => b.kind)).toEqual(['answer', 'diagram'])
    const sheet = new Set(['state.desk', 'state.desk.edit', 'state.desk.writer'])
    expect(checkDiagram(diagram(bs), id => sheet.has(id))).toEqual({ ok: true, modules: ['state.desk.edit', 'state.desk.writer'] })
  })

  it('#diagram-ask：当前版本上引用锚点模块与它的第一个子模块', () => {
    const bs = blocks('#diagram-ask 画一张图', {
      anchor: { kind: 'module', module: 'p', name: '父' },
      skeleton: [{ id: 'p', children: [{ id: 'p.a', name: '甲' }] }],
    })
    expect(checkDiagram(diagram(bs), id => id === 'p' || id === 'p.a')).toEqual({ ok: true, modules: ['p', 'p.a'] })
  })

  it('#diagram-bad：协议收下，检查拒绝——脚本、外链、不存在的模块三条原因', () => {
    const bs = blocks('#diagram-bad 画一张图', sketchPack)
    const r = checkDiagram(diagram(bs), () => false)
    expect(r.ok).toBe(false)
    const reasons = (r as { reasons: string[] }).reasons.join('\n')
    expect(reasons).toContain('<script>')
    expect(reasons).toContain('https://example.com/x.png')
    expect(reasons).toContain('no.such.module')
  })
})
