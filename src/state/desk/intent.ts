/**
 * DeskState 的意图派生（desk.intent，X3、X4）：对打开的版本有约束力的草图及其核验结果——
 * 当前版本：持久草图 + 已定稿设计的草图（载荷附带）；设计某一轮：持久草图 + 本设计的草图；草图版本：无（它自己就是尺子）。
 */
import { computed, type ShallowRef } from 'vue'
import {
  archiveVerdict,
  checkSketches,
  isDesignVersion,
  isSketchRevision,
  parseDesignSketches,
  type AcceptedDeviation,
  type ArchiveVerdict,
  type DesignInfo,
  type ModelIndex,
  type RawFile,
  type SketchCheck,
  type VersionRef,
} from '@/model'

export interface IntentInputs {
  index: ShallowRef<ModelIndex | null>
  designs: ShallowRef<DesignInfo[]>
  /** 载荷附带的设计草图（X4） */
  sketches: ShallowRef<{ design: string; file: RawFile }[]>
  version?: VersionRef
}

export function createIntent({ index, designs, sketches, version }: IntentInputs) {
  const sketchVersion = isSketchRevision(version)
  const dv = isDesignVersion(version) ? version : undefined
  /** 每张活动草图的核验结果 */
  const checks = computed<SketchCheck[]>(() => {
    const idx = index.value
    if (!idx || sketchVersion) return []
    const accepted = new Map<string, readonly AcceptedDeviation[]>(designs.value.map(d => [d.id, d.accepted ?? []]))
    return checkSketches(idx, parseDesignSketches(sketches.value), accepted)
  })
  /** 打开设计某一轮时，本设计草图的核验 */
  const current = computed<SketchCheck | null>(() => (dv && !sketchVersion ? (checks.value.find(c => c.design === dv.design) ?? null) : null))
  /** X3：本设计的归档判定（对设计某一轮打开时只作提示：归档以当前版本的核验为准） */
  const verdict = computed<ArchiveVerdict | null>(() => (current.value ? archiveVerdict(current.value) : null))
  const counts = computed(() => {
    const out = { error: 0, warning: 0, info: 0 }
    for (const c of checks.value) for (const k of ['error', 'warning', 'info'] as const) out[k] += c.counts[k]
    return out
  })
  return { sketchVersion, checks, current, verdict, counts }
}

export type IntentDerivations = ReturnType<typeof createIntent>
