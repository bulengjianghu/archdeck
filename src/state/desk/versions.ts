/**
 * DeskState 的版本派生（desk.versions，ADR-0013）：设计列表、当前设计与轮次、提交版本、对比基线、差异与基线漂移（E1–E6）。
 */
import { computed, type ShallowRef } from 'vue'
import {
  diffModels,
  isCommitVersion,
  isDesignVersion,
  isSketchRevision,
  type DesignInfo,
  type ModelCommit,
  type ModelDiff,
  type ModelIndex,
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
  baselines: ShallowRef<{ current?: Baseline; previous?: Baseline }>
  /** 打开的设计版本或提交版本；当前版本时为 undefined */
  version?: VersionRef
  /** DV-10：草图版本的「交给 AI」指令 */
  sketchPrompt: ShallowRef<string>
}

/** 草图的对比基线：相对基线 / 相对当前版本 */
export type SketchCompare = 'baseline' | 'current'

export function createVersions({ state, index, designs, commits, baselines, version, sketchPrompt }: VersionsInputs) {
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
  /** 相对对比基线的差异；当前版本时为 null */
  const diff = computed<ModelDiff | null>(() => (index.value && baseline.value ? diffModels(baseline.value.index, index.value) : null))
  /**
   * 草图的两种对比（F-62）：相对基线（我改了什么）与相对当前版本（实现还差什么）的基线与差异。
   * 底稿的基线快照还没接入，两者都先指向当前版本；接入后只改这里，信息条的弹层不用动。
   */
  const sketchBaselines = computed<Record<SketchCompare, Baseline | null>>(() => ({
    baseline: baselines.value.current ?? null,
    current: baselines.value.current ?? null,
  }))
  const sketchDiffs = computed<Record<SketchCompare, ModelDiff | null>>(() => {
    const of = (b: Baseline | null) => (b === baseline.value ? diff.value : b && index.value ? diffModels(b.index, index.value) : null)
    return { baseline: of(sketchBaselines.value.baseline), current: of(sketchBaselines.value.current) }
  })
  /** E4：设计起草时的基线提交与当前版本不一致——当前版本已按新代码重新生成 */
  const drift = computed(() => {
    const was = design.value?.base?.commit
    const now = baselines.value.current?.index.model.system.source?.commit
    return !!was && !!now && was !== now
  })

  return { designs, design, revision, sketch, sketchPrompt, commits, commit, baseCommit, baselines, baseline, sketchBaselines, diff, sketchDiffs, drift }
}

export type VersionDerivations = ReturnType<typeof createVersions>
