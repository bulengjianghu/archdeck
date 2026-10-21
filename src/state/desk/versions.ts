/**
 * DeskState 的版本派生（desk.versions，ADR-0013）：设计列表、当前设计与轮次、对比基线、差异与基线漂移（E1–E4）。
 */
import { computed, type ShallowRef } from 'vue'
import { diffModels, type DesignInfo, type ModelDiff, type ModelIndex, type VersionRef } from '@/model'
import type { ViewState } from '../transition'
import type { Baseline } from '../sync/modelSource'

export interface VersionsInputs {
  state: ShallowRef<ViewState>
  index: ShallowRef<ModelIndex | null>
  designs: ShallowRef<DesignInfo[]>
  baselines: ShallowRef<{ current?: Baseline; previous?: Baseline }>
  /** 打开的设计版本；当前版本时为 undefined */
  version?: VersionRef
}

export function createVersions({ state, index, designs, baselines, version }: VersionsInputs) {
  /** 打开的设计（当前版本时为 null） */
  const design = computed(() => (version ? (designs.value.find(d => d.id === version.design) ?? null) : null))
  const revision = computed(() => design.value?.revisions.find(r => r.id === version!.revision) ?? null)
  /** E3：对比基线为当前版本或上一轮 */
  const baseline = computed<Baseline | null>(() => {
    const b = baselines.value
    return (state.value.toggles.compareTo === 'previous' ? b.previous : undefined) ?? b.current ?? null
  })
  /** 设计版本相对对比基线的差异；当前版本时为 null */
  const diff = computed<ModelDiff | null>(() => (index.value && baseline.value ? diffModels(baseline.value.index, index.value) : null))
  /** E4：设计起草时的基线提交与当前版本不一致——当前版本已按新代码重新生成 */
  const drift = computed(() => {
    const was = design.value?.base?.commit
    const now = baselines.value.current?.index.model.system.source?.commit
    return !!was && !!now && was !== now
  })

  return { designs, design, revision, baselines, baseline, diff, drift }
}

export type VersionDerivations = ReturnType<typeof createVersions>
