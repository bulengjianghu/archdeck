/**
 * 对话会话的转移函数（T1.3，DL-12；DA-1、DA-2、DA-11）：发送、排队、停止、换锚点、换视角各一条规则，外加 agent 事件的落法。
 */
import { describe, expect, it } from 'vitest'
import { anchorOf, dialogueTransition, EMPTY_DIALOGUE, modeFor, type DialogueInput, type DialogueState } from '../../src/state/desk/dialogue'
import type { Anchor } from '../../src/model'

const M: Anchor = { kind: 'module', module: 'state.desk' }
const N: Anchor = { kind: 'module', module: 'model' }
const ask = (text: string): DialogueInput => ({ text, mode: 'ask', images: [] })
const at = (s: Partial<DialogueState> = {}): DialogueState => ({ ...EMPTY_DIALOGUE, anchor: M, ...s })
const go = (s: DialogueState, ...actions: Parameters<typeof dialogueTransition>[1][]) => actions.reduce(dialogueTransition, s)

describe('DL-12 对话会话', () => {
  it('发送：空闲时记下用户条目（带此刻锚点）、进入运行、清草稿；空输入不发', () => {
    const s = go(at({ draft: '为什么？' }), { type: 'send', input: ask('为什么？') })
    expect(s.transcript).toEqual([{ id: 'u1', role: 'user', anchor: M, input: ask('为什么？') }])
    expect(s.run).toEqual({ status: 'running', turn: 's-t1', live: '', mode: 'ask' })
    expect(s.draft).toBe('')
    expect(go(at(), { type: 'send', input: ask('  ') })).toEqual(at())
  })

  it('排队：运行中再发的进队列；这一轮说完按序接着发，回答挂在提问那刻的锚点上', () => {
    let s = go(at(), { type: 'send', input: ask('一') }, { type: 'send', input: ask('二') })
    expect(s.queue).toEqual([ask('二')])
    expect(s.transcript).toHaveLength(1)
    s = go(s, { type: 'setAnchor', anchor: N }, { type: 'event', event: { turn: 's-t1', type: 'text', text: '片段' } })
    expect(s.run).toMatchObject({ live: '片段' })
    s = go(s, { type: 'event', event: { turn: 's-t1', type: 'done', blocks: [] } })
    expect(s.transcript.map(e => e.role)).toEqual(['user', 'agent', 'user'])
    expect(s.transcript[1]).toMatchObject({ anchor: M, text: '片段' })
    expect(s.transcript[2]).toMatchObject({ anchor: N, input: ask('二') })
    expect(s.queue).toEqual([])
    expect(s.run).toMatchObject({ status: 'running' })
  })

  it('停止：这一轮什么都不落（只记一条「已停止」），排队的输入退回草稿不自动发；迟到的事件不认', () => {
    let s = go(
      at({ draft: '' }),
      { type: 'send', input: ask('一') },
      { type: 'send', input: ask('二') },
      { type: 'event', event: { turn: 's-t1', type: 'text', text: '说到一半' } },
    )
    s = go(s, { type: 'stop' })
    expect(s.run).toEqual({ status: 'idle' })
    expect(s.transcript.map(e => e.role)).toEqual(['user', 'stopped'])
    expect(s.transcript[1]).toMatchObject({ reason: 'stopped' })
    expect(s.draft).toBe('二')
    expect(s.queue).toEqual([])
    expect(go(s, { type: 'event', event: { turn: 's-t1', type: 'done', blocks: [] } })).toBe(s)
    // 超时视同停止
    const t = go(at(), { type: 'send', input: ask('一') }, { type: 'event', event: { turn: 's-t1', type: 'stopped', reason: 'timeout' } })
    expect(t.transcript.at(-1)).toMatchObject({ role: 'stopped', reason: 'timeout' })
  })

  it('换锚点：锚点变、转录不变；同一锚点不产生新值', () => {
    const s = go(at(), { type: 'send', input: ask('一') }, { type: 'event', event: { turn: 's-t1', type: 'done', blocks: [] } })
    const moved = go(s, { type: 'setAnchor', anchor: N })
    expect(moved.anchor).toEqual(N)
    expect(moved.transcript).toBe(s.transcript)
    expect(go(moved, { type: 'setAnchor', anchor: { kind: 'module', module: 'model' } })).toBe(moved)
  })

  it('换视角：只换锚点（运行视角下为步骤），转录、运行中的一轮与队列不动', () => {
    const s = go(at(), { type: 'send', input: ask('一') }, { type: 'send', input: ask('二') })
    const step: Anchor = { kind: 'step', scenario: 'sc', frame: 'f1', from: 'a', to: 'b' }
    const r = go(s, { type: 'setPerspective', perspective: 'run', anchor: step })
    expect(r).toMatchObject({ perspective: 'run', anchor: step, run: s.run, queue: s.queue, transcript: s.transcript })
  })

  it('错误：记一条错误卡，会话不受影响、可重发；重讲只对模块，锚点不是模块时按「问」发', () => {
    const s = go(at(), { type: 'send', input: ask('一') }, { type: 'event', event: { turn: 's-t1', type: 'error', message: '崩溃' } })
    expect(s.transcript.at(-1)).toMatchObject({ role: 'error', message: '崩溃' })
    expect(s.run).toEqual({ status: 'idle' })
    expect(modeFor({ kind: 'none' }, 'renarrate')).toBe('ask')
    const r = go(at({ anchor: { kind: 'none' } }), { type: 'send', input: { text: '重讲', mode: 'renarrate', images: [] } })
    expect(r.run).toMatchObject({ mode: 'ask' })
  })

  it('选中 → 锚点：模块、步骤（带两端）、其余为无', () => {
    expect(anchorOf({ kind: 'module', id: 'm' }, null)).toEqual({ kind: 'module', module: 'm' })
    expect(anchorOf({ kind: 'step', id: 'f1' }, { scenario: 'sc', frame: { id: 'f1', from: 'a', to: 'b', label: 'x' } })).toEqual({
      kind: 'step',
      scenario: 'sc',
      frame: 'f1',
      from: 'a',
      to: 'b',
      label: 'x',
    })
    expect(anchorOf({ kind: 'relation', id: 'r' }, null)).toEqual({ kind: 'none' })
    expect(anchorOf(null, null)).toEqual({ kind: 'none' })
  })
})
