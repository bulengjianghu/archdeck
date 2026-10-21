/**
 * DeskState 的架构治理派生（desk.facts，ADR-0015）：代码事实由源码同步取得，治理报告、本层投影与门禁问题调用模型层（K、U、Y）。
 * 只对当前版本、源码在本地时（K8）；画布叠加只在结构视角、「代码事实」开启时（K9）。
 */
import { computed, type ComputedRef, type ShallowRef } from 'vue'
import {
  depsBetween,
  describeModule,
  entryResolver,
  gateIssues as gateOf,
  governanceReport,
  levelFacts,
  summarizeLedger,
  type GovernanceReport,
  type Issue,
  type LedgerSummary,
  type LevelFacts,
  type LevelView,
  type ModelIndex,
  type ModuleDep,
  type ModuleDetail,
} from '@/model'
import type { ViewState } from '../transition'
import type { createSourceSync } from '../sync/source'
import type { FileDerivations } from './files'

export interface FactsInputs {
  state: ShallowRef<ViewState>
  index: ShallowRef<ModelIndex | null>
  view: ComputedRef<LevelView | null>
  files: FileDerivations
  sync: ReturnType<typeof createSourceSync>
  /** 设计版本没有代码事实（K8） */
  design: boolean
}

/** 为什么没有代码事实，或正在取 */
export type FactsStatus = 'ready' | 'loading' | 'design' | 'no-source' | 'error'

export function createFacts({ state, index, view, files, sync, design }: FactsInputs) {
  const resource = sync.facts
  const status = computed<FactsStatus>(() => {
    if (design) return 'design'
    const r = resource.value
    if (!r) return files.payload.value === null ? 'loading' : 'no-source'
    return r.status === 'ok' ? 'ready' : r.status === 'loading' ? 'loading' : 'error'
  })
  const error = computed(() => (resource.value?.status === 'error' ? resource.value.message : null))

  const report = computed<GovernanceReport | null>(() => {
    const r = resource.value
    const p = files.payload.value
    if (design || r?.status !== 'ok' || !index.value || !files.ownership.value || p?.status !== 'local') return null
    return governanceReport(index.value, files.ownership.value, p, r.value.deps, r.value.baseline)
  })

  /** K9、Y4：结构视角、开关开启时的本层投影 */
  const level = computed<LevelFacts | null>(() =>
    report.value && index.value && view.value && !state.value.playback && state.value.toggles.showFacts
      ? levelFacts(index.value, view.value, report.value)
      : null,
  )

  /** U9：进问题提示的只有门禁错误 */
  const gateIssues = computed<Issue[]>(() => (report.value ? gateOf(report.value) : []))

  /** Q4：拦截记录摘要 */
  const ledger = computed<LedgerSummary | null>(() => (resource.value?.status === 'ok' ? summarizeLedger(resource.value.value.ledger) : null))

  /** U4、Q1：入口文件（访问面用） */
  const entryOf = computed(() =>
    index.value && files.ownership.value && files.payload.value?.status === 'local'
      ? entryResolver(index.value, files.ownership.value, files.payload.value)
      : null,
  )

  /** K10：选中的代码依赖叠加线 */
  const selectedDep = computed(() => {
    const s = state.value.selection
    if (s?.kind !== 'dep' || !report.value || !index.value || !view.value) return null
    const [from, to] = s.id.split('->')
    return { from, to, detail: depsBetween(index.value, view.value, report.value, from, to) }
  })

  /** Q1：模块的治理信息（生效的规则、出入的违规与未描述依赖、所在的环） */
  const moduleDetail = (id: string): ModuleDetail | null =>
    report.value && index.value && files.ownership.value && entryOf.value
      ? describeModule(index.value, files.ownership.value, report.value, entryOf.value, id)
      : null

  /** K5：关系的证实与依据的模块依赖 */
  const relationFact = (id: string): { status: 'confirmed' | 'unconfirmed' | 'skipped'; deps: ModuleDep[]; host?: string } | null => {
    const c = report.value?.relations.get(id)
    return c ? { status: c.status, deps: c.deps.map(k => report.value!.moduleDeps.get(k)!).filter(Boolean), host: c.host } : null
  }

  return { status, error, report, level, gateIssues, ledger, entryOf, selectedDep, moduleDetail, relationFact }
}

export type FactsDerivations = ReturnType<typeof createFacts>
