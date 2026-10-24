/**
 * DeskState 的版本派生（desk.versions，ADR-0013）：设计列表、当前设计与轮次、提交版本、对比基线、差异与基线漂移（E1–E6）。
 */
import { computed, type ShallowRef } from 'vue'
import {
  diffModels,
  isCommitVersion,
  isDesignVersion,
  isSketchRevision,
  parseDesignSketches,
  sketchLifetime,
  sketchLineage,
  type DesignInfo,
  type ModelCommit,
  type ModelDiff,
  type ModelIndex,
  type RawFile,
  type VersionRef,
} from '@/model'
import type { ViewState } from '../transition'
import type { Baseline } from '../sync/modelSource'

export interface VersionsInputs {
  state: ShallowRef<ViewState>
  index: ShallowRef<ModelIndex | null>
  designs: ShallowRef<DesignInfo[]>
  /** 改动过描述的最近提交（E5），新的在前 */
  commits: ShallowRef<ModelCommit[]>
  baselines: ShallowRef<{ current?: Baseline; previous?: Baseline; base?: Baseline }>
  /** 打开的设计版本或提交版本；当前版本时为 undefined */
  version?: VersionRef
  /** DV-10：草图版本的「交给 AI」指令 */
  sketchPrompt: ShallowRef<string>
  /** X4：载荷附带的设计草图（血缘的来源） */
  sketches: ShallowRef<{ design: string; file: RawFile }[]>
}

export function createVersions({ state, index, designs, commits, baselines, version, sketchPrompt, sketches }: VersionsInputs) {
  const dv = isDesignVersion(version) ? version : undefined
  const cv = isCommitVersion(version) ? version : undefined
  /** 打开的设计（不是设计版本时为 null） */
  const design = computed(() => (dv ? (designs.value.find(d => d.id === dv.design) ?? null) : null))
  /** DV-10：打开的是设计的草图（它本身不是轮次） */
  const sketch = isSketchRevision(version)
  const revision = computed(() => (sketch ? null : (design.value?.revisions.find(r => r.id === dv!.revision) ?? null)))
  const find = (rev?: string) => (rev ? (commits.value.find(c => c.hash.startsWith(rev.toLowerCase())) ?? null) : null)
  /** E5：打开的提交（不是提交版本时为 null）；不在最近的提交列表里时只有哈希 */
  const commit = computed<ModelCommit | null>(() => (cv ? (find(cv.commit) ?? { hash: cv.commit, short: cv.commit.slice(0, 8), date: '', subject: '' }) : null))
  /** E6：提交版本的对比基线提交；为当前版本（worktree）时为 null */
  const baseCommit = computed(() => find(cv?.base))
  /** E3：设计版本的对比基线为当前版本或上一轮；提交版本只有一个基线（E6） */
  const baseline = computed<Baseline | null>(() => {
    const b = baselines.value
    return (state.value.toggles.compareTo === 'previous' ? b.previous : undefined) ?? b.current ?? null
  })
  /** X11：打开的设计的血缘——设计的各张草图（草图版本里在索引中，轮次里随载荷附带）的 from */
  const lineage = computed(() => {
    if (!dv || !index.value) return undefined
    const own = index.value.model.sketches.filter(s => sketchLifetime(s) !== 'persistent').map(s => s.def)
    const attached = parseDesignSketches(sketches.value.filter(s => s.design === dv.design)).map(s => s.def)
    const l = sketchLineage([...own, ...attached])
    return l.size ? l : undefined
  })
  /** 相对对比基线的差异（设计版本按血缘表述）；当前版本时为 null */
  const diff = computed<ModelDiff | null>(() =>
    index.value && baseline.value ? diffModels(baseline.value.index, index.value, lineage.value ? { lineage: lineage.value } : {}) : null,
  )
  /**
   * E4：设计起草时的基线与当前版本不一致——当前版本已按新代码重新生成。一律比两版描述的 source.commit：载荷带的基线（base.commit 那一版描述，
   * 草图版本与轮次都带，05 裁决 3、T2b 裁决 1）与当前版本；载荷没带基线（没有 base.commit、没有 git 或读不到）时不判断
   */
  const drift = computed(() => {
    const was = baselines.value.base?.index.model.system.source?.commit
    const now = baselines.value.current?.index.model.system.source?.commit
    return !!was && !!now && was !== now
  })

  return { designs, design, revision, sketch, sketchPrompt, commits, commit, baseCommit, baselines, baseline, diff, drift }
}

export type VersionDerivations = ReturnType<typeof createVersions>
