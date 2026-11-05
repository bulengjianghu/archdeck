/**
 * DeskState 的编辑分组（desk.edit，X7、X20，ADR-0024、ADR-0025）：按设计的编辑会话（一个值）、派生、操作与草图写回同步。
 * 只在草图版本（设计的草图、持久草图）上有会话：打开草图即进入草图画布；此时 DeskState 的 index 为设计的索引（各张草图连同 system.yaml 与持久草图）。
 */
import { computed, shallowRef, watch, type ShallowRef } from 'vue'
import { layoutView } from '@/layout/layout'
import {
  editLock,
  isIntentVersion,
  isSketchRevision,
  isSketchVersion,
  kebab,
  locate,
  locateAll,
  projectLevel,
  referenceNodes,
  referenceRelations,
  ROOT_MOUNT,
  sketchLifetime,
  type ChangeKind,
  type CompareMode,
  type DesignInfo,
  type ModelIndex,
  type RawFile,
  type SketchPoint,
  type SketchTarget,
  type VersionRef,
} from '@/model'
import type { Selection, ViewAction } from '../transition'
import type { ModelWriter } from './ports'
import type { EditSession } from './edit/session'
import { createDerive } from './edit/derive'
import { createSaveSync } from './edit/save'
import { AI_BUSY, createCommands, type PayloadSketch } from './edit/commands'
import { createApproval } from './edit/approval'
import { createChanges } from './edit/changes'

export type { EditSession } from './edit/session'
export type { SaveOutcome } from './edit/save'
export type { EditOutcome } from './edit/commands'

export interface EditInputs {
  version?: VersionRef
  loaded: ShallowRef<ModelIndex | null>
  files: ShallowRef<RawFile[]>
  /** 载荷里的主草图（持久草图版本为它自己） */
  sketch: ShallowRef<PayloadSketch | undefined>
  /** 载荷里设计的全部草图 */
  sketchFiles: ShallowRef<PayloadSketch[] | undefined>
  current: () => ModelIndex | null
  /** 持久草图「交给 AI 时的改动摘要」的对象：去掉这张草图贡献后的当前版本（同服务端 intentChanges）；缺省为 current。偏差一律相对 current */
  handoffCurrent?: () => ModelIndex | null
  /** 设计的基线（载荷没有给出时为当前版本） */
  baseline: () => ModelIndex | null
  /** 05 裁决 3：载荷给出了基线（base.commit 那一版）；没有时相对基线退化为相对当前版本 */
  hasBase?: () => boolean
  prompt: () => string
  selection: () => Selection | null
  showDiff: () => boolean
  levelPath: () => readonly string[]
  dispatch: (action: ViewAction) => boolean
  show: (index: ModelIndex | null) => void
  reload: () => Promise<void>
  writer: ModelWriter
  /** DL-3：载荷里的编号表（designs/<设计>/changes.json 原文） */
  changesFile?: () => unknown
  /** DA-6：AI 回合中画布只读 */
  aiBusy?: () => boolean
  /** DL-34、DL-33：设计的元信息（状态、认可记录、认可的偏差）；持久草图没有 */
  designInfo?: () => DesignInfo | undefined
}

export function createEdit(i: EditInputs) {
  const editable = isSketchVersion(i.version)
  const target: SketchTarget | undefined = isSketchRevision(i.version)
    ? { kind: 'design', design: i.version.design }
    : isIntentVersion(i.version)
      ? { kind: 'persistent', id: i.version.intent }
      : undefined
  const session = shallowRef<EditSession | null>(null)
  /** 面板内的一条提示（如「加到设计」后没能切到那张草图），草图面板顶部显示，可关闭 */
  const notice = shallowRef('')
  /** 画布上的多选（框选 / ⇧ 点选）：合并的输入；单选仍是视图状态的 selection */
  const picked = shallowRef<string[]>([])
  /** X22：草图画布「隐藏外部引用」——只在会话里，不进 URL、不写文件 */
  const hideReferences = shallowRef(false)
  /** X22：草图画布的可用区域（画布容器的实际尺寸，草图画布用 ResizeObserver 量；只在会话里） */
  const area = shallowRef<{ w: number; h: number } | null>(null)
  /** 持久草图只有「相对当前版本」一个对比（偏差，同 sketchCheck）：它没有基线（不属于设计）；交给 AI 的改动摘要另算（handoff） */
  const twoBases = target?.kind !== 'persistent'
  /** 对比口径（对比弹层设定，设计的草图缺省相对基线，持久草图固定相对当前版本） */
  const compareMode = shallowRef<CompareMode>(twoBases ? 'baseline' : 'current')
  /**
   * T2.5：新建草图的起点——模型画布在那一层算好的节点位置（同一套布局 layoutView，按基线投影本层）；按挂载点算一次、只在会话里。
   * 根草图按层带排（X21），不借。
   */
  const seeds = shallowRef<Record<string, Record<string, SketchPoint>>>({})
  const seedFor = (mount: string) => seeds.value[mount] ?? null
  const derive = createDerive({
    seed: seedFor,
    session,
    loaded: i.loaded,
    files: i.files,
    current: i.current,
    handoffCurrent: i.handoffCurrent ?? i.current,
    baseline: i.baseline,
    twoBases,
    compareMode: () => compareMode.value,
    showDiff: i.showDiff,
    selection: i.selection,
    multi: () => picked.value,
    hideReferences: () => hideReferences.value,
    area: () => area.value,
  })
  /** DL-3：保存时一并写编号表（下面 createChanges 之后接上） */
  let tableForSave: () => unknown = () => null
  watch(
    () => session.value?.mount,
    async mount => {
      const s = session.value
      const idx = i.baseline()
      if (!s || !mount || mount === ROOT_MOUNT || seeds.value[mount] || s.doc.sketches[mount]?.layout?.modules || !idx?.modules.has(mount)) return
      try {
        const pv = await layoutView(projectLevel(idx, mount))
        const out: Record<string, SketchPoint> = {}
        for (const [id, b] of pv.nodes) if (idx.modules.get(id)?.parentId === mount) out[id] = { x: Math.round(b.x), y: Math.round(b.y) }
        if (Object.keys(out).length) seeds.value = { ...seeds.value, [mount]: out }
      } catch {
        // 模型画布排不出（层次被隐藏等）：退回网格
      }
    },
    { immediate: true },
  )
  /** DL-34：编辑锁的原因——设计状态锁先于 AI 回合只读（DL-28） */
  const statusLock = computed(() => (target?.kind === 'design' ? editLock(i.designInfo?.()?.status) : null))
  const lockReason = (): string | null => statusLock.value ?? (i.aiBusy?.() ? AI_BUSY : null)
  const sync = createSaveSync(i.writer, session, i.baseline, () => tableForSave())
  const sketchFiles = () => (target?.kind === 'design' ? (i.sketchFiles.value ?? []) : i.sketch.value ? [i.sketch.value] : [])
  const commands = createCommands({
    session,
    picked,
    loaded: i.loaded,
    files: i.files,
    sketchFiles,
    target,
    baseline: i.baseline,
    current: i.current,
    levelPath: i.levelPath,
    dispatch: i.dispatch,
    show: i.show,
    reload: i.reload,
    prompt: i.prompt,
    sync,
    derive,
    locked: lockReason,
  })
  const changes = createChanges({
    session,
    derive,
    baseline: i.baseline,
    current: i.current,
    design: target?.kind === 'design' ? target.design : null,
    table: () => i.changesFile?.(),
    commit: commands.commit,
    locked: lockReason,
  })
  tableForSave = changes.tableForSave
  const approval = createApproval({
    session,
    derive,
    changes,
    design: target?.kind === 'design' ? target.design : null,
    status: () => i.designInfo?.()?.status,
    approval: () => i.designInfo?.()?.approval,
    accepted: () => i.designInfo?.()?.accepted ?? [],
    name: () => i.designInfo?.()?.name,
    baseline: i.baseline,
    current: i.current,
    sketchFiles,
    writer: i.writer,
    reload: i.reload,
  })
  /** 当前张里的条目（面板显示草图写了的字段；不在本张里的为 undefined——引用节点或属于别的草图） */
  const lookup = {
    module: (id: string) => (derive.sketch.value ? locate(derive.sketch.value, id)?.node : undefined),
    relation: (id: string) => derive.sketch.value?.relations?.find(r => r.id === id),
    /** X19、05 裁决 4：折叠进一个引用节点的精确关系 */
    referenceRelations: (id: string) => (derive.sketch.value ? referenceRelations(derive.sketch.value, id) : []),
    /** 本张里某模块提供的对外接口（X10） */
    interfaces: (owner: string) => (derive.sketch.value?.interfaces ?? []).filter(x => x.owner === owner),
    /** X23：连线「经端口」可选的端口——本张写的接口与当前版本的接口（ID、名称、定义模块） */
    ports: computed(() => {
      const out = new Map<string, { id: string; name: string; owner?: string }>()
      for (const x of i.current()?.interfaces.values() ?? []) out.set(x.id, { id: x.id, name: x.name, ...(x.owner ? { owner: x.owner } : {}) })
      for (const x of derive.sketch.value?.interfaces ?? []) out.set(x.id, { id: x.id, name: x.name, ...(x.owner ? { owner: x.owner } : {}) })
      return [...out.values()]
    }),
    /** X23：连线「经总线」可选的总线——本张与当前版本里 role: bus 的模块 */
    buses: computed(() => {
      const ids = new Set([...(i.current()?.modules.values() ?? [])].filter(m => m.role === 'bus').map(m => m.id))
      if (derive.sketch.value) for (const m of locateAll(derive.sketch.value)) if (m.node.role === 'bus') ids.add(m.id)
      return [...ids]
    }),
    /** 读到的描述里的持久草图（版本切换列出，可编辑） */
    intentIds: computed(() =>
      (i.loaded.value?.model.sketches ?? []).filter(s => s.file.startsWith('intent/') && sketchLifetime(s) === 'persistent').map(s => s.def.id),
    ),
  }
  /** X7c：名称能转写为 kebab-case（只含 ASCII）时给出 ID 短名建议；中文名为空串（必须手填，不用拼音） */
  const suggestShort = (name: string): string => (/^[\x20-\x7e]*$/.test(name) ? kebab(name) : '')
  /** F-28：「引用外部模块」的候选——当前版本里不在本张、不是挂载点、不是层的模块 */
  const referenceCandidates = computed(() => {
    const def = derive.sketch.value
    const cur = i.current()
    if (!def || !cur) return []
    const here = new Set([...locateAll(def).map(m => m.id), ...referenceNodes(def), def.mount])
    return [...cur.modules.values()]
      .filter(m => m.parentId !== cur.rootId && !here.has(m.id))
      .map(m => ({ id: m.id, name: m.name, path: (cur.pathOf.get(m.id) ?? []).slice(1, -1).map(x => cur.modules.get(x)?.name ?? x) }))
  })
  /**
   * F-40、#3：父模块（挂载点）对外的一面——名称与职责属上一层：取上一层草图（会话里的）；那里职责为空时取当前版本的文字并标出；
   * 现有原则（「带入现有原则」）取当前版本挂载点模块的 abstraction。根草图没有父模块。
   */
  const parent = computed(() => {
    const s = session.value
    const m = s?.mount
    if (!s || !m || m === ROOT_MOUNT) return null
    const dot = m.lastIndexOf('.')
    const up = dot > 0 && m.slice(0, dot).includes('.') ? m.slice(0, dot) : ROOT_MOUNT
    const upper = s.doc.sketches[up] ? locate(s.doc.sketches[up], m)?.node : undefined
    const cur = i.current()?.modules.get(m)
    const resp = upper?.responsibility?.trim()
    return {
      id: m,
      name: upper?.name ?? cur?.name ?? derive.nameOf(m) ?? m,
      responsibility: resp || cur?.responsibility || '',
      fromCurrent: !resp && !!cur?.responsibility,
      upper: up,
      currentAbstraction: cur?.abstraction ?? '',
    }
  })
  /** T1 裁决 10：非层模块的 abstraction（对内的原则）属挂在它身上的草图——会话里有那张时取它，否则取当前版本 */
  function principleOf(id: string): { text: string; from: 'sketch' | 'current' } | null {
    const own = session.value?.doc.sketches[id]?.abstraction?.trim()
    if (own) return { text: own, from: 'sketch' }
    const cur = i.current()?.modules.get(id)?.abstraction?.trim()
    return cur ? { text: cur, from: 'current' } : null
  }
  /** F-41：模块的血缘读法（相对基线的本张变更）：合并 / 拆分 / 改 ID / 移动；没有血缘为 null */
  function lineageOf(id: string): ChangeKind | null {
    for (const c of derive.vsBaseline.value?.sheet?.changes ?? []) {
      if (c.entity !== 'module') continue
      if (c.kind === 'split' && c.to?.includes(id)) return 'split'
      if (c.id === id && (c.kind === 'merged' || c.kind === 'renamed' || c.kind === 'moved')) return c.kind
    }
    return null
  }
  /** F-43：模块在当前版本里的位置（祖先名称链） */
  function placeOf(id: string): string[] {
    const cur = i.current()
    return (cur?.pathOf.get(id) ?? []).slice(1, -1).map(x => cur?.modules.get(x)?.name ?? x)
  }
  /** F-2、F-10：设计的各张草图（挂载点、模块数、脏、名称），根草图在前 */
  const sheets = computed(() => {
    const s = session.value
    if (!s) return []
    const dirty = new Set(derive.dirtySketches.value)
    return Object.entries(s.doc.sketches)
      .map(([mount, def]) => ({
        mount,
        name: mount === ROOT_MOUNT ? '根（层与第二级）' : (derive.nameOf(mount) ?? mount),
        modules: mount === ROOT_MOUNT ? locateAll(def).filter(m => m.parentId !== undefined).length : (def.modules ?? []).length,
        dirty: dirty.has(mount),
        current: mount === s.mount,
        // 有文件（读自文件的，含级联改名后的）；没有的是会话里推出的
        file: s.doc.origin[mount] !== undefined,
      }))
      .sort((a, b) => (a.mount === ROOT_MOUNT ? -1 : b.mount === ROOT_MOUNT ? 1 : a.mount.localeCompare(b.mount)))
  })
  return {
    lookup,
    parent,
    principleOf,
    lineageOf,
    placeOf,
    sheets,
    /** 05 裁决 3：没有基线提交（无 git 或 HEAD 不含描述）时相对基线退化为相对当前版本；持久草图没有相对基线，不提示 */
    baselineFallback: computed(() => twoBases && !!session.value && !(i.hasBase?.() ?? true)),
    /** 有「相对基线」与「相对当前版本」两个对比（设计的草图）；持久草图只有相对当前版本 */
    twoBases,
    currentIndex: computed(() => i.current()),
    suggestShort,
    referenceCandidates,
    editable,
    target,
    session,
    picked,
    notice,
    compareMode,
    setCompareMode: (m: CompareMode) => (compareMode.value = twoBases ? m : 'current'),
    pick: (ids: readonly string[]) => (picked.value = [...new Set(ids)]),
    hideReferences,
    toggleReferences: () => (hideReferences.value = !hideReferences.value),
    area,
    /** X22：量到的可用区域（只在变了时更新，避免重复派生） */
    setArea: (a: { w: number; h: number } | null) => {
      const cur = area.value
      if (a && cur && Math.round(a.w) === Math.round(cur.w) && Math.round(a.h) === Math.round(cur.h)) return
      area.value = a ? { w: Math.round(a.w), h: Math.round(a.h) } : null
    },
    active: computed(() => !!session.value),
    stale: computed(() => !!session.value?.stale),
    ...derive,
    saving: sync.saving,
    lastSave: sync.last,
    serverIssues: sync.serverIssues,
    ...commands,
    /** 放弃本次改动：编号表也回到文件里的样子 */
    async discard() {
      await commands.discard()
      changes.reset()
    },
    changes,
    /** TK-1–TK-4：认可、回到起草、放弃与任务单 */
    approval,
    /** T2.5：各层借来的起点（画布据此在起点算好时再适应一次） */
    seeds,
    /** 画布只读：设计已锁定（DL-34）或 AI 回合中（DA-6） */
    locked: computed(() => !!lockReason()),
    /** 只读的原因（信息条、画布提示同一句） */
    lockReason: computed(lockReason),
    /** DA-6：AI 回合中 */
    aiBusy: computed(() => !!i.aiBusy?.()),
    /** DL-34：设计的状态锁（已认可时为「回到起草」的提示） */
    statusLock,
  }
}

export type EditGroup = ReturnType<typeof createEdit>
