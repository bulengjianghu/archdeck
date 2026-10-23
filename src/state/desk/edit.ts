/**
 * DeskState 的编辑分组（desk.edit，X7、X20，ADR-0024、ADR-0025）：按设计的编辑会话（一个值）、派生、操作与草图写回同步。
 * 只在草图版本（设计的草图、持久草图）上有会话：打开草图即进入草图画布；此时 DeskState 的 index 为设计的索引（各张草图连同 system.yaml 与持久草图）。
 */
import { computed, shallowRef, type ShallowRef } from 'vue'
import {
  isIntentVersion,
  isSketchRevision,
  isSketchVersion,
  kebab,
  locate,
  locateAll,
  referenceNodes,
  sketchLifetime,
  type CompareMode,
  type ModelIndex,
  type RawFile,
  type SketchTarget,
  type VersionRef,
} from '@/model'
import type { Selection, ViewAction } from '../transition'
import type { ModelWriter } from '../sync/writer'
import type { EditSession } from './edit/session'
import { createDerive } from './edit/derive'
import { createSaveSync } from './edit/save'
import { createCommands, type PayloadSketch } from './edit/commands'

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
  /** 设计的基线（载荷没有给出时为当前版本） */
  baseline: () => ModelIndex | null
  prompt: () => string
  selection: () => Selection | null
  showDiff: () => boolean
  levelPath: () => readonly string[]
  dispatch: (action: ViewAction) => boolean
  show: (index: ModelIndex | null) => void
  reload: () => Promise<void>
  writer: ModelWriter
}

export function createEdit(i: EditInputs) {
  const editable = isSketchVersion(i.version)
  const target: SketchTarget | undefined = isSketchRevision(i.version)
    ? { kind: 'design', design: i.version.design }
    : isIntentVersion(i.version)
      ? { kind: 'persistent', id: i.version.intent }
      : undefined
  const session = shallowRef<EditSession | null>(null)
  /** 画布上的多选（框选 / ⇧ 点选）：合并的输入；单选仍是视图状态的 selection */
  const picked = shallowRef<string[]>([])
  /** 对比口径（对比弹层设定，缺省相对基线） */
  const compareMode = shallowRef<CompareMode>('baseline')
  const derive = createDerive({
    session,
    loaded: i.loaded,
    files: i.files,
    current: i.current,
    baseline: i.baseline,
    compareMode: () => compareMode.value,
    showDiff: i.showDiff,
    selection: i.selection,
    multi: () => picked.value,
  })
  const sync = createSaveSync(i.writer, session, i.baseline)
  const sketchFiles = () => (target?.kind === 'design' ? (i.sketchFiles.value ?? []) : i.sketch.value ? [i.sketch.value] : [])
  const commands = createCommands({
    session,
    picked,
    loaded: i.loaded,
    files: i.files,
    sketchFiles,
    target,
    baseline: i.baseline,
    levelPath: i.levelPath,
    dispatch: i.dispatch,
    show: i.show,
    reload: i.reload,
    prompt: i.prompt,
    sync,
    derive,
  })
  /** 当前张里的条目（面板显示草图写了的字段；不在本张里的为 undefined——引用节点或属于别的草图） */
  const lookup = {
    module: (id: string) => (derive.sketch.value ? locate(derive.sketch.value, id)?.node : undefined),
    relation: (id: string) => derive.sketch.value?.relations?.find(r => r.id === id),
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
      .filter(m => m.kind !== 'layer' && !here.has(m.id))
      .map(m => ({ id: m.id, name: m.name, path: (cur.pathOf.get(m.id) ?? []).slice(1, -1).map(x => cur.modules.get(x)?.name ?? x) }))
  })
  return {
    lookup,
    suggestShort,
    referenceCandidates,
    editable,
    target,
    session,
    picked,
    compareMode,
    setCompareMode: (m: CompareMode) => (compareMode.value = m),
    pick: (ids: readonly string[]) => (picked.value = [...new Set(ids)]),
    active: computed(() => !!session.value),
    stale: computed(() => !!session.value?.stale),
    ...derive,
    saving: sync.saving,
    lastSave: sync.last,
    serverIssues: sync.serverIssues,
    ...commands,
  }
}

export type EditGroup = ReturnType<typeof createEdit>
