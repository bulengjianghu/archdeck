/**
 * DeskState：协调者（docs/architecture/view-state.md §2）。
 * - 持有视图状态（一个值）、加载后的模型与对比基线；
 * - 唯一写入口 dispatch(action) → transition() → 写入新状态；对外的操作都是构造动作并 dispatch 的包装；
 * - 派生要画的数据（层次视图、差异……）；
 * - 与外界的交互交给同步适配器：路由（sync/router）、模型源（sync/modelSource）、布局（sync/layout）。
 * 呈现层只读这里的状态、只调这里的操作，不直接调用模型层的计算。
 */
import { computed, getCurrentScope, onScopeDispose, ref, shallowRef } from 'vue'
import type { Router } from 'vue-router'
import {
  RELATION_TYPES,
  buildSequence,
  currentMessage,
  diffModels,
  participation,
  planScenario,
  projectLevel,
  projectScenario,
  resolvePath,
  scenarioHome,
  stageEnds,
  walkedCount,
  type Issue,
  type LevelView,
  type ModelDiff,
  type ModelIndex,
  type Participation,
  type ScenarioLevelView,
  type ScenarioPlan,
  type SequenceModel,
} from '@/model'
import type { DesignInfo, VersionRef } from '@/model/design'
import { layoutSequence, type PositionedSequence } from '@/layout/sequence'
import {
  DEFAULT_TOGGLES,
  encodeView,
  focusOf,
  keyIntent,
  perspectiveOf,
  transition,
  type Selection,
  type Speed,
  type Toggles,
  type ViewAction,
  type ViewState,
} from './transition'
import { createClockSync } from './sync/clock'
import { createRouterSync, type RouterSync, type RouterSyncOptions } from './sync/router'
import { fetchAndLoad, watchModelChanges, type Baseline, type ChangeEvents, type FetchModel } from './sync/modelSource'
import { createLayoutSync } from './sync/layout'

export type { Selection, Toggles } from './transition'
export { encodeSelection, decodeSelection } from './transition'
export type { CompareSource, ModelPayload, FetchModel } from './sync/modelSource'

export type DeskOptions = RouterSyncOptions

export function createDeskState(fetchModel: FetchModel, options: DeskOptions = {}) {
  const status = ref<'loading' | 'ready' | 'error'>('loading')
  const loadError = ref<string>()
  const index = shallowRef<ModelIndex | null>(null)
  const issues = shallowRef<Issue[]>([])
  const modelDir = ref('')
  const designs = shallowRef<DesignInfo[]>([])
  const baselines = shallowRef<{ current?: Baseline; previous?: Baseline }>({})
  const state = shallowRef<ViewState>({ levelId: '', selection: null, hover: null, toggles: DEFAULT_TOGGLES(RELATION_TYPES), playback: null })
  /** 每次层次切换递增，界面据此决定是否适应画布 */
  const levelVersion = ref(0)
  let router: RouterSync | null = null

  // ── 唯一写入口 ──
  /** 返回状态是否改变 */
  function dispatch(action: ViewAction): boolean {
    const idx = index.value
    if (!idx) return false
    const prev = state.value
    const { state: next, history } = transition(prev, action, { index: idx, plan: plan.value, levelView: view.value, scenarioView: scenarioView.value })
    if (next === prev) return false
    state.value = next
    if (next.levelId !== prev.levelId) levelVersion.value++
    router?.write(encodeView(next, idx, plan.value), history)
    return true
  }

  // ── 派生 ──
  const levelId = computed(() => state.value.levelId)
  const selection = computed(() => state.value.selection)
  const hoverId = computed(() => state.value.hover)
  const playback = computed(() => state.value.playback)
  const levelPath = computed(() => (index.value && levelId.value ? (index.value.pathOf.get(levelId.value) ?? []) : []))
  /** 视角与焦点（V1、V2），由视图状态推出 */
  const perspective = computed(() => perspectiveOf(state.value))
  const focus = computed(() => focusOf(state.value))

  /** 打开的场景的回放计划：只随场景与模型变化 */
  const scenarioId = computed(() => state.value.playback?.scenarioId ?? null)
  const plan = computed<ScenarioPlan | null>(() => (index.value && scenarioId.value ? planScenario(index.value, scenarioId.value) : null))
  const scenario = computed(() => (scenarioId.value ? (index.value?.scenarios.get(scenarioId.value) ?? null) : null))

  const view = computed<LevelView | null>(() => {
    const t = state.value.toggles
    if (!index.value || !levelId.value) return null
    try {
      // L9：运行视角下舞台不受显示开关影响，并补齐场景帧端点的边界节点与参与者（P12）
      if (plan.value) return projectLevel(index.value, levelId.value, { showBoundaries: true, mergeTypes: true, scenarioEnds: stageEnds(plan.value) })
      return projectLevel(index.value, levelId.value, {
        showBoundaries: t.showBoundaries,
        currentOnly: t.currentOnly,
        mergeTypes: true,
        relationTypes: t.relationTypes.length === RELATION_TYPES.length ? undefined : t.relationTypes,
      })
    } catch {
      return null
    }
  })
  const positioned = createLayoutSync(view)

  // ── 运行视角的派生：回放路径 → 本层帧投影 → 时序模型 → 时序图坐标 ──
  const choices = computed(() => state.value.playback?.choices ?? new Map<string, number>())
  const path = computed(() => (plan.value ? resolvePath(plan.value, choices.value) : null))
  const scenarioView = computed<ScenarioLevelView | null>(() =>
    index.value && plan.value && view.value ? projectScenario(index.value, view.value, plan.value, choices.value) : null,
  )
  const home = computed(() => (index.value && plan.value ? scenarioHome(index.value, plan.value) : null))
  /** 播放头所在的可见消息序号；尚未开始或本层不可见时为 null */
  const currentIndex = computed(() => (scenarioView.value ? currentMessage(scenarioView.value, state.value.playback?.frameId ?? null) : null))
  /** 从头播放到播放头为止走过的可见消息数 */
  const walked = computed(() => (scenarioView.value ? walkedCount(scenarioView.value, state.value.playback?.frameId ?? null) : 0))
  const frame = computed(() => {
    const id = state.value.playback?.frameId
    return id && plan.value ? (plan.value.frames.get(id) ?? null) : null
  })
  const sequence = computed<SequenceModel | null>(() =>
    index.value && plan.value && view.value && scenarioView.value ? buildSequence(index.value, view.value, plan.value, choices.value, scenarioView.value) : null,
  )
  const positionedSequence = computed<PositionedSequence | null>(() => {
    if (!sequence.value) return null
    const pv = positioned.value
    return layoutSequence(sequence.value, pv && pv.view.parentId === levelId.value ? pv : null)
  })
  /** 钉住对象在本场景中的参与（V6）；运行视角下有选中时才有 */
  const pinnedParticipation = computed<Participation | null>(() => {
    const s = state.value.selection
    if (!index.value || !path.value || !scenarioView.value || !s) return null
    return participation(index.value, path.value.frames, scenarioView.value, s, state.value.playback?.frameId)
  })

  /** 打开的设计（当前版本时为 null） */
  const design = computed(() => (options.version ? (designs.value.find(d => d.id === options.version!.design) ?? null) : null))
  const revision = computed(() => design.value?.revisions.find(r => r.id === options.version!.revision) ?? null)
  const baseline = computed<Baseline | null>(() => {
    const b = baselines.value
    return (state.value.toggles.compareTo === 'previous' ? b.previous : undefined) ?? b.current ?? null
  })
  /** 设计版本相对对比基线的差异；当前版本时为 null */
  const diff = computed<ModelDiff | null>(() => (index.value && baseline.value ? diffModels(baseline.value.index, index.value) : null))
  /** 设计起草时的基线提交与当前版本不一致：当前版本已按新代码重新生成 */
  const baseDrift = computed(() => {
    const was = design.value?.base?.commit
    const now = baselines.value.current?.index.model.system.source?.commit
    return !!was && !!now && was !== now
  })

  /** 开关：读取来自视图状态，写入即 dispatch(toggle)（呈现层可直接 v-model） */
  const toggles = new Proxy({} as Toggles, {
    get: (_, key) => state.value.toggles[key as keyof Toggles],
    set: (_, key, value) => {
      setToggles({ [key]: value } as Partial<Toggles>)
      return true
    },
    has: (_, key) => key in state.value.toggles,
    ownKeys: () => Reflect.ownKeys(state.value.toggles),
    getOwnPropertyDescriptor: (_, key) => ({ ...Reflect.getOwnPropertyDescriptor(state.value.toggles, key), configurable: true }),
  })

  // ── 加载（模型源同步）──
  async function reload() {
    try {
      const loaded = await fetchAndLoad(fetchModel)
      const prevIndex = index.value
      const previousPath = prevIndex && levelId.value ? (prevIndex.pathOf.get(levelId.value) ?? []) : []
      modelDir.value = loaded.payload.dir
      issues.value = loaded.model.issues
      designs.value = loaded.payload.designs ?? []
      baselines.value = loaded.baselines
      index.value = loaded.model.index
      status.value = 'ready'
      loadError.value = undefined
      // 首次加载由 init() 按 URL 决定层次；重新加载时保留层次与选中（N5）
      if (prevIndex) dispatch({ type: 'reloaded', previousPath })
    } catch (e) {
      status.value = index.value ? 'ready' : 'error'
      loadError.value = e instanceof Error ? e.message : String(e)
    }
  }

  // 时钟同步：播放中按速度到点 dispatch(tick)
  const stopClock = createClockSync(() => state.value.playback, () => void dispatch({ type: 'tick' }))
  if (getCurrentScope()) onScopeDispose(stopClock)

  /** 订阅本项目的描述变化（开发态 import.meta.hot），返回取消订阅函数 */
  function watchChanges(events: ChangeEvents | undefined) {
    return watchModelChanges(events, options.project, () => void reload())
  }

  function attachRouter(r: Router) {
    router?.stop()
    router = createRouterSync(r, options, query => dispatch({ type: 'restore', query }))
  }

  /** 首次加载：以 URL 为准 */
  async function init() {
    await reload()
    if (!index.value) return
    dispatch({ type: 'restore', query: router?.query() ?? {} })
    levelVersion.value++
  }

  // ── 操作：构造动作并 dispatch ──
  const drillInto = (id: string) => dispatch({ type: 'drill', id })
  const goTo = (id: string, select?: Selection | null) => void dispatch({ type: 'goTo', id, select })
  const goUp = () => void dispatch({ type: 'goUp' })
  const select = (s: Selection | null) => void dispatch({ type: 'select', selection: s })
  const revealRelation = (id: string) => void dispatch({ type: 'revealRelation', id })
  const revealModule = (id: string) => void dispatch({ type: 'revealModule', id })
  const setHover = (id: string | null) => void dispatch({ type: 'hover', id })
  const setToggles = (patch: Partial<Toggles>) => void dispatch({ type: 'toggle', patch })
  const openScenario = (id: string) => void dispatch({ type: 'openScenario', id })
  const closeScenario = () => void dispatch({ type: 'closeScenario' })
  const next = () => void dispatch({ type: 'next' })
  const prev = () => void dispatch({ type: 'prev' })
  const seek = (frameId: string) => void dispatch({ type: 'seek', frameId })
  const play = () => void dispatch({ type: 'play' })
  const pause = () => void dispatch({ type: 'pause' })
  const setSpeed = (value: Speed) => void dispatch({ type: 'speed', value })
  const chooseBranch = (pointId: string, option: number) => void dispatch({ type: 'chooseBranch', pointId, option })

  /** 键盘（N7、N9）：返回 'leave' 表示应回到项目列表，由呈现层导航 */
  function pressKey(key: string): 'leave' | boolean {
    const idx = index.value
    if (!idx) return false
    const intent = keyIntent(state.value, idx, key)
    if (intent === 'leave') return 'leave'
    return intent ? dispatch(intent) : false
  }

  return {
    project: options.project,
    version: options.version,
    // 状态（只读使用）
    state,
    status,
    loadError,
    index,
    issues,
    modelDir,
    levelId,
    levelPath,
    selection,
    hoverId,
    toggles,
    view,
    positioned,
    perspective,
    focus,
    playback,
    scenario,
    plan,
    path,
    scenarioView,
    home,
    currentIndex,
    walked,
    frame,
    sequence,
    positionedSequence,
    pinnedParticipation,
    levelVersion,
    designs,
    design,
    revision,
    baselines,
    baseline,
    diff,
    baseDrift,
    // 操作
    dispatch,
    init,
    reload,
    attachRouter,
    watchChanges,
    drillInto,
    goTo,
    goUp,
    select,
    revealRelation,
    revealModule,
    setHover,
    setToggles,
    pressKey,
    openScenario,
    closeScenario,
    next,
    prev,
    seek,
    play,
    pause,
    setSpeed,
    chooseBranch,
  }
}

export type DeskState = ReturnType<typeof createDeskState>
