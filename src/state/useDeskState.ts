/**
 * DeskState：协调者（docs/architecture/view-state.md §2）。
 * - 持有视图状态（一个值）、加载后的模型与对比基线；
 * - 唯一写入口 dispatch(action) → transition() → 写入新状态；对外的操作都是构造动作并 dispatch 的包装；
 * - 派生要画的数据：核心（层次、选中、视角、层次视图）平铺，领域派生分组——run 运行视角、files 源码、versions 版本、facts 架构治理、evidence 步骤证据、explainers 图解、evolution 演化事实（ADR-0013、ADR-0015、ADR-0023，见 ./desk/）；
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
  type RawFile,
  type ScenarioPlan,
  reworkList,
  reworkItemMarkdown,
  reworkMarkdown,
  type ReworkItem,
  type ReworkList,
  isDesignVersion,
  isSketchRevision,
  type ModuleRole,
  type RuleKind,
} from '@/model'
import {
  DEFAULT_TOGGLES,
  encodeView,
  keyIntent,
  perspectiveOf,
  selectedOf,
  transition,
  type CanvasMode,
  type Selection,
  type Toggles,
  type ImpactQuery,
  type ViewAction,
  type ViewState,
  EMPTY_WORKSPACE,
  canvasStateOf,
  defaultDocFor,
  docKey,
  dockShown,
  workspaceTransition,
  type DocRef,
  type WorkspaceAction,
  type WorkspaceState,
} from './transition'
import { createRouterSync, type RouterSync, type RouterSyncOptions } from './sync/router'
import { fetchAndLoad, watchModelChanges, type Baselines, type ChangeEvents, type FetchModel } from './sync/modelSource'
import { createLayoutSync } from './sync/layout'
import { bandColumnsFor, layoutView, type LayoutOptions } from '@/layout/layout'
import { NO_SOURCE, createSourceSync, type SourceFetcher } from './sync/source'
import { NO_WRITER, type ModelWriter, type WriteOutcome } from './sync/writer'
import { createRun } from './desk/run'
import { createFiles } from './desk/files'
import { createVersions } from './desk/versions'
import { createFacts } from './desk/facts'
import { createReview } from './desk/review'
import { createEvolution } from './desk/evolution'
import { createIntent } from './desk/intent'
import { createEvidence } from './desk/evidence'
import { createEdit } from './desk/edit'
import { createExplainers } from './desk/explainers'
import { createDialogue, NO_AGENT, type AgentTransport } from './desk/dialogue'

export type { CanvasMode, ImpactQuery, Selection, Toggles, DocRef, DocTab, DocGroup, WorkspaceState } from './transition'
export { PROPS_WIDTH, propsPlacement, dockAppeared } from './transition'
export type { ExplainerRefView, BasisChangeKind } from './desk/explainers'
export { encodeSelection, decodeSelection } from './transition'
export type { CompareSource, ModelPayload, FetchModel } from './sync/modelSource'
export type { SourceFetcher, Resource } from './sync/source'
export type { ModelWriter, WriteOutcome, SketchSaveOutcome, DesignSaveOutcome, DesignSketchWrite } from './sync/writer'

export type DeskOptions = RouterSyncOptions & {
  /** 被描述项目的源码（G1、G2）；缺省为没有源码来源（只看描述的测试） */
  source?: SourceFetcher
  /** 人拥有的文件的追加写入（B1–B5）；缺省没有写入来源 */
  writer?: ModelWriter
  /** 对话的 agent 通道（DA-11）；缺省没有（只看描述的测试） */
  agent?: AgentTransport
}

export function createDeskState(fetchModel: FetchModel, options: DeskOptions = {}) {
  const status = ref<'loading' | 'ready' | 'error'>('loading')
  const loadError = ref<string>()
  const index = shallowRef<ModelIndex | null>(null)
  const issues = shallowRef<Issue[]>([])
  const modelDir = ref('')
  const designs = shallowRef<DesignInfo[]>([])
  const commits = shallowRef<ModelCommit[]>([])
  const baselines = shallowRef<Baselines>({})
  /** DV-10：草图版本的「交给 AI」指令 */
  const sketchPrompt = shallowRef('')
  /** X4：载荷附带的设计草图 */
  const sketches = shallowRef<{ design: string; file: RawFile }[]>([])
  /** 读到的描述的索引；编辑态下核心的 index 换成编辑中的草图的索引（desk.edit，ADR-0024） */
  const loadedIndex = shallowRef<ModelIndex | null>(null)
  /** 载荷的原文与草图文件的指纹（编辑态加载草图、保存时比对用） */
  const payloadFiles = shallowRef<RawFile[]>([])
  const payloadSketch = shallowRef<{ file: string; hash: string; path?: string } | undefined>(undefined)
  const payloadSketchFiles = shallowRef<{ mount?: string; file: string; path?: string; hash: string }[] | undefined>(undefined)
  const state = shallowRef<ViewState>({ levelId: '', selection: null, hover: null, toggles: DEFAULT_TOGGLES(RELATION_TYPES), playback: null })
  /** V12：最近一次模式切换映射不过去而清空的选中（面板说明原因）；下一次改变状态的动作即收回 */
  const droppedSelection = shallowRef<Selection | null>(null)
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
    const {
      state: next,
      history,
      dropped,
    } = transition(prev, action, {
      index: idx,
      plan: plan.value,
      levelView: view.value,
      scenarioView: run.scenarioView.value,
      editable: edit.editable,
      structurePair: facts.structurePair,
    })
    if (next === prev) return false
    droppedSelection.value = dropped ?? null
    state.value = next
    if (next.levelId !== prev.levelId) levelVersion.value++
    router?.write(encodeView(next, idx, plan.value), history)
    return true
  }

  // ── 派生 ──
  const levelId = computed(() => state.value.levelId)
  const selection = computed(() => state.value.selection)
  const hoverId = computed(() => state.value.hover)
  /** K15b：影响面查询；null =「不看」 */
  const impactQuery = computed(() => state.value.impactQuery ?? null)
  const playback = computed(() => state.value.playback)
  const levelPath = computed(() => (index.value && levelId.value ? (index.value.pathOf.get(levelId.value) ?? []) : []))
  /** 视角与选中（V1、V2、V7、V11），由视图状态推出 */
  const perspective = computed(() => perspectiveOf(state.value))
  /** V11：画布模式（运行视角下为进入前的模式，退出场景即回到它） */
  const mode = computed<CanvasMode>(() => state.value.mode ?? 'interaction')
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
  const editing = computed(() => !!state.value.editing)
  const view = computed<LevelView | null>(() => {
    const t = togglesNow.value
    // 草图画布（ADR-0025）自己布局，不走层次投影与 elk
    if (!index.value || !levelId.value || editing.value) return null
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
  // ── 领域派生（ADR-0013）──
  const files = createFiles({ state, index, view, sync: sourceSync, design: !!options.version })
  // 架构治理先于布局：结构边与交互边并集布局（L15），两个视角共用同一份布局（V12）
  /** C6：显示偏好「总是展开表面」——呈现层的本地偏好交来（意图），表面展开并进布局同步 */
  const surfaceAlways = shallowRef(false)
  const setSurfaceAlways = (on: boolean) => {
    if (surfaceAlways.value !== on) surfaceAlways.value = on
  }
  const facts = createFacts({ state, index, view, files, sync: sourceSync, design: !!options.version, sketches, surfaceAlways })
  const { positioned, pending: layoutPending } = createLayoutSync(view, layoutView, layoutOpts, facts.layoutLinks)
  // 步骤的代码证据（S16、S17）：时序图的「?」由 run 交给 Layout，所以先于 run 创建
  const evidence = createEvidence({ state, index, plan, planOf: planScenario, files, sync: sourceSync, design: !!options.version, carrierOf: facts.carrierOf })
  const run = createRun({ state, index, levelId, plan, view, positioned, fileOwners: files.owners, evidence: evidence.levels })
  const versions = createVersions({ state, index, designs, commits, baselines, version: options.version, sketchPrompt, sketches })
  const evolution = createEvolution({ state, index, view, files, facts, sync: sourceSync, design: !!options.version })
  const intent = createIntent({ index, designs, sketches, version: options.version })
  // ── 草图画布（X7，ADR-0024、ADR-0025）：只在草图版本上，打开即进入 ──
  const edit = createEdit({
    version: options.version,
    loaded: loadedIndex,
    files: payloadFiles,
    sketch: payloadSketch,
    sketchFiles: payloadSketchFiles,
    current: () => baselines.value.current?.index ?? null,
    // 持久草图交给 AI 时的改动摘要：与「去掉这张草图贡献后的当前版本」比（同服务端 intentChanges）；偏差仍相对当前版本
    handoffCurrent: () => baselines.value.own?.index ?? baselines.value.current?.index ?? null,
    hasBase: () => !!baselines.value.base,
    // X17：设计的基线——载荷给出 base.commit 那一版时用它，否则为当前版本（新建设计时底稿即从当前版本复制）
    baseline: () => baselines.value.base?.index ?? baselines.value.current?.index ?? null,
    prompt: () => sketchPrompt.value,
    selection: () => state.value.selection,
    showDiff: () => state.value.toggles.showDiff,
    levelPath: () => levelPath.value,
    dispatch: action => dispatch(action),
    show: idx => (index.value = idx),
    reload: () => reload(),
    writer: options.writer ?? NO_WRITER,
  })
  const allIssues = computed(() => [...issues.value, ...files.warnings.value, ...facts.gateIssues.value])
  /** W-6、Q7：返工清单——问题页签与画布角标；源码归属与代码事实只对当前版本（G9、K8），草图偏差对设计各轮也有（X4） */
  const rework = computed<ReworkList | null>(() => {
    const idx = index.value
    if (!idx) return null
    const p = files.payload.value
    const own = files.ownership.value
    const source = !options.version && own && p?.status === 'local' ? { own, tree: p } : undefined
    const report = options.version ? null : facts.report.value
    const evo = options.version ? null : evolution.stats.value
    const checks = intent.checks.value
    const deps = evidence.deps.value
    return reworkList({
      index: idx,
      issues: issues.value,
      ...(source ? { source } : {}),
      ...(report ? { report } : {}),
      ...(evo ? { evolution: evo } : {}),
      ...(checks.length ? { sketches: checks } : {}),
      ...(deps ? { deps } : {}),
      ...(facts.carriers.value ? { carriers: facts.carriers.value } : {}),
    })
  })
  // ── 写入人拥有的文件（B1–B5，ADR-0019）：只发意图，结果由文件变化推送回来（N5）──
  const writer = options.writer ?? NO_WRITER
  const dv = isDesignVersion(options.version) ? options.version : undefined
  const write = {
    /** 设计的某一轮可记录评审意见（草图不是轮次）；当前版本可加例外与忽略项（B2–B4） */
    canFeedback: !!dv && !isSketchRevision(options.version),
    canEditRules: !options.version,
    feedback: (text: string): Promise<WriteOutcome> =>
      dv ? writer.feedback({ design: dv.design, revision: dv.revision, text }) : Promise.resolve({ ok: false, error: '只有设计版本能记录评审意见' }),
    allow: (input: { from: string; to: string; rule?: RuleKind; reason: string }): Promise<WriteOutcome> =>
      options.version ? Promise.resolve({ ok: false, error: '例外只加在当前版本' }) : writer.allow(input),
    ignore: (pattern: string): Promise<WriteOutcome> =>
      options.version ? Promise.resolve({ ok: false, error: '忽略项只加在当前版本' }) : writer.ignore({ pattern }),
    /** U11、M16：一键认可疑似共用件——写到 intent/roles.yaml，只对当前版本 */
    role: (module: string, role: ModuleRole): Promise<WriteOutcome> =>
      options.version ? Promise.resolve({ ok: false, error: '角色只在当前版本认可' }) : writer.role({ module, role }),
    /** X4：认可偏差——只对设计版本（轮次或草图）打开的那个设计 */
    canAccept: !!dv,
    accept: (deviation: string, reason: string): Promise<WriteOutcome> =>
      dv ? writer.accept({ design: dv.design, deviation, reason }) : Promise.resolve({ ok: false, error: '只有设计版本能认可偏差' }),
    /** X3：归档 / 晋升——对设计版本打开的那个设计，以当前版本的核验为准 */
    archive: (): Promise<WriteOutcome> => (dv ? writer.archive({ design: dv.design }) : Promise.resolve({ ok: false, error: '只有设计版本能归档' })),
  }
  // ── 人确认层（Z1–Z6，ADR-0023）：确认状态的派生与确认的写入意图；只对当前版本 ──
  const review = createReview({ index, version: options.version, writer })
  const explainers = createExplainers({ index })

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
      sketchPrompt.value = loaded.payload.sketchPrompt ?? ''
      sketches.value = loaded.payload.sketches ?? []
      baselines.value = loaded.baselines
      payloadFiles.value = loaded.payload.files
      payloadSketch.value = loaded.payload.sketch
      payloadSketchFiles.value = loaded.payload.sketchFiles
      loadedIndex.value = loaded.model.index
      index.value = edit.onReloaded()
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
    // X7a：草图版本打开即进入草图画布
    if (edit.editable) edit.enter()
    levelVersion.value++
  }

  // ── 操作：构造动作并 dispatch ──
  const drillInto = (id: string) => dispatch({ type: 'drill', id })
  const goTo = (id: string, select?: Selection | null) => void dispatch({ type: 'goTo', id, select })
  const goUp = () => void dispatch({ type: 'goUp' })
  /** 最近一次选中的来源：'explainer' = 图解 iframe 的 arch:select（EX-3：画布选中、资料区不动，自动打开图解要豁免） */
  const selectSource = ref<'explainer' | null>(null)
  /** 最近一次选中是否来自用户操作包装器（画布 / 树 / 搜索）：是则自动打开走稳定窗，否则（URL 同步）立即打开 */
  let viaWrapper = false
  const select = (s: Selection | null, source: 'explainer' | null = null) => {
    selectSource.value = source
    viaWrapper = true
    void dispatch({ type: 'select', selection: s })
  }
  const revealRelation = (id: string) => void dispatch({ type: 'revealRelation', id })
  const revealModule = (id: string, source: 'explainer' | null = null) => {
    selectSource.value = source
    viaWrapper = true
    void dispatch({ type: 'revealModule', id })
  }
  const setHover = (id: string | null) => void dispatch({ type: 'hover', id })
  /** K15b：影响面查询（null =「不看」），一次性 */
  const queryImpact = (query: ImpactQuery | null) => void dispatch({ type: 'queryImpact', query })
  const setToggles = (patch: Partial<Toggles>) => void dispatch({ type: 'toggle', patch })
  const openScenario = (id: string) => void dispatch({ type: 'openScenario', id })
  const closeScenario = () => void dispatch({ type: 'closeScenario' })
  /** V11：切到结构 / 交互视角（运行视角下即退出场景） */
  const setMode = (m: CanvasMode) => void dispatch({ type: 'setMode', mode: m })
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

  // ── 工作区（WS，ADR-0054）：资料区与属性栏开关是另一个值，只经 workspaceTransition 改变；不进 URL ──
  const workspaceState = shallowRef<WorkspaceState>(EMPTY_WORKSPACE)
  const workspaceDispatch = (a: WorkspaceAction) => void (workspaceState.value = workspaceTransition(workspaceState.value, a))
  // WS-8：资料区不跟随选中；只把「打开场景 / 退出场景 / 选中另一个文件」翻译成打开资料（G15）。描述重新加载后场景与文件不变，不再打开
  watch(
    () => playback.value?.scenarioId ?? null,
    (id, was) => {
      const doc = defaultDocFor('run', { hasExplainer: explainers.has })
      if (id && id !== was && doc) workspaceDispatch({ type: 'open', doc, pin: true })
      else if (!id && was) workspaceDispatch({ type: 'closeDoc', id: 'seq' })
    },
    { immediate: true },
  )
  watch(
    () => files.selected.value,
    (path, was) => path && path !== was && workspaceDispatch({ type: 'open', doc: { kind: 'source', path } }),
    { immediate: true },
  )
  // WS-8 的例外（第十八轮走查 4，ADR-0061；第二十轮读先方案扩展）：结构 / 交互视角下选中变为任何模块 → 辅助栏打开它的理解页
  // （事实卡 + 有图解时的故事），让「选中即理解」零点击。已在资料区开着（含固定）不再动；运行视角的资料区归时序图与步骤节、
  // 草图编辑不打开；图解 iframe 里点链接来的选中带 source: 'explainer'（EX-3：正在读父图解，资料区不动），来源标记消费后即复位
  let openTimer: ReturnType<typeof setTimeout> | undefined
  watch(selected, s => {
    const source = selectSource.value
    const user = viaWrapper
    selectSource.value = null
    viaWrapper = false
    clearTimeout(openTimer)
    if (!s || s.kind !== 'module' || source === 'explainer') return
    // DL-4：查缺省主语表——选中只驱动「题解」那一格；运行视角的时序图跟场景（上面的 watcher）、草图的对话跟编辑会话（下面的 watcher）
    const storyFor = () => {
      const doc = defaultDocFor(canvasStateOf(perspective.value, edit.active.value), { module: s.id, hasExplainer: explainers.has })
      return doc && (doc.kind === 'explainer' || doc.kind === 'facts') ? doc : null
    }
    const doc = storyFor()
    if (!doc) return
    if (workspaceState.value.groups.some(g => g.tabs.some(t => t.id === docKey(doc)))) return
    const openNow = () => {
      if (selected.value !== s || !storyFor()) return
      if (workspaceState.value.groups.some(g => g.tabs.some(t => t.id === docKey(doc)))) return
      workspaceDispatch({ type: 'open', doc })
    }
    // URL 直达 / 状态同步来的选中立即打开（资料区在首次适应之前就位，缩放只取一个值）；
    // 用户点选走 250ms 稳定窗：双击下钻、连续点选期间资料区不重排（画布几何稳定是交互的前提）
    if (user) openTimer = setTimeout(openNow, 250)
    else openNow()
  })
  // ── 对话（DA-1、DL-4、DL-12）：选中 / 视角 → 锚点；进入草图画布按主语表打开并固定对话 ──
  const canvas = computed(() => canvasStateOf(perspective.value, edit.active.value))
  const dialogueDoc = () => defaultDocFor('sketch', { hasExplainer: explainers.has }) ?? { kind: 'dialogue' as const }
  const dialogue = createDialogue({
    project: options.project,
    index,
    selection: selected,
    step: computed(() => {
      const f = run.frame.value
      const sc = playback.value?.scenarioId
      return f && sc ? { scenario: sc, frame: { id: f.id, from: f.from, to: f.to, ...(f.label ? { label: f.label } : {}) } } : null
    }),
    perspective: canvas,
    transport: options.agent ?? NO_AGENT,
    openTab: () => workspaceDispatch({ type: 'open', doc: { kind: 'dialogue' }, pin: true }),
  })
  watch(canvas, (c, was) => {
    if (c === was) return
    const doc = defaultDocFor(c, { hasExplainer: explainers.has })
    if (doc?.kind === 'dialogue') workspaceDispatch({ type: 'open', doc: dialogueDoc(), pin: true })
  })

  const workspace = {
    state: workspaceState,
    dockShown: computed(() => dockShown(workspaceState.value)),
    dispatch: workspaceDispatch,
    /** 打开一份资料：不固定为预览标签（WS-5） */
    open: (doc: DocRef, pin = false) => workspaceDispatch({ type: 'open', doc, pin }),
    /** 这份资料是否已在资料区开着（任一组；PC-9 的「已打开」） */
    isOpen: (doc: DocRef) => workspaceState.value.groups.some(g => g.tabs.some(t => t.id === docKey(doc))),
    setProps: (open: boolean) => workspaceDispatch({ type: 'setProps', open }),
  }

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
    setSurfaceAlways,
    write,
    modelDir,
    levelId,
    levelPath,
    selection,
    selected,
    hoverId,
    impactQuery,
    perspective,
    mode,
    droppedSelection,
    toggles,
    view,
    positioned,
    layoutPending,
    levelVersion,
    playback,
    // 领域派生
    run,
    files,
    versions,
    facts,
    review,
    explainers,
    evolution,
    intent,
    evidence,
    edit,
    workspace,
    dialogue,
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
    queryImpact,
    setToggles,
    pressKey,
    openScenario,
    closeScenario,
    setMode,
    next,
    prev,
    seek,
    chooseBranch,
    selectFile,
  }
}

export type DeskState = ReturnType<typeof createDeskState>
