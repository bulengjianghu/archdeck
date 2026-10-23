/**
 * 编辑中的草图（desk.edit，X7、X7a、X7g、X7h、X7i、B6，ADR-0024）：编辑会话是一个值、撤销 / 重做、保存冲突与重放、
 * 编辑态下 DeskState 的 index 为编辑中的草图的索引、编辑后的跟随、新建设计的底稿。
 */
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { load, type SketchDef } from '../../src/model'
import { createDeskState, type ModelPayload, type ModelWriter } from '../../src/state/useDeskState'
import { NO_WRITER } from '../../src/state/sync/writer'
import { UNDO_LIMIT, apply, begin, isDirty, redo, reloaded, replay, saved, undo } from '../../src/state/desk/edit/session'

const SYSTEM = { path: 'system.yaml', text: 'system: { id: sys, name: S }' }
const SKELETON = {
  path: 'intent/skeleton.yaml',
  text: `sketch:
  id: skeleton
  mount: root
  lifetime: persistent
  closed: [core]
  modules:
    - { id: core, name: Core, kind: layer, order: 1, responsibility: c, children: [{ id: core.a, name: A, responsibility: a }] }
`,
}
const SKETCH = { path: 'sketches/core.a.yaml', text: 'sketch:\n  id: d\n  mount: core.a\n  modules:\n    - { id: core.a.x, name: X, responsibility: x }\n' }
const def = (): SketchDef => load([SKETCH]).model.sketches[0].def
const ctx = { persistent: load([SKELETON]).model.sketches, designSketch: true }

describe('编辑会话的纯函数（X7g、X7i）', () => {
  const s0 = begin({ kind: 'design', design: 'd' }, 'sketches/core.a.yaml', def(), 'h0')

  it('apply 成功压撤销栈、清空重做栈；拒绝时会话不变；脏由草图推出', () => {
    expect(isDirty(s0)).toBe(false)
    const a = apply(s0, { op: 'addModule', parent: 'core.a', name: 'Y' }, ctx)
    expect(a.result.ok).toBe(true)
    expect([a.session.past.length, isDirty(a.session)]).toEqual([1, true])
    const no = apply(a.session, { op: 'removeModule', id: 'nope' }, ctx)
    expect(no.session).toBe(a.session)
    expect(no.result.ok).toBe(false)
  })

  it('一个操作一步：撤销回到之前的值、影响反向；重做恢复；新操作清空重做栈；撤销回到读取时即不脏', () => {
    const a = apply(s0, { op: 'addModule', parent: 'core.a', name: 'Y' }, ctx).session
    const u = undo(a)!
    expect(u.session.draft).toEqual(s0.draft)
    expect(u.effects.removed).toEqual(['core.a.y'])
    expect(isDirty(u.session)).toBe(false)
    const r = redo(u.session)!
    expect(r.session.draft).toEqual(a.draft)
    expect(apply(u.session, { op: 'addModule', parent: 'core.a', name: 'Z' }, ctx).session.future).toEqual([])
    expect(undo(s0)).toBeNull()
  })

  it('撤销栈深度上限', () => {
    let s = s0
    for (let i = 0; i < UNDO_LIMIT + 5; i++) s = apply(s, { op: 'updateModule', id: 'core.a.x', patch: { responsibility: `r${i}` } }, ctx).session
    expect(s.past).toHaveLength(UNDO_LIMIT)
  })

  it('保存即清空两个栈；重新加载：指纹相同不变，内容与编辑中一致则接上新指纹，否则标为已过时', () => {
    const a = apply(s0, { op: 'addModule', parent: 'core.a', name: 'Y' }, ctx).session
    expect(saved(a, 'h1')).toMatchObject({ base: { hash: 'h1' }, past: [], future: [] })
    expect(reloaded(a, def(), 'h0')).toBe(a)
    expect(reloaded(a, a.draft, 'h1')).toMatchObject({ base: { hash: 'h1' }, stale: false })
    expect(reloaded(a, def(), 'h9').stale).toBe(true)
  })

  it('X7i：把本次的操作重放到新文件上；失败的列出、仍为已过时', () => {
    let a = apply(s0, { op: 'addModule', parent: 'core.a', name: 'Y' }, ctx).session
    a = apply(a, { op: 'updateModule', id: 'core.a.x', patch: { name: 'X2' } }, ctx).session
    const external: SketchDef = { ...def(), modules: [...def().modules!, { id: 'core.a.w', name: 'W' }] }
    const ok = replay(a, external, 'h2', ctx)
    expect(ok.failed).toEqual([])
    expect(ok.session.draft.modules!.map(m => m.id)).toEqual(['core.a.x', 'core.a.w', 'core.a.y'])
    expect(ok.session).toMatchObject({ stale: false, base: { hash: 'h2' } })
    const gone: SketchDef = { id: 'd', mount: 'core.a', modules: [] }
    const bad = replay(a, gone, 'h3', ctx)
    expect(bad.failed).toEqual([{ op: 'updateModule', id: 'core.a.x', patch: { name: 'X2' } }])
    expect(bad.session.stale).toBe(true)
  })
})

function fakeWriter(over: Partial<ModelWriter> = {}) {
  const saves: { sketch: SketchDef; baseHash: string }[] = []
  const created: { id: string; sketch: SketchDef }[] = []
  const writer: ModelWriter = {
    ...NO_WRITER,
    saveSketch: async b => (saves.push(b), { ok: true, file: 'x', hash: 'h1' }),
    createDesign: async b => (created.push(b), { ok: true, file: 'y' }),
    ...over,
  }
  return { writer, saves, created }
}

async function setup(version: { design: string; revision: string } | { intent: string } | undefined, writer: ModelWriter) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push('/')
  let payload: ModelPayload = {
    dir: 'x',
    files: [SYSTEM, SKELETON, SKETCH],
    compare: { current: { label: '当前版本', dir: 'x', files: [SYSTEM, SKELETON] } },
    sketch: { file: 'designs/d/sketches/core.a.yaml', path: 'sketches/core.a.yaml', hash: 'h0' },
    designs: [{ id: 'd', name: 'D', status: 'draft', revisions: [], problems: [] }],
  }
  const desk = createDeskState(async () => payload, { version, writer })
  desk.attachRouter(router)
  await desk.init()
  return { desk, setPayload: (p: Partial<ModelPayload>) => (payload = { ...payload, ...p }) }
}

describe('desk.edit：编辑态与 DeskState', () => {
  it('X7a：只有草图版本能进入编辑态；当前版本与设计轮次上没有编辑态', async () => {
    const { writer } = fakeWriter()
    expect((await setup(undefined, writer)).desk.edit.enterEdit()).toBe(false)
    expect((await setup({ design: 'd', revision: 'r1' }, writer)).desk.edit.enterEdit()).toBe(false)
    const { desk } = await setup({ design: 'd', revision: 'sketch' }, writer)
    expect(desk.edit.editable).toBe(true)
    expect(desk.edit.enterEdit()).toBe(true)
    expect(desk.state.value.editing).toEqual({ kind: 'design', design: 'd' })
  })

  it('编辑态下 index 为编辑中的草图的索引；新建即选中（X7h）；校验与实时核验随之更新（X7f、L-1）', async () => {
    const { writer } = fakeWriter()
    const { desk } = await setup({ design: 'd', revision: 'sketch' }, writer)
    desk.edit.enterEdit()
    expect(desk.edit.check.value?.counts.error).toBe(1) // 当前版本还没有 core.a.x
    expect(desk.edit.edit({ op: 'addModule', parent: 'core.a', name: 'Y' })).toEqual({ ok: true })
    expect(desk.index.value!.modules.has('core.a.y')).toBe(true)
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'core.a.y' })
    expect(desk.edit.dirty.value).toBe(true)
    expect(desk.edit.check.value?.counts.error).toBe(2)
    expect(desk.edit.validation.value?.issues.map(i => i.code)).toEqual(['sketch.empty'])
    expect(desk.edit.changes.value?.counts.added).toBe(1)
    expect(desk.edit.edit({ op: 'removeModule', id: 'zz' })).toMatchObject({ ok: false })
    desk.edit.undo()
    expect(desk.index.value!.modules.has('core.a.y')).toBe(false)
    expect(desk.selection.value).toBeNull()
    desk.edit.redo()
    expect(desk.index.value!.modules.has('core.a.y')).toBe(true)
  })

  it('改 ID 后层次与选中跟随新 ID（X7d、X7h）', async () => {
    const { writer } = fakeWriter()
    const { desk } = await setup({ design: 'd', revision: 'sketch' }, writer)
    desk.edit.enterEdit()
    desk.select({ kind: 'module', id: 'core.a.x' })
    expect(desk.edit.previewMove('core.a.x', 'core.a', 'core.a.ex').renamed).toEqual([['core.a.x', 'core.a.ex']])
    desk.edit.edit({ op: 'renameModule', id: 'core.a.x', newId: 'core.a.ex' })
    expect(desk.selection.value).toEqual({ kind: 'module', id: 'core.a.ex' })
  })

  it('B6：保存带读取时的指纹；成功后停留在编辑态、清空撤销栈；有未保存改动时离开要确认', async () => {
    const { writer, saves } = fakeWriter()
    const { desk } = await setup({ design: 'd', revision: 'sketch' }, writer)
    desk.edit.enterEdit()
    desk.edit.edit({ op: 'addModule', parent: 'core.a', name: 'Y' })
    expect(desk.edit.canLeave()).toBe('confirm')
    expect(desk.edit.exitEdit()).toBe('confirm')
    expect(await desk.edit.save()).toEqual({ ok: true })
    expect(saves[0].baseHash).toBe('h0')
    expect(desk.edit.active.value).toBe(true)
    expect([desk.edit.canUndo.value, desk.edit.dirty.value, desk.edit.canLeave()]).toEqual([false, false, 'free'])
    expect(desk.edit.exitEdit()).toBe('done')
    expect(desk.state.value.editing).toBeNull()
  })

  it('X7i：指纹不符被拒绝即已过时；重新加载并重放；重放失败时可放弃本次改动', async () => {
    const { writer } = fakeWriter({ saveSketch: async () => ({ ok: false, error: '文件已变', conflict: true }) })
    const { desk, setPayload } = await setup({ design: 'd', revision: 'sketch' }, writer)
    desk.edit.enterEdit()
    desk.edit.edit({ op: 'updateModule', id: 'core.a.x', patch: { name: 'X2' } })
    expect(await desk.edit.save()).toMatchObject({ ok: false, conflict: true })
    expect(desk.edit.stale.value).toBe(true)
    setPayload({
      files: [SYSTEM, SKELETON, { path: 'sketches/core.a.yaml', text: 'sketch: { id: d, mount: core.a, modules: [] }\n' }],
      sketch: { file: 'designs/d/sketches/core.a.yaml', path: 'sketches/core.a.yaml', hash: 'h5' },
    })
    expect((await desk.edit.replayOnReload()).failed).toHaveLength(1)
    expect(desk.edit.stale.value).toBe(true)
    await desk.edit.discard()
    expect([desk.edit.stale.value, desk.edit.dirty.value]).toEqual([false, false])
    expect(desk.edit.session.value!.base.hash).toBe('h5')
  })

  it('持久草图版本：编辑目标为该持久草图', async () => {
    const { writer, saves } = fakeWriter()
    const { desk, setPayload } = await setup({ intent: 'skeleton' }, writer)
    setPayload({ files: [SYSTEM, SKELETON], sketch: { file: 'intent/skeleton.yaml', hash: 'k0' } })
    await desk.reload()
    expect(desk.edit.enterEdit()).toBe(true)
    desk.edit.edit({ op: 'addLayer', name: 'Share', at: 1 })
    await desk.edit.save()
    expect(saves[0]).toMatchObject({ target: { kind: 'persistent', id: 'skeleton' }, baseHash: 'k0' })
  })

  it('新建设计：底稿缺省空草图；「改骨架」复制骨架并 supersedes', async () => {
    const { writer, created } = fakeWriter()
    const { desk } = await setup(undefined, writer)
    await desk.edit.createDesign({ id: 'n', name: 'N', base: 'empty' })
    await desk.edit.createDesign({ id: 'm', name: 'M', base: 'copy' })
    expect(created[0].sketch).toEqual({ id: 'n', mount: 'root', lifetime: 'until-implemented', modules: [] })
    expect(created[1].sketch).toMatchObject({ id: 'm', mount: 'root', supersedes: 'skeleton', closed: ['core'] })
  })
})
