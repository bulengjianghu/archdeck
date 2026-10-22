/**
 * DeskState 的编辑分组（desk.edit，X7、ADR-0024）：编辑会话（一个值）、编辑态派生、编辑操作与草图写回同步。
 * 编辑态只在草图版本（设计的草图、持久草图）上可用；编辑态下 DeskState 的 index 为编辑中的草图的索引，投影、布局、导航树、面板照常工作。
 */
import { computed, shallowRef, type ShallowRef } from 'vue'
import {
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
  sketch: ShallowRef<{ file: string; hash: string } | undefined>
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
  /** 草图在载荷里的路径：设计的草图版本里为 sketch.yaml，持久草图为 intent/<ID>.yaml */
  const file = target?.kind === 'design' ? 'sketch.yaml' : target ? `intent/${target.id}.yaml` : undefined
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
  return {
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
