/**
 * DeskState 的源码派生（desk.files，ADR-0013）：清单由源码同步取得，归属、目录树、投影与警告调用模型层（G）。
 */
import { computed, type ComputedRef, type ShallowRef } from 'vue'
import {
  DEFAULT_MAX_LINES,
  assignFiles,
  fileNodes,
  fileTree,
  matchExports,
  moduleEntry,
  moduleFiles,
  sourceIssues,
  type DirNode,
  type ExportMatch,
  type ExportedSymbol,
  type FileNodes,
  type Issue,
  type LevelView,
  type ModelIndex,
  type ModuleEntry,
  type SourceOwnership,
} from '@/model'
import type { ViewState } from '../transition'
import type { createSourceSync } from '../sync/source'

export interface FilesInputs {
  state: ShallowRef<ViewState>
  index: ShallowRef<ModelIndex | null>
  view: ComputedRef<LevelView | null>
  sync: ReturnType<typeof createSourceSync>
  /** 设计版本时为 true：归属警告只对当前版本报（G9） */
  design: boolean
}

export function createFiles({ state, index, view, sync, design }: FilesInputs) {
  const payload = sync.tree
  const local = computed(() => (payload.value?.status === 'local' ? payload.value : null))
  const ownership = computed<SourceOwnership | null>(() =>
    index.value && local.value ? assignFiles(index.value, local.value.files, index.value.model.sourceIgnore) : null,
  )
  /** G19、G20：文件行数与超长阈值 */
  const lines = computed<Readonly<Record<string, number>>>(() => local.value?.lines ?? {})
  const maxLines = computed(() => index.value?.model.sourceLimits?.maxLines ?? DEFAULT_MAX_LINES)
  const tree = computed<DirNode | null>(() =>
    local.value && ownership.value ? fileTree(local.value.files, ownership.value, lines.value, maxLines.value) : null,
  )
  /** 选中的文件（G16） */
  const selected = computed(() => (state.value.selection?.kind === 'file' ? state.value.selection.id : null))
  /** 选中文件的归属模块（冲突时多个，G6） */
  const owners = computed<string[]>(() => (selected.value ? (ownership.value?.owners.get(selected.value) ?? []) : []))
  /** G14：选中文件在当前层次的投影 */
  const hits = computed<FileNodes | null>(() => (index.value && view.value && selected.value ? fileNodes(index.value, view.value, owners.value) : null))
  /** G13：选中模块的文件 */
  const moduleFileSet = computed<ReadonlySet<string>>(() => {
    const s = state.value.selection
    if (!index.value || !ownership.value || s?.kind !== 'module') return new Set()
    return new Set(moduleFiles(index.value, ownership.value, s.id))
  })
  const filesOf = (moduleId: string): string[] => (index.value && ownership.value ? moduleFiles(index.value, ownership.value, moduleId) : [])
  const entryOf = (moduleId: string): ModuleEntry | null =>
    index.value && ownership.value && local.value ? moduleEntry(index.value, ownership.value, local.value, moduleId) : null
  /** G12：入口导出与模块 provides 的对应 */
  const exportMatch = (moduleId: string, symbols: readonly ExportedSymbol[]): ExportMatch | null =>
    index.value ? matchExports(index.value, moduleId, symbols) : null
  /** 以某个文件为入口的模块 */
  const entryModulesOf = (file: string): string[] =>
    index.value && ownership.value ? index.value.model.modules.filter(m => entryOf(m.id)?.file === file).map(m => m.id) : []
  /** G9：归属警告只对当前版本报 */
  const warnings = computed<Issue[]>(() =>
    !design && index.value && ownership.value && local.value ? sourceIssues(index.value, ownership.value, local.value) : [],
  )

  return {
    payload,
    ownership,
    tree,
    lines,
    maxLines,
    selected,
    owners,
    hits,
    moduleFiles: moduleFileSet,
    warnings,
    filesOf,
    entryOf,
    exportMatch,
    entryModulesOf,
    file: sync.file,
    exports: sync.exports,
    refresh: sync.refresh,
  }
}

export type FileDerivations = ReturnType<typeof createFiles>
