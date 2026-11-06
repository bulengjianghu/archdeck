/**
 * DL-34 锁定态下的每种被拒操作（视图状态层）：设计已认可时编辑操作、撤销 / 重做、保存、撤回、对话的「改」一律拒绝并说明「回到起草」；
 * 状态锁先于 AI 回合只读（DL-28）；回到起草后解锁、对话回到「改」。
 */
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { loadModel, seedFromBaseline, sketchText, type DesignStatus } from '../../src/model'
import { createDeskState, type ModelPayload, type ModelWriter } from '../../src/state/useDeskState'
import { NO_WRITER } from '../../src/state/sync/writer'
import { EMPTY_DIALOGUE, dialogueTransition, type AgentTransport } from '../../src/state/desk/dialogue'
import { AI_BUSY } from '../../src/state/desk/edit/commands'

const SYSTEM = { path: 'system.yaml', text: 'system: { id: sys, name: S }' }
const BASE = {
  path: 'modules.yaml',
  text: `modules:
  - id: core
    name: Core
    kind: layer
    order: 1
    children:
      - id: core.a
        name: A
        children:
          - { id: core.a.x, name: X }
          - { id: core.a.y, name: Y }
relations:
  - { id: r.xy, from: core.a.x, to: core.a.y, type: commands }
`,
}
const baseline = loadModel([SYSTEM, BASE]).index
const SKETCH = { path: 'sketches/core.a.yaml', text: sketchText(seedFromBaseline('core.a', baseline, { id: 'd' })) }
const SKELETON = {
  path: 'intent/skeleton.yaml',
  text: 'sketch:\n  id: skeleton\n  mount: root\n  lifetime: persistent\n  modules:\n    - { id: core, name: Core, kind: layer, order: 1, children: [{ id: core.a, name: A }] }\n',
}

function writer(): { writer: ModelWriter; saves: number } {
  const box = { saves: 0 }
  const w: ModelWriter = {
    ...NO_WRITER,
    saveDesignSketches: async b => (
      box.saves++,
      { ok: true, files: b.sketches.map(x => ({ mount: x.mount, file: `designs/d/sketches/${x.mount}.yaml`, hash: 'n' })), removed: [], dropped: [] }
    ),
  }
  return {
    writer: w,
    get saves() {
      return box.saves
    },
  }
}

function transport(): AgentTransport & { sent: { mode: string }[] } {
  const sent: { mode: string }[] = []
  return { sent, turn: async (_p, b) => (sent.push({ mode: b.mode }), { ok: true }), stop: async () => {}, subscribe: () => () => {} }
}

const payloadOf = (status: DesignStatus): ModelPayload => ({
  dir: 'x',
  files: [SYSTEM, SKELETON, SKETCH],
  compare: { current: { label: '当前版本', dir: 'x', files: [SYSTEM, BASE] } },
  sketch: { file: 'designs/d/sketches/core.a.yaml', path: 'sketches/core.a.yaml', hash: 'h0' },
  sketchFiles: [{ mount: 'core.a', file: 'designs/d/sketches/core.a.yaml', path: 'sketches/core.a.yaml', hash: 'h0' }],
  sketchPrompt: 'PROMPT',
  designs: [{ id: 'd', name: 'D', status, revisions: [], problems: [] }],
})

async function setup(status: DesignStatus, agent = transport()) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push('/')
  let payload: ModelPayload = {
    dir: 'x',
    files: [SYSTEM, SKELETON, SKETCH],
    compare: { current: { label: '当前版本', dir: 'x', files: [SYSTEM, BASE] } },
    sketch: { file: 'designs/d/sketches/core.a.yaml', path: 'sketches/core.a.yaml', hash: 'h0' },
    sketchFiles: [{ mount: 'core.a', file: 'designs/d/sketches/core.a.yaml', path: 'sketches/core.a.yaml', hash: 'h0' }],
    sketchPrompt: 'PROMPT',
    designs: [{ id: 'd', name: 'D', status, revisions: [], problems: [] }],
  }
  const w = writer()
  const desk = createDeskState(async () => payload, { version: { design: 'd', revision: 'sketch' }, writer: w.writer, project: 'p', agent })
  desk.attachRouter(router)
  await desk.init()
  const setStatus = async (s: DesignStatus) => {
    payload = { ...payload, designs: [{ id: 'd', name: 'D', status: s, revisions: [], problems: [] }] }
    await desk.reload()
  }
  return { desk, w, agent, setStatus }
}

const add = { op: 'addModule' as const, parent: 'core.a', name: 'W', id: 'w' }

describe('DL-34 已认可：编辑分组拒绝一切改动，原因「回到起草」', () => {
  it('编辑操作（新建、拖动摆位）被拒，会话不变', async () => {
    const { desk } = await setup('accepted')
    expect(desk.edit.statusLock.value).toContain('回到起草')
    expect(desk.edit.locked.value).toBe(true)
    const r = desk.edit.edit(add)
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('回到起草') })
    expect(desk.edit.moveNode({ 'core.a.x': { x: 5, y: 5 } })).toMatchObject({ ok: false })
    expect(desk.edit.dirty.value).toBe(false)
  })

  it('撤销 / 重做被拒：起草时做的一步，认可后撤不回', async () => {
    const { desk, setStatus } = await setup('draft')
    expect(desk.edit.edit(add)).toMatchObject({ ok: true })
    expect(desk.edit.canUndo.value).toBe(true)
    await setStatus('accepted')
    expect(desk.edit.undo()).toBe(false)
    expect(desk.edit.redo()).toBe(false)
  })

  it('保存被拒，不发写请求', async () => {
    const { desk, w, setStatus } = await setup('draft')
    desk.edit.edit(add)
    await setStatus('accepted')
    const r = await desk.edit.save()
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('回到起草') })
    expect(w.saves).toBe(0)
  })

  it('撤回一项、撤回一轮被拒', async () => {
    const { desk } = await setup('accepted')
    expect(desk.edit.changes.withdrawItem(1)).toMatchObject({ ok: false, reason: expect.stringContaining('回到起草') })
    expect(desk.edit.changes.withdrawRound(1)).toMatchObject({ ok: false, reason: expect.stringContaining('回到起草') })
  })

  it('对话的「改」被拒：缺省并固定「问」，切「改」无效，发出去的按「问」', async () => {
    const { desk, agent } = await setup('accepted')
    const d = desk.dialogue
    expect(d.state.value.lock).toContain('回到起草')
    expect(d.state.value.mode).toBe('ask')
    d.dispatch({ type: 'setMode', mode: 'edit' })
    expect(d.state.value.mode).toBe('ask')
    d.send({ text: '把 X 与 Y 合并', mode: 'edit', images: [] })
    await Promise.resolve()
    expect(agent.sent.map(x => x.mode)).toEqual(['ask'])
  })

  it('已实现 / 已放弃同样锁定，原因「只看」', async () => {
    for (const s of ['implemented', 'abandoned'] as DesignStatus[]) {
      const { desk } = await setup(s)
      expect(desk.edit.edit(add)).toMatchObject({ ok: false, reason: expect.stringContaining('只看') })
    }
  })

  it('回到起草后解锁：可改，对话回到「改」', async () => {
    const { desk, setStatus } = await setup('accepted')
    await setStatus('draft')
    expect(desk.edit.locked.value).toBe(false)
    expect(desk.edit.edit(add)).toMatchObject({ ok: true })
    expect(desk.dialogue.state.value.mode).toBe('edit')
  })
})

describe('DL-34 对话会话的锁（纯转移）', () => {
  const sketch = { ...EMPTY_DIALOGUE, perspective: 'sketch' as const, mode: 'edit' as const }
  it('锁上时「改」退回「问」；进入草图时缺省「问」；解锁回到「改」', () => {
    const locked = dialogueTransition(sketch, { type: 'setLock', lock: '已认可' })
    expect([locked.mode, locked.lock]).toEqual(['ask', '已认可'])
    const outside = dialogueTransition({ ...EMPTY_DIALOGUE, lock: '已认可' }, { type: 'setPerspective', perspective: 'sketch', anchor: { kind: 'none' } })
    expect(outside.mode).toBe('ask')
    const open = dialogueTransition(locked, { type: 'setLock', lock: null })
    expect([open.mode, open.lock]).toEqual(['edit', undefined])
  })
  it('状态锁先于 AI 回合只读：起草中 AI 回合的原因仍是 AI_BUSY', () => {
    expect(AI_BUSY).toContain('AI 正在修改')
  })
})

describe('重新加载按发起先后（第二十一轮收尾复跑）', () => {
  it('先发起、后返回的旧载荷不盖住新的：认可后迟到的「起草中」不回滚状态', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
    await router.push('/')
    const queue: ((p: ModelPayload) => void)[] = []
    const desk = createDeskState(() => new Promise<ModelPayload>(r => queue.push(r)), {
      version: { design: 'd', revision: 'sketch' },
      writer: writer().writer,
      project: 'p',
    })
    desk.attachRouter(router)
    const init = desk.init()
    queue.shift()!(payloadOf('draft'))
    await init
    expect(desk.edit.statusLock.value).toBeFalsy()
    const stale = desk.reload() // 文件变化触发、认可写入之前发起
    const fresh = desk.reload() // 认可写入之后发起
    queue[1](payloadOf('accepted'))
    await fresh
    expect(desk.edit.statusLock.value).toContain('回到起草')
    queue[0](payloadOf('draft'))
    await stale
    expect(desk.edit.statusLock.value).toContain('回到起草')
  })
  it('首次加载途中又发起一次（文件变化）：首次加载等到最后那次落地再按 URL 初始化，不因被取代而跳过', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
    await router.push('/')
    const queue: ((p: ModelPayload) => void)[] = []
    const desk = createDeskState(() => new Promise<ModelPayload>(r => queue.push(r)), {
      version: { design: 'd', revision: 'sketch' },
      writer: writer().writer,
      project: 'p',
    })
    desk.attachRouter(router)
    let done = false
    const init = desk.init().then(() => (done = true))
    const later = desk.reload()
    queue[0](payloadOf('draft'))
    await Promise.resolve()
    await Promise.resolve()
    expect(done).toBe(false)
    queue[1](payloadOf('accepted'))
    await Promise.all([init, later])
    expect(desk.index.value).not.toBeNull()
    expect(desk.edit.statusLock.value).toContain('回到起草')
    expect(desk.edit.editable).toBe(true)
    expect(desk.edit.session.value).not.toBeNull()
  })
})
