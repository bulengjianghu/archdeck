/**
 * DeskState：协调者（docs/architecture/view-state.md §2）。
 * - 持有视图状态（一个值）、加载后的模型与对比基线；
 * - 唯一写入口 dispatch(action) → transition() → 写入新状态；对外的操作都是构造动作并 dispatch 的包装；
 * - 派生要画的数据（层次视图、差异……）；
 * - 与外界的交互交给同步适配器：路由（sync/router）、模型源（sync/modelSource）、布局（sync/layout）、源码（sync/source）。
 * 呈现层只读这里的状态、只调这里的操作，不直接调用模型层的计算。
 */
import { computed, ref, shallowRef } from 'vue'
import type { Router } from 'vue-router'
import {
  RELATION_TYPES,
  assignFiles,
  buildSequence,
  currentMessage,
  diffModels,
  fileNodes,
  fileTree,
  frameHome,
  landFrame,
  matchExports,
  moduleEntry,
  moduleFiles,
  outlineScenario,
  pairReturns,
  participation,
  planScenario,
  projectLevel,
  projectScenario,
  resolvePath,
  routeOf,
  scenarioHome,
  scenarioModules,
  sourceIssues,
  stageEnds,
  stepAfter,
  walkedCount,
  type DirNode,
  type ExportMatch,
  type ExportedSymbol,
  type FileNodes,
  type Issue,
  type LevelView,
  type ModuleEntry,
  type ModelDiff,
  type ModelIndex,
  type OutlineNode,
  type Participation,
  type ScenarioLevelView,
  type ScenarioPlan,
  type ReturnPairs,
  type RouteItem,
  type SequenceModel,
  type SourceOwnership,
} from '@/model'
import type { DesignInfo, VersionRef } from '@/model/design'
import { layoutSequence, type PositionedSequence } from '@/layout/sequence'
import { stageOverlay, type StageOverlay } from '@/layout/stage'
import {
  DEFAULT_TOGGLES,
  emphasisOf,
  encodeView,
  focusOf,
  keyIntent,
  perspectiveOf,
  transition,
  type Selection,
  type Toggles,
  type ViewAction,
  type ViewState,
} from './transition'
import { createRouterSync, type RouterSync, type RouterSyncOptions } from './sync/router'
import { fetchAndLoad, watchModelChanges, type Baseline, type ChangeEvents, type FetchModel } from './sync/modelSource'
import { createLayoutSync } from './sync/layout'
import { NO_SOURCE, createSourceSync, type SourceFetcher } from './sync/source'

export type { Selection, Toggles } from './transition'
export { encodeSelection, decodeSelection } from './transition'
export type { CompareSource, ModelPayload, FetchModel } from './sync/modelSource'
export type { SourceFetcher, Resource } from './sync/source'

export type DeskOptions = RouterSyncOptions & {
  /** 被描述项目的源码（G1、G2）；缺省等同构建态（不含源码） */
  source?: SourceFetcher
}

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
  const sourceSync = createSourceSync(options.source ?? NO_SOURCE)

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
  /** 停在分支点：路径在未选分支处截止，且播放头已在本层最后一条可见消息（F6） */
  const branchPoint = computed(() => {
    const pending = path.value?.pending
    if (!pending || !scenarioView.value) return null
    return stepAfter(scenarioView.value, state.value.playback?.frameId ?? null) === null ? pending : null
  })
  /** 当前帧在本层不可见时，能看到它的层次（R11） */
  const frameLevel = computed(() => (index.value && frame.value ? frameHome(index.value, frame.value) : null))
  /** 舞台叠加：参与的节点、走过的边、当前消息、未建模临时线、分支预览（V5） */
  const overlay = computed<StageOverlay | null>(() => {
    const pv = positioned.value
    if (!index.value || !scenarioView.value || !view.value || !pv || pv.view.parentId !== levelId.value) return null
    const bp = branchPoint.value
    const options = bp
      ? bp.options.map((o, k) => ({ option: k, label: o.when, landing: o.first ? landFrame(index.value!, view.value!, o.first) : null }))
      : []
    return stageOverlay(scenarioView.value, pv, state.value.playback?.frameId ?? null, options)
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
    if (!index.value || !path.value || !scenarioView.value || !s || s.kind === 'file') return null
    return participation(index.value, path.value.frames, scenarioView.value, s, state.value.playback?.frameId)
  })

  /** F7：调用与显式返回的配对，随计划算一次 */
  const pairs = computed<ReturnPairs | null>(() => (plan.value ? pairReturns(plan.value) : null))
  /** F6f：路线（路径上的分支点与所选，以及待选的分支点） */
  const route = computed<RouteItem[]>(() => (plan.value ? routeOf(plan.value, choices.value) : []))
  /** R15：焦点突出的本层可见消息序号；null 表示不突出 */
  const emphasis = computed(() => emphasisOf(state.value, scenarioView.value, pairs.value, pinnedParticipation.value))
  /** V5：参与本场景的舞台节点（时序图泳道）：path = 回放路径上的消息碰到它，other = 只在未选分支 / 未到达处 */
  const stageParticipants = computed<ReadonlyMap<string, 'path' | 'other'>>(() => {
    const out = new Map<string, 'path' | 'other'>()
    for (const m of sequence.value?.messages ?? []) {
      if (m.kind === 'empty') continue
      for (const id of [m.from, m.to]) if (m.status === 'path') out.set(id, 'path')
      else if (!out.has(id)) out.set(id, 'other')
    }
    return out
  })

  /** 导航树：步骤大纲（T6）与参与本场景的模块（T5），与层次、播放头无关 */
  const outline = computed<OutlineNode[]>(() => (plan.value ? outlineScenario(plan.value, choices.value) : []))
  const participants = computed<ReadonlySet<string>>(() => (index.value && plan.value ? scenarioModules(index.value, plan.value) : new Set()))

  // ── 源码（G）：清单由源码同步取得，归属与投影调用模型层 ──
  const source = sourceSync.tree
  const localSource = computed(() => (source.value?.status === 'local' ? source.value : null))
  const ownership = computed<SourceOwnership | null>(() =>
    index.value && localSource.value ? assignFiles(index.value, localSource.value.files, index.value.model.sourceIgnore) : null,
  )
  const sourceTree = computed<DirNode | null>(() => (localSource.value && ownership.value ? fileTree(localSource.value.files, ownership.value) : null))
  const selectedFile = computed(() => (state.value.selection?.kind === 'file' ? state.value.selection.id : null))
  /** 选中文件的归属模块（冲突时多个，G6） */
  const fileOwners = computed<string[]>(() => (selectedFile.value ? (ownership.value?.owners.get(selectedFile.value) ?? []) : []))
  /** G14：选中文件在当前层次的投影 */
  const fileHits = computed<FileNodes | null>(() =>
    index.value && view.value && selectedFile.value ? fileNodes(index.value, view.value, fileOwners.value) : null,
  )
  /** G13：选中模块的文件 */
  const moduleFileSet = computed<ReadonlySet<string>>(() => {
    const s = state.value.selection
    if (!index.value || !ownership.value || s?.kind !== 'module') return new Set()
    return new Set(moduleFiles(index.value, ownership.value, s.id))
  })
  const filesOf = (moduleId: string): string[] => (index.value && ownership.value ? moduleFiles(index.value, ownership.value, moduleId) : [])
  const entryOf = (moduleId: string): ModuleEntry | null =>
    index.value && ownership.value && localSource.value ? moduleEntry(index.value, ownership.value, localSource.value, moduleId) : null
  /** G12：入口导出与模块 provides 的对应 */
  const exportMatch = (moduleId: string, symbols: readonly ExportedSymbol[]): ExportMatch | null =>
    index.value ? matchExports(index.value, moduleId, symbols) : null
  /** 以某个文件为入口的模块 */
  const entryModulesOf = (file: string): string[] =>
    index.value && ownership.value ? index.value.model.modules.filter(m => entryOf(m.id)?.file === file).map(m => m.id) : []
  /** G9：归属警告只对当前版本报 */
  const sourceWarnings = computed<Issue[]>(() =>
    !options.version && index.value && ownership.value && localSource.value ? sourceIssues(index.value, ownership.value, localSource.value) : [],
  )
  const allIssues = computed(() => [...issues.value, ...sourceWarnings.value])

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
      if (prevIndex) {
        dispatch({ type: 'reloaded', previousPath })
        void sourceSync.refresh()
      }
    } catch (e) {
      status.value = index.value ? 'ready' : 'error'
      loadError.value = e instanceof Error ? e.message : String(e)
    }
  }

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
    void sourceSync.refresh()
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
  const seek = (frameId: string | null) => void dispatch({ type: 'seek', frameId })
  /** F6e、F6f：选分支；返回被丢弃的其他分支选择个数（界面据此提示） */
  const chooseBranch = (pointId: string, option: number): number => {
    const before = choices.value
    dispatch({ type: 'chooseBranch', pointId, option })
    return [...before.keys()].filter(k => k !== pointId && !choices.value.has(k)).length
  }
  const selectFile = (path: string) => select({ kind: 'file', id: path })

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
    outline,
    participants,
    pairs,
    route,
    emphasis,
    stageParticipants,
    branchPoint,
    frameLevel,
    overlay,
    levelVersion,
    source,
    ownership,
    sourceTree,
    selectedFile,
    fileOwners,
    fileHits,
    moduleFileSet,
    sourceWarnings,
    allIssues,
    filesOf,
    entryOf,
    exportMatch,
    entryModulesOf,
    sourceFile: sourceSync.file,
    sourceExports: sourceSync.exports,
    refreshSource: sourceSync.refresh,
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
    chooseBranch,
    selectFile,
  }
}

export type DeskState = ReturnType<typeof createDeskState>
