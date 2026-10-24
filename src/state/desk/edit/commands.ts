/**
 * 草图画布的操作（if.desk.edit，ADR-0024、ADR-0025）：对呈现层的唯一一组编辑操作。操作本身不含规则——
 * 编辑规则在模型层（applyDesignEdit），会话规则在视图状态转移（enterEdit / openSketch / edited / exitEdit），撤销栈在编辑会话（session.ts）。
 * 单张草图上的操作包装成 { op: 'edit', sketch: <当前张> }；一个手势一步（双击空白新建 = 新建 + 落位）。
 */
import type { ShallowRef } from 'vue'
import {
  load,
  locateAll,
  referenceNodes,
  ROOT_MOUNT,
  shortName,
  type DesignEditEffects,
  type DesignEditOp,
  type EditOp,
  type ModelIndex,
  type ModulePatch,
  type RawFile,
  type RelationType,
  type SketchDef,
  type SketchPoint,
  type SketchTarget,
} from '@/model'
import { bandRelative, sketchPositions } from '@/layout/layout'
import type { WriteOutcome } from '../../sync/writer'
import { leaveGuard, type ViewAction } from '../../transition'
import type { createSaveSync, SaveOutcome } from './save'
import type { EditDerivations } from './derive'
import {
  apply,
  begin,
  discard as discardSession,
  isDirty,
  NO_DESIGN_EFFECTS,
  open,
  redo as redoSession,
  reloaded,
  replay,
  splitImpact,
  renameImpact,
  type RenameImpact,
  undo as undoSession,
  type EditSession,
  type ReadSketch,
  type SplitLoss,
} from './session'

/** 载荷里的一张草图文件：挂载点、在载荷里的路径、读取时的指纹 */
export interface PayloadSketch {
  mount?: string
  file: string
  path?: string
  hash: string
}

export interface CommandInputs {
  session: ShallowRef<EditSession | null>
  /** 画布上的多选（框选 / ⇧ 点选，合并用） */
  picked: ShallowRef<string[]>
  loaded: ShallowRef<ModelIndex | null>
  files: ShallowRef<RawFile[]>
  /** 载荷里的草图文件与读取时的指纹：设计为全部草图，持久草图为它自己 */
  sketchFiles: () => readonly PayloadSketch[]
  /** 编辑目标；不是草图版本时为 undefined */
  target?: SketchTarget
  baseline: () => ModelIndex | null
  /** 当前版本（X7d 改 ID 的影响里数当前版本的引用）；没给时不数 */
  current?: () => ModelIndex | null
  /** 当前层次的路径（跟随用） */
  levelPath: () => readonly string[]
  dispatch: (action: ViewAction) => boolean
  /** 把要显示的索引交给 DeskState（草图下为设计的索引，否则为读到的） */
  show: (index: ModelIndex | null) => void
  reload: () => Promise<void>
  /** DV-10：载荷里的「交给 AI」指令 */
  prompt: () => string
  sync: ReturnType<typeof createSaveSync>
  derive: EditDerivations
}

export type EditOutcome = { ok: true; effects: DesignEditEffects } | { ok: false; reason: string }
const fail = (reason: string): EditOutcome => ({ ok: false, reason })

export function createCommands(i: CommandInputs) {
  const { session, loaded, target, derive } = i
  const ctx = () => derive.ctx.value!

  /** 载荷里读到的各张草图（按挂载点） */
  function readSketches(): Record<string, ReadSketch> | null {
    if (!target) return null
    const out: Record<string, ReadSketch> = {}
    for (const f of i.sketchFiles()) {
      const path = f.path ?? f.file
      const def = load(i.files.value.filter(x => x.path === path)).model.sketches[0]?.def
      if (def) out[def.mount] = { file: path, hash: f.hash, def }
    }
    return Object.keys(out).length ? out : null
  }

  /** 挂载点的层次：根挂载为系统根 */
  const levelOf = (mount: string) => (mount === ROOT_MOUNT ? (loaded.value?.rootId ?? '') : mount)
  const showSession = () => i.show(session.value ? derive.index.value : loaded.value)
  const follow = (effects: DesignEditEffects, previousPath: readonly string[]) =>
    i.dispatch({ type: 'edited', effects, previousPath, level: levelOf(session.value?.mount ?? ROOT_MOUNT) })

  /** X7a：进入草图画布（草图版本打开即进入）；会话已在时只同步层次 */
  function enter(): boolean {
    const read = readSketches()
    if (!target || !read || !loaded.value) return false
    const id = target.kind === 'design' ? target.design : target.id
    session.value = session.value ?? begin(target, id, read)
    showSession()
    return i.dispatch({ type: 'enterEdit', target, level: levelOf(session.value.mount) })
  }

  /** X7a：有未保存改动时返回 'confirm'，由呈现层确认（保存 / 放弃 / 取消）后 force 退出；退出后回到进入草图之前的版本由呈现层导航 */
  function exit(force = false): 'confirm' | 'done' {
    if (!force && canLeave() === 'confirm') return 'confirm'
    session.value = null
    i.picked.value = []
    i.dispatch({ type: 'exitEdit' })
    i.show(loaded.value)
    return 'done'
  }

  /** 应用一步（一个或几个操作） */
  function run(ops: DesignEditOp | DesignEditOp[]): EditOutcome {
    const s = session.value
    if (!s || !loaded.value) return fail('不在草图里')
    const previousPath = i.levelPath()
    const r = apply(s, ops, ctx())
    if (!r.ok) return fail(r.reason)
    session.value = r.session
    i.picked.value = i.picked.value.filter(id => !r.effects.removed.includes(id) && !r.effects.renamed.some(([a]) => a === id))
    showSession()
    follow(r.effects, previousPath)
    return { ok: true, effects: r.effects }
  }

  const mount = () => session.value?.mount ?? ROOT_MOUNT
  const sheet = (): SketchDef | undefined => session.value?.doc.sketches[mount()]
  /** 单张草图上的操作 */
  const single = (op: EditOp): DesignEditOp => ({ op: 'edit', sketch: mount(), edit: op })
  const edit = (op: EditOp) => run(single(op))

  /**
   * X15：写位置时补齐还没写进 layout 的本层模块当前显示的位置（没有 layout 的草图第一次拖动即落下整张的初始布局），一步；引用节点不记（X22）。
   * 根草图（X21）给的是画布上的位置，换成相对所属层带顶的 y；非根草图给的已是相对中心区内容原点的位置（画布换算，X22）
   */
  function positionsWith(def: SketchDef, given: Record<string, SketchPoint>): Record<string, SketchPoint> {
    const ids = locateAll(def).map(m => m.id)
    const shown = sketchPositions(def, ids, i.derive.scene.value?.gridArea)
    const have = def.layout?.modules ?? {}
    const missing = Object.fromEntries(ids.filter(id => !have[id] && !given[id] && shown[id]).map(id => [id, shown[id]]))
    return bandRelative(def, { ...missing, ...given })
  }

  /** F-20：拖节点（多选一起拖）的落点，一步 */
  function moveNode(positions: Record<string, SketchPoint>): EditOutcome {
    const def = sheet()
    if (!def) return fail('不在草图里')
    return edit({ op: 'moveNode', positions: positionsWith(def, positions) })
  }

  /**
   * F-23：新建模块（双击空白 / 工具条「＋ 模块」）——非根草图为挂载点的子模块（ID = <挂载点>.<短名>）；
   * 根草图（X21）给了层带时为该层的第二级模块（ID = <层>.<短名>），没给时为一条新层（「＋ 层」，排在最后）。
   * 给了位置时新建与落位是一步。
   */
  function addModule(name: string, short: string, at?: SketchPoint, layer?: string): EditOutcome {
    const def = sheet()
    if (!def) return fail('不在草图里')
    const m = mount()
    const root = m === ROOT_MOUNT
    const sid = short.trim()
    if (!sid) return fail('ID 短名不能为空（X7c：中文名请填英文短名）')
    const parent = root ? layer : m
    const id = parent ? `${parent}.${sid}` : sid
    const add: DesignEditOp = parent ? single({ op: 'addModule', parent, name, id }) : single({ op: 'addLayer', name, id, at: (def.modules ?? []).length })
    const ops: DesignEditOp[] = [add]
    if (at && parent) ops.push(single({ op: 'moveNode', positions: positionsWith(def, { [id]: at }) }))
    return run(ops)
  }

  /** F-21：连线 */
  const connect = (from: string, to: string, type: RelationType, description?: string) =>
    edit({ op: 'connect', from, to, type, ...(description?.trim() ? { description } : {}) })

  /** F-24：合并（≥2 个同层模块 → 新模块，名称 + ID 短名） */
  const merge = (ids: readonly string[], name: string, short: string) => run({ op: 'merge', sketch: mount(), ids: [...ids], name, id: short })
  /** F-25：拆分（若干名称 + ID 短名） */
  const split = (id: string, parts: { name: string; id: string }[]) => run({ op: 'split', sketch: mount(), id, parts })
  /** X7k：拆分前的二次确认范围（不改会话）：随原模块删掉的下一层草图；拆分不成立时为原因 */
  function previewSplit(id: string, parts: { name: string; id: string }[]): { sketches: SplitLoss[] } | { rejected: string } {
    const s = session.value
    if (!s || !loaded.value) return { rejected: '不在草图里' }
    const r = splitImpact(s, { op: 'split', sketch: mount(), id, parts }, ctx())
    return r.ok ? { sketches: r.sketches } : { rejected: r.reason }
  }
  /** F-26：降级——拖到同层另一节点上 */
  const demote = (id: string, onto: string) => run({ op: 'demote', sketch: mount(), id, target: onto })
  /** F-26：升级——拖到面包屑的父级 */
  const promote = (id: string) => run({ op: 'promote', sketch: mount(), id })
  /** F-26、X21：移入——根草图里拖到另一条层带；给了落点（画布上的位置）时落位与移入是一步（新 ID = <层>.<短名>，y 换成相对目标带顶） */
  function moveIn(id: string, layer: string, at?: SketchPoint): EditOutcome {
    const ops: DesignEditOp[] = [{ op: 'moveIn', id, layer }]
    const def = sheet()
    if (at && def) {
      const to = `${layer}.${shortName(id)}`
      ops.push({ op: 'edit', sketch: ROOT_MOUNT, edit: { op: 'moveNode', positions: bandRelative(def, { [to]: at }, () => layer) } })
    }
    return run(ops)
  }
  /** 改 ID（只改短名，前缀级联） */
  const rename = (id: string, newId: string) => run({ op: 'rename', sketch: mount(), id, newId })
  /** X7d：表单改 ID 提交前的影响（不改会话）：后代数、关系数、随之改名的下一层草图、当前版本里的引用；新旧相同为 null，不成立时为原因 */
  function previewRename(id: string, newId: string): { impact: RenameImpact | null } | { rejected: string } {
    const s = session.value
    if (!s || !loaded.value) return { rejected: '不在草图里' }
    const r = renameImpact(s, { op: 'rename', sketch: mount(), id, newId }, ctx(), i.current?.() ?? null)
    return r.ok ? { impact: r.impact } : { rejected: r.reason }
  }
  const updateModule = (id: string, patch: ModulePatch) => edit({ op: 'updateModule', id, patch })
  /** F-22：拖关系标签 */
  const relabel = (id: string, label: SketchPoint | null) => edit({ op: 'relabel', id, label })
  /** F-31、X22：重新排列——非根草图按中心区的可用区域排网格 */
  const autoArrange = () => {
    const area = i.derive.scene.value?.gridArea
    return edit({ op: 'autoArrange', ...(area ? { area } : {}) })
  }
  /** F-28：引用外部模块（放上画布作为待连端点，位置按所属层排布） */
  const addReference = (id: string) => edit({ op: 'addReference', id })
  /** F-40：父模块原则 */
  const setAbstraction = (text: string) => edit({ op: 'setAbstraction', text })

  /** 删除的操作：模块（级联）、关系、引用节点（= 删它的关系与它的位置） */
  function removeOps(id: string): DesignEditOp[] | string {
    const def = sheet()
    if (!def) return '不在草图里'
    if (def.relations?.some(r => r.id === id)) return [single({ op: 'removeRelation', id })]
    if (locateAll(def).some(m => m.id === id)) return [{ op: 'remove', sketch: mount(), id }]
    if (referenceNodes(def).includes(id)) return [single({ op: 'removeReference', id })]
    return `草图里没有「${id}」`
  }

  /** F-30：删除选中的（若干个一步） */
  function remove(ids: readonly string[]): EditOutcome {
    const ops: DesignEditOp[] = []
    for (const id of ids) {
      const o = removeOps(id)
      if (typeof o === 'string') return fail(o)
      ops.push(...o)
    }
    return run(ops)
  }

  /** X7e：删除前的级联范围（不改会话）：将删的实体与草图；拒绝时为原因 */
  function previewRemove(ids: readonly string[]): { removed: string[]; sketches: string[] } | { rejected: string } {
    const s = session.value
    if (!s || !loaded.value) return { rejected: '不在草图里' }
    const ops: DesignEditOp[] = []
    for (const id of ids) {
      const o = removeOps(id)
      if (typeof o === 'string') return { rejected: o }
      ops.push(...o)
    }
    const r = apply(s, ops, ctx())
    return r.ok ? { removed: r.effects.removed, sketches: r.effects.removedSketches } : { rejected: r.reason }
  }

  /** 切到另一张草图（会话里没有时按 X18 推出） */
  function openMount(m: string): EditOutcome {
    const s = session.value
    if (!s || !loaded.value) return fail('不在草图里')
    const r = open(s, m, ctx())
    if (!r.ok) return fail(r.reason)
    session.value = r.session
    i.picked.value = []
    showSession()
    i.dispatch({ type: 'openSketch', level: levelOf(m) })
    return { ok: true, effects: NO_DESIGN_EFFECTS }
  }

  /** F-27：下钻——打开挂在这个模块上的草图（层不是层次：层的子模块在根草图里） */
  function openChild(id: string): EditOutcome {
    const def = sheet()
    if (!def || !locateAll(def).some(m => m.id === id)) return fail(`「${id}」不是本层的模块`)
    if (mount() === ROOT_MOUNT && !id.includes('.')) return fail('层的子模块就画在根草图里（层是带，不是层次）')
    return openMount(id)
  }

  const step = (fn: typeof undoSession) => () => {
    const s = session.value
    const r = s && fn(s)
    if (!r) return false
    const previousPath = i.levelPath()
    session.value = r.session
    i.picked.value = []
    showSession()
    follow(r.effects, previousPath)
    return true
  }

  const save = (): Promise<SaveOutcome> => i.sync.save()

  /** F-52、X20：保存并交给 AI——有格式错误或语义提示时不做并说明；有未保存改动先保存，再取新读到的指令 */
  async function saveAndHandToAi(): Promise<{ ok: true; prompt: string } | { ok: false; reason: string }> {
    if (!session.value) return { ok: false, reason: '不在草图里' }
    const errors = derive.designErrors.value
    if (errors.length) return { ok: false, reason: `有 ${errors.length} 个格式错误，先改正（${errors[0].message}）` }
    const warnings = derive.designWarnings.value
    if (warnings.length) return { ok: false, reason: `有 ${warnings.length} 个语义提示，处理后才能交给 AI（${warnings[0].message}）` }
    if (derive.dirty.value) {
      const r = await save()
      if (!r.ok) return { ok: false, reason: r.conflict ? '文件已在外部改动，重新加载并重放后再交给 AI' : `保存失败：${r.error}` }
      await i.reload()
    }
    return { ok: true, prompt: i.prompt() }
  }

  /** 放弃本次改动；已过时时先重新加载，以新文件重新开始（X7i 的兜底） */
  async function discard(): Promise<void> {
    const s = session.value
    if (!s) return
    if (s.stale) await i.reload()
    const read = readSketches()
    const previousPath = i.levelPath()
    session.value = discardSession(session.value!, read ?? undefined)
    i.picked.value = []
    i.sync.serverIssues.value = []
    showSession()
    follow(NO_DESIGN_EFFECTS, previousPath)
  }

  /** X7i：重新加载并把本次的每一步按序重放到新文件上，返回失败的操作 */
  async function replayOnReload(): Promise<{ failed: DesignEditOp[] }> {
    const s = session.value
    if (!s) return { failed: [] }
    await i.reload()
    const read = readSketches()
    if (!read) return { failed: s.past.flatMap(p => p.ops) }
    const previousPath = i.levelPath()
    const r = replay(s, read, ctx())
    session.value = r.session
    showSession()
    follow(NO_DESIGN_EFFECTS, previousPath)
    return { failed: r.failed }
  }

  /**
   * F-10、F-11、F-12、X18、05 裁决 3：新建设计——服务端写 base.commit = 仓库 HEAD，底稿按挂载点从那一版描述复制并初始布局一次
   * （与「相对基线」同一份；没有 git 时从当前版本复制、省略 base.commit）；创建后由呈现层打开它的草图。挂载点不能是层。
   */
  function createDesign(input: { id: string; name: string; goal?: string; mount: string }): Promise<WriteOutcome> {
    const idx = loaded.value
    if (!idx) return Promise.resolve({ ok: false, error: '描述还没加载' })
    if (input.mount !== ROOT_MOUNT && idx.modules.get(input.mount)?.kind === 'layer')
      return Promise.resolve({ ok: false, error: '挂载点不能是层：层的直接子模块画在根草图里（X9）' })
    return i.sync.createDesign({ id: input.id, name: input.name, ...(input.goal ? { goal: input.goal } : {}), mount: input.mount })
  }

  /** X7a：离开前是否要确认 */
  const canLeave = (): 'free' | 'confirm' => leaveGuard(!!session.value && isDirty(session.value, i.baseline()))

  /** 描述重新加载后：编辑会话认出刚保存的或标为已过时；返回要显示的索引 */
  function onReloaded(): ModelIndex | null {
    const s = session.value
    const read = readSketches()
    if (s && read) session.value = reloaded(s, read)
    return session.value ? derive.index.value : loaded.value
  }

  return {
    enter,
    exit,
    run,
    edit,
    addModule,
    connect,
    merge,
    split,
    demote,
    promote,
    moveIn,
    rename,
    updateModule,
    moveNode,
    relabel,
    autoArrange,
    addReference,
    setAbstraction,
    remove,
    previewRemove,
    previewSplit,
    previewRename,
    openChild,
    /** 切到挂在某个模块上的草图（面包屑回到某一级、设计面板点一张、引用节点「打开」；会话里没有时按基线推出） */
    openMount,
    undo: step(undoSession),
    redo: step(redoSession),
    save,
    saveAndHandToAi,
    discard,
    replayOnReload,
    createDesign,
    canLeave,
    onReloaded,
  }
}
