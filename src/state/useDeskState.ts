/**
 * DeskState：协调者（docs/architecture/view-state.md §2）。
 * - 持有视图状态（一个值）、加载后的模型与对比基线；
 * - 唯一写入口 dispatch(action) → transition() → 写入新状态；对外的操作都是构造动作并 dispatch 的包装；
 * - 派生要画的数据：核心（层次、选中、视角、层次视图）平铺，领域派生分组——run 回放、files 源码、versions 版本、facts 架构治理、evidence 步骤证据、explainers 图解、evolution 演化事实（ADR-0013、ADR-0015、ADR-0023，见 ./desk/）；
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
  reworkScope as reworkScopeOf,
  reworkItemMarkdown,
  reworkMarkdown,
  type ReworkItem,
  type ReworkList,
  isDesignVersion,
  isSketchRevision,
  ROOT_MOUNT,
  type ModuleRole,
  type RuleKind,
  type TranscriptRecord,
} from '@/model'
import {
  DEFAULT_TOGGLES,
  encodeView,
  keyIntent,
  viewpointOf,
  selectedOf,
  transition,
  type CanvasMode,
  type Selection,
  type Toggles,
  type ImpactQuery,
  type ViewAction,
  type ViewState,
  EMPTY_WORKSPACE,
  docKey,
  hasTab,
  layoutContextOf,
  subjectOf,
  viewKey,
  workspaceTransition,
  type DocRef,
  type Subject,
  type ViewKind,
  type WorkspaceAction,
  type WorkspaceState,
} from './transition'
import { createRouterSync, type RouterSync, type RouterSyncOptions } from './sync/router'
import { attachWorkspaceMemory, type WorkspaceMemory } from './sync/workspaceMemory'
import { fetchAndLoad, watchModelChanges, type Baselines, type ChangeEvents, type DesignNote, type FetchModel } from './sync/modelSource'
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

export type { CanvasMode, ImpactQuery, Selection, Toggles, DocRef, Tab, TabGroup, ViewKind, Subject, LayoutContext, WorkspaceState } from './transition'
export type { ExplainerRefView, BasisChangeKind } from './desk/explainers'
export { encodeSelection, decodeSelection } from './transition'
export { isResident } from './transition'
export { browserMemory } from './sync/workspaceMemory'
export type { CompareSource, ModelPayload, FetchModel } from './sync/modelSource'
export type { SourceFetcher, Resource } from './sync/source'
export type { ModelWriter, WriteOutcome, SketchSaveOutcome, DesignSaveOutcome, DesignSketchWrite, ArchivePreview } from './sync/writer'

export type DeskOptions = RouterSyncOptions & {
  /** 被描述项目的源码（G1、G2）；缺省为没有源码来源（只看描述的测试） */
  source?: SourceFetcher
  /** 人拥有的文件的追加写入（B1–B5）；缺省没有写入来源 */
  writer?: ModelWriter
  /** 对话的 agent 通道（DA-11）；缺省没有（只看描述的测试） */
  agent?: AgentTransport
  /** LY-3、LY-11：工作区的本机记忆（人改过的排布、视图区与侧栏的开合宽度）；缺省不记 */
  memory?: WorkspaceMemory
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
  /** DL-3、DL-10：草图版本里设计的编号表与设计说明 */
  const payloadChanges = shallowRef<unknown>(undefined)
  const notes = shallowRef<DesignNote[]>([])
  /** DL-51：设计里落盘的对话（草图版本的载荷带来） */
  const transcript = shallowRef<TranscriptRecord[] | undefined>(undefined)
  /** DA-6：AI 正在修改草图（对话「改」的一轮在跑）——编辑分组据此只读；对话在编辑分组之后创建，这里先占位 */
  const aiEditing = shallowRef(false)
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
  /** LY-6：视角只有结构 / 交互；回放 = 交互 + playback（选中一个场景） */
  const viewpoint = computed(() => viewpointOf(state.value))
  /** 回放中（交互视角 + 一个场景） */
  const playing = computed(() => !!state.value.playback)
  /** V11：画布模式（回放中为进入前的模式，退出场景即回到它） */
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
      // L9：回放中舞台不受显示开关影响，并补齐场景帧端点的边界节点与参与者（P12）
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
    changesFile: () => payloadChanges.value,
    aiBusy: () => aiEditing.value,
    designInfo: () => {
      const v = options.version
      return isSketchRevision(v) ? designs.value.find(d => d.id === v.design) : undefined
    },
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
      // DL-45：当前版本上的核验按门禁口径（已认可未归档设计的偏差为提醒，与 lint:model、arch issues 同口径）
      ...(checks.length ? { sketches: checks, sketchGate: !options.version } : {}),
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
  /** LY-13：核对标签的系统 / 层汇总——这几棵子树里的返工项按五类计数（口径同返工清单） */
  function reworkScope(roots: readonly string[]) {
    const list = rework.value
    const idx = index.value
    return list && idx ? reworkScopeOf(list, idx, roots) : null
  }

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
  /**
   * N5：重新加载按发起先后算——文件变化与写入后的重新加载会并发，先发起、后返回的旧载荷不能盖住已经用上的新载荷（认可后迟到的旧状态曾把信息条回滚成「起草中」）；
   * 没有更新的结果落地时照常用上（不等「最后一次」：别处一直在改文件时那样会永远落不了地）
   */
  let reloadStarted = 0
  let reloadApplied = 0
  async function reload() {
    const n = ++reloadStarted
    try {
      const loaded = await fetchAndLoad(fetchModel)
      if (n < reloadApplied) return
      reloadApplied = n
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
      payloadChanges.value = loaded.payload.changes
      notes.value = loaded.payload.notes ?? []
      transcript.value = loaded.payload.transcript
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
      if (n < reloadApplied) return
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
  const select = (s: Selection | null) => void dispatch({ type: 'select', selection: s })
  const revealRelation = (id: string) => void dispatch({ type: 'revealRelation', id })
  const revealModule = (id: string) => void dispatch({ type: 'revealModule', id })
  const setHover = (id: string | null) => void dispatch({ type: 'hover', id })
  /** K15b：影响面查询（null =「不看」），一次性 */
  const queryImpact = (query: ImpactQuery | null) => void dispatch({ type: 'queryImpact', query })
  const setToggles = (patch: Partial<Toggles>) => void dispatch({ type: 'toggle', patch })
  const openScenario = (id: string) => void dispatch({ type: 'openScenario', id })
  const closeScenario = () => void dispatch({ type: 'closeScenario' })
  /** V11：切到结构 / 交互视角（回放中即退出场景） */
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

  // ── 工作区（LY，ADR-0064）：视图区的排布与开合是另一个值，只经 workspaceTransition 改变；不进 URL ──
  // 视图标签跟随主语（内容是（主语, 标签类型）的纯函数），这里没有「打开资料」的协调，只有：情境 → setContext（LY-11）、选中另一个文件 → 源代码预览（G15）
  const workspaceState = shallowRef<WorkspaceState>(EMPTY_WORKSPACE)
  const workspaceDispatch = (a: WorkspaceAction) => void (workspaceState.value = workspaceTransition(workspaceState.value, a))
  /** LY-11c：情境由视图状态（场景）与编辑会话推出 */
  const layoutContext = computed(() => layoutContextOf(!!playback.value, edit.active.value))
  watch(layoutContext, context => workspaceDispatch({ type: 'setContext', context }), { immediate: true })
  watch(
    () => files.selected.value,
    (path, was) => path && path !== was && workspaceDispatch({ type: 'open', doc: { kind: 'source', path } }),
    { immediate: true },
  )
  /** LY-7、LY-7a：主语——选中；没有时为当前层次的父模块，根层即系统 */
  const subject = computed<Subject | null>(() => (index.value ? subjectOf(state.value, index.value.rootId) : null))
  // ── 对话（DA-1、DL-12）：选中 / 视角 → 锚点；进入草图画布的对话标签由草图情境的排布给出（LY-11） ──
  const canvas = computed(() => (edit.active.value ? 'sketch' : viewpoint.value))
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
    history: () => transcript.value,
    // DA-6：草图里的「改」——锚点带当前张，请求带草图上下文，一轮说完应用到编辑会话（提议卡）
    sketch: {
      active: () => edit.active.value && edit.target?.kind === 'design',
      design: () => (edit.target?.kind === 'design' ? edit.target.design : undefined),
      mount: () => edit.session.value?.mount ?? null,
      context: () => edit.changes.context(),
      apply: (blocks, turn) => edit.changes.applyAgentRound(blocks, turn),
      nameOf: id => (id === ROOT_MOUNT ? (baselines.value.current?.index.model.system.name ?? id) : edit.nameOf(id)),
      lock: () => edit.statusLock.value,
      sheetHas: id => edit.sheetHas(id),
    },
  })
  // DA-6、ADR-0063 决策 10：AI 修改草图的一轮在跑时，编辑分组只读
  watch(
    () => dialogue.editing(),
    on => (aiEditing.value = on),
    { immediate: true },
  )

  /** DA-10、DL-10：设计说明——草图版本里设计的 notes/；存为设计说明（写端点）后重新加载并打开预览标签 */
  const noteDesign = isSketchRevision(options.version) ? options.version.design : null
  const notesGroup = {
    list: notes,
    design: noteDesign,
    open: (file: string) => workspaceDispatch({ type: 'open', doc: { kind: 'note', file } }),
    async save(input: { title: string; text: string; module?: string }): Promise<{ ok: true; file: string } | { ok: false; error: string }> {
      if (!noteDesign) return { ok: false, error: '设计说明只在设计的草图里存' }
      const r = await writer.saveNote({ design: noteDesign, ...input })
      if (!r.ok) return r
      await reload()
      workspaceDispatch({ type: 'open', doc: { kind: 'note', file: r.file } })
      return r
    },
  }

  const workspace = {
    state: workspaceState,
    context: layoutContext,
    dispatch: workspaceDispatch,
    /** 打开一份资料：不固定为预览标签（LY-8a） */
    open: (doc: DocRef, pin = false, group?: number) => workspaceDispatch({ type: 'open', doc, pin, ...(group === undefined ? {} : { group }) }),
    /** 这份资料是否已在视图区开着（任一组） */
    isOpen: (doc: DocRef) => hasTab(workspaceState.value, docKey(doc)),
    /** 视图里的引用请求看某个视图标签——激活它（视图标签常驻，LY-9；时序图只在场景里），视图区收起时展开 */
    showView: (view: ViewKind) => {
      if (workspaceState.value.collapsed) workspaceDispatch({ type: 'setCollapsed', collapsed: false })
      workspaceDispatch({ type: 'activate', id: viewKey(view) })
    },
  }

  if (options.memory) attachWorkspaceMemory(options.memory, workspaceState, workspaceDispatch)

  /**
   * LY-15、EX-5：看某个模块的图解 = 选中它（系统 = 回到根层、取消选中），并激活图解标签——视图标签跟随主语，没有「按模块开图解」
   */
  function readExplainer(id: string) {
    const idx = index.value
    if (!idx) return
    if (id === idx.rootId) {
      if (state.value.levelId !== idx.rootId) goTo(idx.rootId, null)
      else select(null)
    } else if (edit.active.value) select({ kind: 'module', id })
    else revealModule(id)
    workspace.showView('explainer')
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
    reworkScope,
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
    playing,
    viewpoint,
    mode,
    subject,
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
    notes: notesGroup,
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
    readExplainer,
  }
}

export type DeskState = ReturnType<typeof createDeskState>
