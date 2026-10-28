/**
 * DeskState 的运行视角派生（desk.run，ADR-0013）：回放路径 → 本层帧投影 → 时序模型 → 时序图坐标，
 * 以及舞台叠加、选中突出、配对、路线、步骤大纲与参与模块。全部是 computed，调用纯函数。
 */
import { computed, type ComputedRef, type Ref, type ShallowRef } from 'vue'
import {
  buildSequence,
  currentMessage,
  forEachStep,
  frameHome,
  landFrame,
  messagesOf,
  outlineScenario,
  pairReturns,
  participation,
  projectScenario,
  resolvePath,
  routeOf,
  scenarioHome,
  scenarioModules,
  stepAfter,
  triggerOf,
  walkedCount,
  type LevelView,
  type ModelIndex,
  type OutlineNode,
  type Participation,
  type ReturnPairs,
  type RouteItem,
  type ScenarioEntity,
  type ScenarioLevelView,
  type ScenarioPlan,
  type SequenceModel,
  type EvidenceLevel,
} from '@/model'
import type { PositionedView } from '@/layout/layout'
import { layoutSequence, type PositionedSequence } from '@/layout/sequence'
import { stageOverlay, type StageOverlay } from '@/layout/stage'
import { emphasisOf, type Emphasis, type ViewState } from '../transition'

export interface RunInputs {
  state: ShallowRef<ViewState>
  index: ShallowRef<ModelIndex | null>
  levelId: ComputedRef<string>
  plan: ComputedRef<ScenarioPlan | null>
  view: ComputedRef<LevelView | null>
  positioned: Ref<PositionedView | null>
  /** 选中文件的归属模块（选中突出用，R15） */
  fileOwners: ComputedRef<string[]>
  /** 各帧的证据等级（S17，时序图的「?」）；没有代码事实时为 null */
  evidence?: ComputedRef<ReadonlyMap<string, EvidenceLevel> | null>
}

export function createRun({ state, index, levelId, plan, view, positioned, fileOwners, evidence }: RunInputs) {
  const scenarioId = computed(() => state.value.playback?.scenarioId ?? null)
  const scenario = computed(() => (scenarioId.value ? (index.value?.scenarios.get(scenarioId.value) ?? null) : null))
  const frameId = () => state.value.playback?.frameId ?? null

  const choices = computed(() => state.value.playback?.choices ?? new Map<string, number>())
  const path = computed(() => (plan.value ? resolvePath(plan.value, choices.value) : null))
  const scenarioView = computed<ScenarioLevelView | null>(() =>
    index.value && plan.value && view.value ? projectScenario(index.value, view.value, plan.value, choices.value) : null,
  )
  const home = computed(() => (index.value && plan.value ? scenarioHome(index.value, plan.value) : null))
  /** 进度所在的可见消息序号；尚未开始或本层不可见时为 null */
  const currentIndex = computed(() => (scenarioView.value ? currentMessage(scenarioView.value, frameId()) : null))
  /** 从头播放到进度为止走过的可见消息数 */
  const walked = computed(() => (scenarioView.value ? walkedCount(scenarioView.value, frameId()) : 0))
  const frame = computed(() => {
    const id = frameId()
    return id && plan.value ? (plan.value.frames.get(id) ?? null) : null
  })
  /** 停在分支点：路径在未选分支处截止，且进度已在本层最后一条可见消息（F6） */
  const branchPoint = computed(() => {
    const pending = path.value?.pending
    if (!pending || !scenarioView.value) return null
    return stepAfter(scenarioView.value, frameId()) === null ? pending : null
  })
  /** 当前帧在本层不可见时，能看到它的层次（R11） */
  const frameLevel = computed(() => (index.value && frame.value ? frameHome(index.value, frame.value) : null))
  /** 舞台叠加：参与的节点、走过的边、当前消息、经由上层与未建模的临时线、分支预览（V5、P11、P15） */
  const overlay = computed<StageOverlay | null>(() => {
    const pv = positioned.value
    if (!index.value || !scenarioView.value || !view.value || !pv || pv.view.parentId !== levelId.value) return null
    const bp = branchPoint.value
    const options = bp ? bp.options.map((o, k) => ({ option: k, label: o.when, landing: o.first ? landFrame(index.value!, view.value!, o.first) : null })) : []
    return stageOverlay(scenarioView.value, pv, frameId(), options)
  })
  const sequence = computed<SequenceModel | null>(() =>
    index.value && plan.value && view.value && scenarioView.value
      ? buildSequence(index.value, view.value, plan.value, choices.value, scenarioView.value)
      : null,
  )
  const positionedSequence = computed<PositionedSequence | null>(() => {
    if (!sequence.value) return null
    const pv = positioned.value
    return layoutSequence(sequence.value, pv && pv.view.parentId === levelId.value ? pv : null, evidence?.value)
  })
  /** 选中对象（步骤、场景、文件以外）在本场景中的参与（V6）；运行视角下才有 */
  const selectionParticipation = computed<Participation | null>(() => {
    const s = state.value.selection
    if (
      !index.value ||
      !path.value ||
      !scenarioView.value ||
      !s ||
      s.kind === 'file' ||
      s.kind === 'dep' ||
      s.kind === 'couple' ||
      s.kind === 'port' ||
      s.kind === 'cycle'
    )
      return null
    return participation(index.value, path.value.frames, scenarioView.value, s, frameId())
  })

  /** F7：调用与显式返回的配对，随计划算一次 */
  const pairs = computed<ReturnPairs | null>(() => (plan.value ? pairReturns(plan.value) : null))
  /** F6f：路线（路径上的分支点与所选，以及待选的分支点） */
  const route = computed<RouteItem[]>(() => (plan.value ? routeOf(plan.value, choices.value) : []))
  /** R15、R16：选中突出——选中步骤的消息与配对消息、选中其他对象时突出的泳道；结构视角为 null */
  const emphasis = computed<Emphasis | null>(() =>
    index.value
      ? emphasisOf(state.value, {
          index: index.value,
          levelView: view.value,
          scenarioView: scenarioView.value,
          sequence: sequence.value,
          pairs: pairs.value,
          fileOwners: fileOwners.value,
        })
      : null,
  )
  /** V5：参与本场景的舞台节点（时序图泳道）：path = 回放路径上的消息碰到它，other = 只在未选分支 / 未到达处 */
  const stageParticipants = computed<ReadonlyMap<string, 'path' | 'other'>>(() => {
    const out = new Map<string, 'path' | 'other'>()
    for (const m of sequence.value?.messages ?? []) {
      if (m.kind === 'empty') continue
      for (const id of [m.from, m.to])
        if (m.status === 'path') out.set(id, 'path')
        else if (!out.has(id)) out.set(id, 'other')
    }
    return out
  })

  /** 导航树：步骤大纲（T6）与参与本场景的模块（T5），与层次、进度无关 */
  const outline = computed<OutlineNode[]>(() => (plan.value ? outlineScenario(plan.value, choices.value) : []))
  const participants = computed<ReadonlySet<string>>(() => (index.value && plan.value ? scenarioModules(index.value, plan.value) : new Set()))

  /** 场景列表（D-1、R4a）：全部场景及其触发者与消息条数，与是否在回放无关 */
  const catalog = computed<{ scenario: ScenarioEntity; trigger: string | undefined; messages: number }[]>(() => {
    const idx = index.value
    if (!idx) return []
    return [...idx.scenarios.values()].map(s => ({ scenario: s, trigger: triggerOf(idx, s.id), messages: messagesOf(idx.scenarios, s.id).length }))
  })
  /** 当前场景的触发者 */
  const trigger = computed(() => (index.value && scenario.value ? triggerOf(index.value, scenario.value.id) : undefined))
  /** 当前场景用 ref 引用的场景 ID */
  const refs = computed<string[]>(() => {
    const out = new Set<string>()
    if (scenario.value) forEachStep(scenario.value.steps, s => s.kind === 'ref' && out.add(s.scenario))
    return [...out]
  })
  /** 用 ref 引用了当前场景的场景 */
  const referencedBy = computed<ScenarioEntity[]>(() => {
    const id = scenarioId.value
    if (!index.value || !id) return []
    return [...index.value.scenarios.values()].filter(o => {
      let hit = false
      forEachStep(o.steps, s => (hit ||= s.kind === 'ref' && s.scenario === id))
      return hit
    })
  })

  return {
    scenario,
    catalog,
    trigger,
    refs,
    referencedBy,
    plan,
    choices,
    path,
    scenarioView,
    home,
    currentIndex,
    walked,
    frame,
    branchPoint,
    frameLevel,
    overlay,
    sequence,
    positionedSequence,
    participation: selectionParticipation,
    pairs,
    route,
    emphasis,
    stageParticipants,
    outline,
    participants,
  }
}

export type RunDerivations = ReturnType<typeof createRun>
