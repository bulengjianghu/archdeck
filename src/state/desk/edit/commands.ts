/**
 * 编辑操作（if.desk.edit，ADR-0024）：对呈现层的唯一一组编辑操作。操作本身不含规则——
 * 编辑规则在模型层（applyEdit），会话规则在视图状态转移（enterEdit / exitEdit / edited），撤销栈在编辑会话（session.ts）。
 */
import type { ShallowRef } from 'vue'
import {
  idImpact,
  load,
  seedSketch,
  sketchLifetime,
  type EditEffects,
  type EditOp,
  type IdImpact,
  type ModelIndex,
  type RawFile,
  type SketchTarget,
} from '@/model'
import type { WriteOutcome } from '../../sync/writer'
import { leaveGuard, type ViewAction } from '../../transition'
import type { createSaveSync, SaveOutcome } from './save'
import { apply, begin, discard as discardSession, isDirty, redo as redoSession, reloaded, replay, undo as undoSession, type EditSession } from './session'
import { draftIndex, editContext } from './derive'

export interface CommandInputs {
  session: ShallowRef<EditSession | null>
  loaded: ShallowRef<ModelIndex | null>
  files: ShallowRef<RawFile[]>
  /** 载荷里的草图文件与读取时的指纹（草图版本才有） */
  sketch: ShallowRef<{ file: string; hash: string } | undefined>
  /** 编辑目标；不是草图版本时为 undefined */
  target?: SketchTarget
  /** 草图在载荷里的路径（设计的草图为 sketch.yaml） */
  file?: string
  current: () => ModelIndex | null
  /** 当前层次的路径（跟随用） */
  levelPath: () => readonly string[]
  dispatch: (action: ViewAction) => boolean
  /** 把要显示的索引交给 DeskState（编辑态为草图的索引，否则为读到的） */
  show: (index: ModelIndex | null) => void
  reload: () => Promise<void>
  sync: ReturnType<typeof createSaveSync>
}

export type EditOutcome = { ok: true } | { ok: false; reason: string }

export function createCommands(i: CommandInputs) {
  const { session, loaded, files, target, file } = i
  const ctx = () => editContext(loaded.value!, session.value!.file, target?.kind === 'design')
  /** 载荷里读到的那份草图 */
  const loadedSketch = () => (file ? load(files.value.filter(f => f.path === file)).model.sketches[0]?.def : undefined)
  const showDraft = () => i.show(session.value ? draftIndex(files.value, session.value.file, session.value.draft) : loaded.value)
  const follow = (effects: EditEffects, previousPath: readonly string[]) => i.dispatch({ type: 'edited', effects, previousPath })

  function enterEdit(): boolean {
    const def = loadedSketch()
    if (!target || !file || !def || !loaded.value || !i.sketch.value) return false
    session.value = session.value ?? begin(target, file, def, i.sketch.value.hash)
    if (!i.dispatch({ type: 'enterEdit', target })) return false
    showDraft()
    return true
  }

  /** 有未保存改动时返回 'confirm'，由呈现层确认后 force 退出（X7a） */
  function exitEdit(force = false): 'confirm' | 'done' {
    if (!force && canLeave() === 'confirm') return 'confirm'
    session.value = null
    i.dispatch({ type: 'exitEdit' })
    i.show(loaded.value)
    return 'done'
  }

  function edit(op: EditOp): EditOutcome {
    const s = session.value
    if (!s || !loaded.value) return { ok: false, reason: '不在编辑态' }
    const previousPath = i.levelPath()
    const r = apply(s, op, ctx())
    if (!r.result.ok) return { ok: false, reason: r.result.reason }
    session.value = r.session
    showDraft()
    follow(r.result.effects, previousPath)
    return { ok: true }
  }

  const step = (fn: typeof undoSession) => () => {
    const s = session.value
    const r = s && fn(s)
    if (!r) return false
    const previousPath = i.levelPath()
    session.value = r.session
    showDraft()
    follow(r.effects, previousPath)
    return true
  }

  /** X7d：移动前的影响 */
  const previewMove = (id: string, parent: string, newId?: string): IdImpact =>
    session.value && loaded.value
      ? idImpact(session.value.draft, ctx(), id, parent, newId, i.current())
      : { renamed: [], references: 0, outside: { modules: 0, relations: 0, interfaces: 0, messages: 0 }, rejected: '不在编辑态' }

  /** X7e：删除前的级联范围（不改会话）；拒绝时为原因 */
  function previewRemove(id: string): { removed: string[] } | { rejected: string } {
    const s = session.value
    if (!s || !loaded.value) return { rejected: '不在编辑态' }
    const r = apply(s, { op: 'removeModule', id }, ctx()).result
    return r.ok ? { removed: r.effects.removed } : { rejected: r.reason }
  }

  const save = (): Promise<SaveOutcome> => i.sync.save()

  /** 放弃本次改动；已过时时先重新加载，以新文件重新开始（X7i 的兜底） */
  async function discard(): Promise<void> {
    const s = session.value
    if (!s) return
    if (s.stale) await i.reload()
    const def = loadedSketch()
    session.value = def && i.sketch.value ? discardSession(session.value!, def, i.sketch.value.hash) : discardSession(session.value!)
    i.sync.serverIssues.value = []
    showDraft()
    follow({ created: [], renamed: [], removed: [] }, i.levelPath())
  }

  /** X7i：重新加载并把本次的操作按序重放到新文件上，返回失败的操作 */
  async function replayOnReload(): Promise<{ failed: EditOp[] }> {
    if (!session.value) return { failed: [] }
    const ops = session.value
    await i.reload()
    const def = loadedSketch()
    if (!def || !i.sketch.value) return { failed: ops.past.map(p => p.op) }
    const r = replay(ops, def, i.sketch.value.hash, ctx())
    session.value = r.session
    showDraft()
    follow({ created: [], renamed: [], removed: [] }, i.levelPath())
    return { failed: r.failed }
  }

  /** S-4、L-3：新建设计——底稿缺省空草图；copy 为「改骨架（定稿后晋升替换骨架）」 */
  function createDesign(input: { id: string; name: string; goal?: string; base: 'empty' | 'copy' }): Promise<WriteOutcome> {
    const skeleton = loaded.value?.model.sketches.find(s => s.def.id === 'skeleton' && sketchLifetime(s) === 'persistent')
    const sketch = seedSketch(input.id, input.base === 'copy' && skeleton ? { persistent: skeleton } : 'empty')
    return i.sync.createDesign({ id: input.id, name: input.name, ...(input.goal ? { goal: input.goal } : {}), sketch })
  }

  /** X7a：离开前是否要确认 */
  const canLeave = (): 'free' | 'confirm' => leaveGuard(!!session.value && isDirty(session.value))

  /** 描述重新加载后：编辑会话认出刚保存的或标为已过时；返回要显示的索引 */
  function onReloaded(): ModelIndex | null {
    const s = session.value
    const def = loadedSketch()
    if (s && def && i.sketch.value) session.value = reloaded(s, def, i.sketch.value.hash)
    return session.value ? draftIndex(files.value, session.value.file, session.value.draft) : loaded.value
  }

  return {
    enterEdit,
    exitEdit,
    edit,
    undo: step(undoSession),
    redo: step(redoSession),
    previewMove,
    previewRemove,
    save,
    discard,
    replayOnReload,
    createDesign,
    canLeave,
    onReloaded,
  }
}
