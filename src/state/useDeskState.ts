/**
 * DeskState：协调者（docs/architecture/view-state.md §2）。
 * - 持有视图状态（一个值）、加载后的模型与对比基线；
 * - 唯一写入口 dispatch(action) → transition() → 写入新状态；对外的操作都是构造动作并 dispatch 的包装；
 * - 派生要画的数据：核心（层次、选中、视角、层次视图）平铺，领域派生分组——run 运行视角、files 源码、versions 版本、facts 架构治理（ADR-0013、ADR-0015，见 ./desk/）；
 * - 与外界的交互交给同步适配器：路由（sync/router）、模型源（sync/modelSource）、布局（sync/layout）、源码（sync/source）。
 * 呈现层只读这里的状态、只调这里的操作，不直接调用模型层的计算。
 */
import { computed, ref, shallowRef, watch } from 'vue'
import type { Router } from 'vue-router'
import {
  RELATION_TYPES,
  planScenario,
  projectLevel,
  stageEnds,
  type DesignInfo,
  type ModelCommit,
  type Issue,
  type LevelView,
  type ModelIndex,
  type ScenarioPlan,
  reworkList,
  reworkItemMarkdown,
  reworkMarkdown,
  type ReworkItem,
  type ReworkList,
  isDesignVersion,
  type RuleKind,
} from '@/model'
import {
  DEFAULT_TOGGLES,
  encodeView,
  keyIntent,
  perspectiveOf,
  selectedOf,
  transition,
  type Selection,
  type Toggles,
  type ViewAction,
  type ViewState,
} from './transition'
import { createRouterSync, type RouterSync, type RouterSyncOptions } from './sync/router'
import { fetchAndLoad, watchModelChanges, type Baseline, type ChangeEvents, type FetchModel } from './sync/modelSource'
import { createLayoutSync } from './sync/layout'
import { bandColumnsFor, layoutView, type LayoutOptions } from '@/layout/layout'
import { NO_SOURCE, createSourceSync, type SourceFetcher } from './sync/source'
import { NO_WRITER, type ModelWriter, type WriteOutcome } from './sync/writer'
import { createRun } from './desk/run'
import { createFiles } from './desk/files'
import { createVersions } from './desk/versions'
import { createFacts } from './desk/facts'
import { createReview } from './desk/review'

export type { Selection, Toggles } from './transition'
export { encodeSelection, decodeSelection } from './transition'
export type { CompareSource, ModelPayload, FetchModel } from './sync/modelSource'
export type { SourceFetcher, Resource } from './sync/source'
export type { ModelWriter, WriteOutcome } from './sync/writer'

export type DeskOptions = RouterSyncOptions & {
  /** 被描述项目的源码（G1、G2）；缺省为没有源码来源（只看描述的测试） */
  source?: SourceFetcher
  /** 人拥有的文件的追加写入（B1–B5）；缺省没有写入来源 */
  writer?: ModelWriter
}

export function createDeskState(fetchModel: FetchModel, options: DeskOptions = {}) {
  const status = ref<'loading' | 'ready' | 'error'>('loading')
  const loadError = ref<string>()
  const index = shallowRef<ModelIndex | null>(null)
  const issues = shallowRef<Issue[]>([])
  const modelDir = ref('')
  const designs = shallowRef<DesignInfo[]>([])
  const commits = shallowRef<ModelCommit[]>([])
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
    const { state: next, history } = transition(prev, action, { index: idx, plan: plan.value, levelView: view.value, scenarioView: run.scenarioView.value })
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
  /** 视角与选中（V1、V2、V7），由视图状态推出 */
  const perspective = computed(() => perspectiveOf(state.value))
  const selected = computed(() => selectedOf(state.value))

  /** 打开的场景的回放计划：只随场景与模型变化 */
  const scenarioId = computed(() => state.value.playback?.scenarioId ?? null)
  const plan = computed<ScenarioPlan | null>(() => (index.value && scenarioId.value ? planScenario(index.value, scenarioId.value) : null))

  /** 层次视图只依赖层次、显示开关与打开的场景：悬停、选中、播放头变化时 togglesNow 的值不变，不引起重新投影与布局（ADR-0009） */
  const togglesNow = computed(() => state.value.toggles)
  /** O6：分层总览中临时展开的层（只属于这次浏览，不进视图状态与 URL）；层次变化即收起 */
  const expandedBands = shallowRef<string[]>([])
  watch(levelId, () => (expandedBands.value = []))
  const toggleBand = (layerId: string) =>
    (expandedBands.value = expandedBands.value.includes(layerId) ? expandedBands.value.filter(x => x !== layerId) : [...expandedBands.value, layerId])
  /** O7：带内列数随画布宽度变化（只在列数变化时重新布局） */
  const layoutOpts = shallowRef<LayoutOptions>({})
  const setCanvasWidth = (px: number) => {
    const bandColumns = bandColumnsFor(px)
    if (layoutOpts.value.bandColumns !== bandColumns) layoutOpts.value = { bandColumns }
  }
  const view = computed<LevelView | null>(() => {
    const t = togglesNow.value
    if (!index.value || !levelId.value) return null
    try {
      // L9：运行视角下舞台不受显示开关影响，并补齐场景帧端点的边界节点与参与者（P12）
      const expanded = expandedBands.value.length ? { expandedBands: expandedBands.value } : {}
      if (plan.value) return projectLevel(index.value, levelId.value, { showBoundaries: true, scenarioEnds: stageEnds(plan.value), ...expanded })
      return projectLevel(index.value, levelId.value, {
        ...expanded,
        showBoundaries: t.showBoundaries,
        currentOnly: t.currentOnly,
        relationTypes: t.relationTypes.length === RELATION_TYPES.length ? undefined : t.relationTypes,
      })
    } catch {
      return null
    }
  })
  const positioned = createLayoutSync(view, layoutView, layoutOpts)

  // ── 领域派生（ADR-0013）──
  const files = createFiles({ state, index, view, sync: sourceSync, design: !!options.version })
  const run = createRun({ state, index, levelId, plan, view, positioned, fileOwners: files.owners })
  const versions = createVersions({ state, index, designs, commits, baselines, version: options.version })
  const facts = createFacts({ state, index, view, files, sync: sourceSync, design: !!options.version })
  const allIssues = computed(() => [...issues.value, ...files.warnings.value, ...facts.gateIssues.value])
  /** W-6、Q7：返工清单——问题页签与画布角标；源码归属与代码事实只对当前版本（G9、K8） */
  const rework = computed<ReworkList | null>(() => {
    const idx = index.value
    if (!idx) return null
    const p = files.payload.value
    const own = files.ownership.value
    const source = !options.version && own && p?.status === 'local' ? { own, tree: p } : undefined
    const report = options.version ? null : facts.report.value
    return reworkList({ index: idx, issues: issues.value, ...(source ? { source } : {}), ...(report ? { report } : {}) })
  })
  // ── 写入人拥有的文件（B1–B5，ADR-0019）：只发意图，结果由文件变化推送回来（N5）──
  const writer = options.writer ?? NO_WRITER
  const dv = isDesignVersion(options.version) ? options.version : undefined
  const write = {
    /** 设计版本可记录评审意见；当前版本可加例外与忽略项（B2–B4） */
    canFeedback: !!dv,
    canEditRules: !options.version,
    feedback: (text: string): Promise<WriteOutcome> =>
      dv ? writer.feedback({ design: dv.design, revision: dv.revision, text }) : Promise.resolve({ ok: false, error: '只有设计版本能记录评审意见' }),
    allow: (input: { from: string; to: string; rule?: RuleKind; reason: string }): Promise<WriteOutcome> =>
      options.version ? Promise.resolve({ ok: false, error: '例外只加在当前版本' }) : writer.allow(input),
    ignore: (pattern: string): Promise<WriteOutcome> =>
      options.version ? Promise.resolve({ ok: false, error: '忽略项只加在当前版本' }) : writer.ignore({ pattern }),
  }
  // ── 人确认层（Z1–Z6，ADR-0023）：确认状态的派生与确认的写入意图；只对当前版本 ──
  const review = createReview({ index, version: options.version, writer })

  /** W-6、Q9：给 agent 的指令（Markdown）；不给返工项时为整份清单 */
  function reworkPrompt(item?: ReworkItem): string {
    const list = rework.value
    if (!list) return ''
    const p = files.payload.value
    const opts = { modelDir: modelDir.value, ...(p?.status === 'local' ? { sourceRoot: p.root } : {}) }
    return item ? reworkItemMarkdown(item, opts) : reworkMarkdown(list, `${index.value!.model.system.name}（${options.project ?? index.value!.rootId}）`, opts)
  }

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
      commits.value = loaded.payload.commits ?? []
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
    const before = run.choices.value
    dispatch({ type: 'chooseBranch', pointId, option })
    return [...before.keys()].filter(k => k !== pointId && !run.choices.value.has(k)).length
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
    // 核心（只读使用）
    state,
    status,
    loadError,
    index,
    issues,
    allIssues,
    rework,
    reworkPrompt,
    expandedBands,
    toggleBand,
    setCanvasWidth,
    write,
    modelDir,
    levelId,
    levelPath,
    selection,
    selected,
    hoverId,
    perspective,
    toggles,
    view,
    positioned,
    levelVersion,
    playback,
    // 领域派生
    run,
    files,
    versions,
    facts,
    review,
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
