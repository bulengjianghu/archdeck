/**
 * 停止后再发（DA-5 停止，合并复跑定位的竞态）：停止请求在途时，下一轮等它落地再发——
 * 两次 POST 到达开发服务器的先后不保证，先到的新一轮会被「这个对话已有一轮在进行」拒掉。
 */
import { shallowRef } from 'vue'
import { describe, expect, it } from 'vitest'
import { loadModel } from '../../src/model'
import { createDialogue, type AgentTransport } from '../../src/state/desk/dialogue'

const { index } = loadModel([{ path: 'modules/m.yaml', text: 'system: { id: s, name: S }\nmodules:\n  - { id: p, name: P }\n' }])

describe('停止与下一轮的先后', () => {
  it('停止请求未落地时，下一轮的请求等它；落地后才发出', async () => {
    const calls: string[] = []
    let release: () => void = () => {}
    const transport: AgentTransport = {
      turn: async (_p, b) => (calls.push(`turn:${b.text}`), { ok: true }),
      stop: () => (calls.push('stop'), new Promise<void>(r => (release = () => (calls.push('stop-done'), r())))),
      subscribe: () => () => {},
    }
    const d = createDialogue({
      project: 'p',
      index: shallowRef(index),
      selection: shallowRef(null),
      step: shallowRef(null),
      perspective: shallowRef('structure'),
      transport,
      openTab: () => {},
    })
    d.send({ text: '一', mode: 'ask', images: [] })
    await Promise.resolve()
    d.dispatch({ type: 'stop' })
    d.send({ text: '二', mode: 'ask', images: [] })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(calls).toEqual(['turn:一', 'stop'])
    release()
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(calls).toEqual(['turn:一', 'stop', 'stop-done', 'turn:二'])
    expect(d.state.value.run).toMatchObject({ status: 'running' })
  })

  it('停止请求失败也不卡住下一轮', async () => {
    const calls: string[] = []
    const transport: AgentTransport = {
      turn: async (_p, b) => (calls.push(`turn:${b.text}`), { ok: true }),
      stop: async () => {
        throw new Error('断网')
      },
      subscribe: () => () => {},
    }
    const d = createDialogue({
      project: 'p',
      index: shallowRef(index),
      selection: shallowRef(null),
      step: shallowRef(null),
      perspective: shallowRef('structure'),
      transport,
      openTab: () => {},
    })
    d.send({ text: '一', mode: 'ask', images: [] })
    d.dispatch({ type: 'stop' })
    d.send({ text: '二', mode: 'ask', images: [] })
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(calls).toEqual(['turn:一', 'turn:二'])
  })
})
