/**
 * DeskState 的演化事实派生（desk.evolution，ADR-0023）：git 历史由源码同步取得，模块统计、时间耦合与本层投影调用模型层（J1–J8）。
 * 只对当前版本（J1）；画布叠加只在结构视角、热度或耦合任一开启时（J5），开关在视图状态里、按项目记在本地（呈现层恢复）。
 */
import { computed, type ComputedRef, type ShallowRef } from 'vue'
import {
  coupleEnds,
  couplingBetween,
  couplingsOf,
  evolutionStats,
  historyOptions,
  hotspots,
  isolatedCouplings,
  levelEvolution,
  type Coupling,
  type EvolutionStats,
  type HeatKind,
  type HistoryCommit,
  type LevelCoupling,
  type LevelEvolution,
  type LevelView,
  type ModelIndex,
  type ModuleHistory,
  type OkHistory,
} from '@/model'
import type { ViewState } from '../transition'
import type { createSourceSync } from '../sync/source'
import type { FactsDerivations } from './facts'
import type { FileDerivations } from './files'

export interface EvolutionInputs {
  state: ShallowRef<ViewState>
  index: ShallowRef<ModelIndex | null>
  view: ComputedRef<LevelView | null>
  files: FileDerivations
  facts: FactsDerivations
  sync: ReturnType<typeof createSourceSync>
  /** 设计版本与提交版本没有演化事实（J1） */
  design: boolean
}

/** 为什么没有演化事实，或正在取；源码清单读取失败、不在 git 仓库内都是 error（带原因） */
export type EvolutionStatus = 'ready' | 'loading' | 'design' | 'error'

/** J7：选中的耦合线 */
export interface SelectedCouple {
  a: string
  b: string
  /** 这对模块的耦合；历史刷新后已不满足阈值时为 null */
  coupling: Coupling | null
  /** 本层上画出它的耦合线；层次变化后本层没有时为 null */
  line: LevelCoupling | null
}

export function createEvolution({ state, index, view, files, facts, sync, design }: EvolutionInputs) {
  const resource = sync.history
  const history = computed<OkHistory | null>(() => (resource.value?.status === 'ok' && resource.value.value.status === 'ok' ? resource.value.value : null))
  const status = computed<EvolutionStatus>(() => {
    if (design) return 'design'
    const r = resource.value
    if (!r) return files.payload.value === null ? 'loading' : 'error'
    if (r.status === 'loading') return 'loading'
    return r.status === 'ok' && r.value.status === 'ok' ? 'ready' : 'error'
  })
  const error = computed(() => {
    const p = files.payload.value
    if (p?.status === 'error') return p.reason
    const r = resource.value
    if (r?.status === 'error') return r.message
    if (r?.status === 'ok' && r.value.status === 'error') return r.value.reason
    return null
  })
  /** J1、J4：描述里的窗口与阈值 */
  const options = computed(() => historyOptions(index.value?.model.system))

  const stats = computed<EvolutionStats | null>(() => {
    const h = history.value
    if (design || !h || !index.value || !files.ownership.value) return null
    return evolutionStats(index.value, files.ownership.value, h, files.lines.value, facts.report.value, options.value.coupling)
  })

  /** J5：结构视角、热度或耦合任一开启时的本层投影；热度关闭时没有角标，耦合关闭时没有耦合线 */
  const level = computed<LevelEvolution | null>(() => {
    const t = state.value.toggles
    if (!stats.value || !index.value || !view.value || state.value.playback || (t.heat === 'off' && !t.coupling)) return null
    const lv = levelEvolution(index.value, view.value, stats.value, t.heat === 'off' ? 'changes' : t.heat)
    return { kind: lv.kind, heat: t.heat === 'off' ? new Map() : lv.heat, couplings: t.coupling ? lv.couplings : [] }
  })

  /** J7：选中的耦合线 */
  const selectedCouple = computed<SelectedCouple | null>(() => {
    const s = state.value.selection
    if (s?.kind !== 'couple') return null
    const ends = coupleEnds(s.id)
    if (!ends) return null
    const coupling = stats.value?.couplings.find(c => c.id === s.id) ?? null
    const line = level.value?.couplings.find(l => l.pairs.includes(s.id)) ?? null
    return { a: ends[0], b: ends[1], coupling, line }
  })

  /** J2、J3：一个模块的统计；没有演化事实时为 null */
  const moduleOf = (id: string): ModuleHistory | null => stats.value?.modules.get(id) ?? null
  /** J4：一个模块参与的耦合对 */
  const couplingsFor = (id: string): Coupling[] => (stats.value ? couplingsOf(stats.value, id) : [])
  /** J7：两个模块之间的耦合（关系与聚合边面板的「同提交 ×N」） */
  const between = (a: string, b: string): Coupling | undefined => (stats.value ? couplingBetween(stats.value, a, b) : undefined)
  /** J8：热度前 N */
  const hotspotsOf = (kind: HeatKind, limit = 10): ModuleHistory[] => (stats.value ? hotspots(stats.value, kind, limit) : [])
  /** J6：无依赖无关系的耦合对 */
  const isolated = computed<Coupling[]>(() => (stats.value ? isolatedCouplings(stats.value) : []))
  /** 一条提交（哈希 → 记录） */
  const commitOf = (hash: string): HistoryCommit | undefined => history.value?.commits.find(c => c.hash === hash)

  return {
    status,
    error,
    options,
    history,
    stats,
    level,
    selectedCouple,
    moduleOf,
    couplingsFor,
    between,
    hotspotsOf,
    isolated,
    commitOf,
    commitMessage: sync.commit,
  }
}

export type EvolutionDerivations = ReturnType<typeof createEvolution>
