/**
 * DeskState 的编辑分组（desk.edit，X7、ADR-0024）：编辑会话（一个值）、编辑态派生、编辑操作与草图写回同步。
 * 编辑态只在草图版本（设计的草图、持久草图）上可用；编辑态下 DeskState 的 index 为编辑中的草图的索引，投影、布局、导航树、面板照常工作。
 */
import { computed, shallowRef, type ShallowRef } from 'vue'
import {
  locate,
  locateAll,
  moduleId,
  sketchLifetime,
  isIntentVersion,
  isSketchRevision,
  isSketchVersion,
  type AcceptedDeviation,
  type ModelIndex,
  type RawFile,
  type SketchTarget,
  type VersionRef,
} from '@/model'
import type { ViewAction } from '../transition'
import type { ModelWriter } from '../sync/writer'
import type { EditSession } from './edit/session'
import { createDerive } from './edit/derive'
import { createSaveSync } from './edit/save'
import { createCommands } from './edit/commands'

export type { EditSession } from './edit/session'
export type { SaveOutcome } from './edit/save'
export type { EditOutcome } from './edit/commands'

export interface EditInputs {
  version?: VersionRef
  loaded: ShallowRef<ModelIndex | null>
  files: ShallowRef<RawFile[]>
  sketch: ShallowRef<{ file: string; hash: string; path?: string } | undefined>
  current: () => ModelIndex | null
  accepted: () => readonly AcceptedDeviation[]
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
  /** 草图在载荷里的路径：设计的草图版本里为主草图的 sketches/<mount>.yaml（载荷给出），持久草图为 intent/<ID>.yaml */
  const file = () => (target?.kind === 'design' ? (i.sketch.value?.path ?? 'sketches/root.yaml') : target ? `intent/${target.id}.yaml` : undefined)
  const session = shallowRef<EditSession | null>(null)
  const derive = createDerive({
    session,
    loaded: i.loaded,
    files: i.files,
    current: i.current,
    accepted: i.accepted,
    design: target?.kind === 'design' ? target.design : undefined,
  })
  const sync = createSaveSync(i.writer, session)
  const commands = createCommands({ ...i, session, target, file, sync })
  /** 编辑中的草图里的条目（表单显示草图写了的字段；不在本草图里的为 undefined——属于持久草图） */
  const lookup = {
    module: (id: string) => (session.value ? locate(session.value.draft, id)?.node : undefined),
    relation: (id: string) => session.value?.draft.relations?.find(r => r.id === id),
    interfacesOf: (owner: string) => session.value?.draft.interfaces?.filter(x => x.owner === owner) ?? [],
    /** 只在持久草图里的模块所属的持久草图 ID */
    persistentOf: (id: string) => (derive.ctx.value?.persistent.find(p => !!locate(p.def, id)) ?? null)?.def.id ?? null,
    persistentIds: computed(() => derive.ctx.value?.persistent.map(p => p.def.id) ?? []),
    /** 读到的描述里的持久草图（版本切换列出，可编辑） */
    intentIds: computed(() =>
      (i.loaded.value?.model.sketches ?? []).filter(s => s.file.startsWith('intent/') && sketchLifetime(s) === 'persistent').map(s => s.def.id),
    ),
    /** X7c：新模块的 ID 预览（就地输入名称时显示） */
    previewId: (parent: string | undefined, name: string) =>
      moduleId(parent, name, new Set([...(i.loaded.value?.modules.keys() ?? []), ...(session.value ? locateAll(session.value.draft).map(m => m.id) : [])])),
  }
  return {
    lookup,
    editable,
    target,
    session,
    active: computed(() => !!session.value),
    draft: computed(() => session.value?.draft ?? null),
    stale: computed(() => !!session.value?.stale),
    canUndo: computed(() => !!session.value?.past.length),
    canRedo: computed(() => !!session.value?.future.length),
    ...derive,
    saving: sync.saving,
    lastSave: sync.last,
    serverIssues: sync.serverIssues,
    ...commands,
  }
}

export type EditDerivations = ReturnType<typeof createEdit>
