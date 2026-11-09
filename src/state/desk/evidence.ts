/**
 * DeskState 的步骤证据派生（desk.evidence，S16、S17）：打开的场景每一帧的候选调用点与等级、选中步骤的证据、场景汇总，
 * 以及场景列表用的各场景无证据帧数。代码事实由源码同步取得，只对当前版本（K8）；计算调用模型层。
 * S18b（裁决 T0-10、T3-3）：帧的等级由它绑定的交互的承载判定导出（alignedLevel：齐全 ↔ 按名字匹配、模块级 / 缺段 ↔ 按模块依赖、
 * 无承载 ↔ 无证据、外部 ↔ 不判定），没有承载时为步骤证据的等级；时序图的「?」、场景面板计数、场景列表的「? N」与问题页签「步骤无证据」同一口径。
 */
import { computed, type ComputedRef, type ShallowRef } from 'vue'
import {
  alignedLevel,
  entryResolver,
  type Carrier,
  scenarioEvidence,
  type EvidenceLevel,
  type FileDep,
  type ModelIndex,
  type ScenarioEvidence,
  type ScenarioPlan,
  type StepEvidence,
} from '@/model'
import type { ViewState } from '../transition'
import type { SourceSyncPort } from './ports'
import type { FileDerivations } from './files'

export interface EvidenceInputs {
  state: ShallowRef<ViewState>
  index: ShallowRef<ModelIndex | null>
  plan: ComputedRef<ScenarioPlan | null>
  /** 任一场景的回放计划（场景列表的「? N」用；由协调者给出，这里不直接调用场景投影） */
  planOf: (index: ModelIndex, scenarioId: string) => ScenarioPlan
  files: FileDerivations
  sync: SourceSyncPort
  /** 设计版本没有代码事实（K8） */
  design: boolean
  /** K5d：交互的承载（desk.facts.carrierOf）；不给时按步骤证据（S16） */
  carrierOf?: (relationId: string) => Carrier | null
}

export function createEvidence({ state, index, plan, planOf, files, sync, design, carrierOf = () => null }: EvidenceInputs) {
  /** K1：文件依赖；没有代码事实时为 null */
  const deps = computed<readonly FileDep[] | null>(() => {
    const r = sync.facts.value
    return !design && r?.status === 'ok' ? r.value.deps.deps : null
  })
  const inputs = computed(() => {
    const idx = index.value
    const own = files.ownership.value
    const p = files.payload.value
    return idx && own && p?.status === 'local' && deps.value ? { idx, own, deps: deps.value, entryOf: entryResolver(idx, own, p) } : null
  })

  /** 打开的场景每一帧的证据与各等级计数（场景面板的汇总） */
  const scenario = computed<ScenarioEvidence | null>(() => {
    const i = inputs.value
    return i && plan.value ? scenarioEvidence(plan.value, i.idx, i.own, i.deps, i.entryOf) : null
  })
  /** S18b：一帧按承载对齐后的等级 */
  const aligned = (p: ScenarioPlan, id: string, level: EvidenceLevel): EvidenceLevel => {
    const r = p.frames.get(id)?.relation
    return alignedLevel(level, r ? carrierOf(r) : null)
  }
  /** 帧 → 等级（时序图的「?」，S17；按承载对齐，S18b） */
  const levels = computed<ReadonlyMap<string, EvidenceLevel> | null>(() => {
    const p = plan.value
    return scenario.value && p ? new Map([...scenario.value.frames].map(([id, e]) => [id, aligned(p, id, e.level)])) : null
  })
  /** 场景面板的各等级计数（按承载对齐） */
  const counts = computed<Record<EvidenceLevel, number> | null>(() => {
    const l = levels.value
    if (!l) return null
    const out: Record<EvidenceLevel, number> = { name: 0, module: 0, none: 0, skipped: 0 }
    for (const v of l.values()) out[v]++
    return out
  })
  /** 选中步骤（即进度所在的一帧，V7）的证据 */
  const step = computed<StepEvidence | null>(() => {
    const id = state.value.playback?.frameId
    return id ? (scenario.value?.frames.get(id) ?? null) : null
  })
  /** 场景列表的「? N」：各场景回放计划中无证据（按承载对齐）的帧数（没有的不列） */
  const unevidenced = computed<ReadonlyMap<string, number>>(() => {
    const i = inputs.value
    const out = new Map<string, number>()
    if (!i) return out
    for (const id of i.idx.scenarios.keys()) {
      const p = planOf(i.idx, id)
      const ev = scenarioEvidence(p, i.idx, i.own, i.deps, i.entryOf)
      const n = [...ev.frames].filter(([fid, e]) => aligned(p, fid, e.level) === 'none').length
      if (n) out.set(id, n)
    }
    return out
  })

  return { deps, scenario, levels, counts, step, unevidenced }
}

export type EvidenceDerivations = ReturnType<typeof createEvidence>
