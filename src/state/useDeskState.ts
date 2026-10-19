/**
 * DeskState：持有当前层次、选中对象、显示开关，对外提供唯一一组操作。
 * 层次与选中写进 URL（hash 路由），刷新或分享链接后回到同一视图。
 * 呈现层只读这里的状态、只调这里的操作，不直接调用模型层的计算。
 */
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import type { Router } from 'vue-router'
import {
  RELATION_TYPES,
  loadModel,
  lowestCommonAncestor,
  projectLevel,
  type Issue,
  type LevelView,
  type ModelIndex,
  type RawFile,
  type RelationType,
} from '@/model'
import { layoutView, type PositionedView } from '@/layout/layout'

export type Selection =
  | { kind: 'module'; id: string }
  | { kind: 'relation'; id: string }
  /** 视图里的一条边（多为聚合边），ID 见 edgeId() */
  | { kind: 'edge'; id: string }

export interface Toggles {
  showBoundaries: boolean
  currentOnly: boolean
  relationTypes: RelationType[]
}

export interface ModelPayload {
  /** 项目 ID；多项目时用于校验路由与变更通知 */
  project?: string
  dir: string
  files: RawFile[]
}

export type FetchModel = () => Promise<ModelPayload>

export function encodeSelection(s: Selection | null): string | undefined {
  if (!s) return undefined
  return `${s.kind[0]}:${s.id}`
}

export function decodeSelection(raw: unknown): Selection | null {
  if (typeof raw !== 'string') return null
  const m = /^([mre]):(.+)$/.exec(raw)
  if (!m) return null
  const kind = ({ m: 'module', r: 'relation', e: 'edge' } as const)[m[1] as 'm' | 'r' | 'e']
  return { kind, id: m[2] }
}

export interface DeskOptions {
  /** 所属项目；给出时只响应该项目路由（/p/<project>）上的变化 */
  project?: string
}

export function createDeskState(fetchModel: FetchModel, options: DeskOptions = {}) {
  const status = ref<'loading' | 'ready' | 'error'>('loading')
  const loadError = ref<string>()
  const index = shallowRef<ModelIndex | null>(null)
  const issues = shallowRef<Issue[]>([])
  const modelDir = ref('')
  const levelId = ref('')
  const selection = ref<Selection | null>(null)
  const hoverId = ref<string | null>(null)
  const toggles = reactive<Toggles>({ showBoundaries: true, currentOnly: false, relationTypes: [...RELATION_TYPES] })
  const positioned = shallowRef<PositionedView | null>(null)
  /** 每次层次切换递增，界面据此决定是否 fit */
  const levelVersion = ref(0)
  let router: Router | null = null
  let internalNav = 0

  const view = computed<LevelView | null>(() => {
    if (!index.value || !levelId.value) return null
    try {
      return projectLevel(index.value, levelId.value, {
        showBoundaries: toggles.showBoundaries,
        currentOnly: toggles.currentOnly,
        mergeTypes: true,
        relationTypes: toggles.relationTypes.length === RELATION_TYPES.length ? undefined : toggles.relationTypes,
      })
    } catch {
      return null
    }
  })

  const levelPath = computed(() => (index.value && levelId.value ? (index.value.pathOf.get(levelId.value) ?? []) : []))

  // 视图变化 → 重新布局；用序号丢弃过期的异步结果
  let layoutSeq = 0
  watch(view, async v => {
    const seq = ++layoutSeq
    if (!v) {
      positioned.value = null
      return
    }
    const result = await layoutView(v)
    if (seq === layoutSeq) positioned.value = result
  })

  // ── 加载 ──
  async function reload() {
    try {
      const payload = await fetchModel()
      const prevIndex = index.value
      const prevPath = prevIndex && levelId.value ? (prevIndex.pathOf.get(levelId.value) ?? []) : []
      const loaded = loadModel(payload.files)
      modelDir.value = payload.dir
      issues.value = loaded.issues
      index.value = loaded.index
      status.value = 'ready'
      loadError.value = undefined
      // 首次加载由 init() 按 URL 决定层次；重新加载时保留层次，若已不存在则退到最近的仍存在的上级
      if (prevIndex) {
        const keep = [...prevPath].reverse().find(id => loaded.index.pathOf.has(id))
        setLevel(keep ?? loaded.index.rootId, { history: false, keepSelection: true })
      }
    } catch (e) {
      status.value = index.value ? 'ready' : 'error'
      loadError.value = e instanceof Error ? e.message : String(e)
    }
  }

  function exists(s: Selection | null): boolean {
    if (!s || !index.value) return false
    if (s.kind === 'module') return index.value.modules.has(s.id) || s.id === index.value.rootId
    if (s.kind === 'relation') return index.value.relations.has(s.id)
    return true
  }

  // ── 操作 ──
  function setLevel(id: string, opts: { history?: boolean; keepSelection?: boolean; select?: Selection | null } = {}) {
    const idx = index.value
    if (!idx) return
    const target = idx.pathOf.has(id) ? id : idx.rootId
    const changed = target !== levelId.value
    levelId.value = target
    if (opts.select !== undefined) selection.value = opts.select
    else if (!opts.keepSelection || !exists(selection.value)) selection.value = null
    if (changed) {
      levelVersion.value++
      hoverId.value = null
    }
    syncUrl(opts.history ?? changed)
  }

  /** 双击下钻：只有有子模块时生效 */
  function drillInto(moduleId: string) {
    const kids = index.value?.childrenOf.get(moduleId) ?? []
    if (kids.length === 0) return false
    setLevel(moduleId, { history: true })
    return true
  }

  function goTo(id: string, select?: Selection | null) {
    setLevel(id, { history: true, select })
  }

  function goUp() {
    const path = levelPath.value
    if (path.length > 1) goTo(path[path.length - 2], { kind: 'module', id: path[path.length - 1] })
  }

  function select(s: Selection | null) {
    selection.value = s
    syncUrl(false)
  }

  /** 跳到某条关系真实所在的层次（两端的最近公共祖先）并选中 */
  function revealRelation(relationId: string) {
    const idx = index.value
    const r = idx?.relations.get(relationId)
    if (!idx || !r) return
    goTo(lowestCommonAncestor(idx, r.from, r.to), { kind: 'relation', id: relationId })
  }

  /** 跳到模块所在层次并选中它 */
  function revealModule(moduleId: string) {
    const idx = index.value
    const m = idx?.modules.get(moduleId)
    if (!idx || !m) return
    goTo(m.parentId, { kind: 'module', id: moduleId })
  }

  function setHover(id: string | null) {
    hoverId.value = id
  }

  // ── URL 同步 ──
  function syncUrl(push: boolean) {
    if (!router || !index.value) return
    const query: Record<string, string> = {}
    if (levelId.value && levelId.value !== index.value.rootId) query.level = levelId.value
    const sel = encodeSelection(selection.value)
    if (sel) query.sel = sel
    const cur = router.currentRoute.value.query
    if (cur.level === query.level && cur.sel === query.sel) return
    // 路由导航是异步的：自己发起的导航完成前，路由变化一律视为回声，不回写状态
    internalNav++
    void (push ? router.push({ query }) : router.replace({ query })).finally(() => internalNav--)
  }

  function attachRouter(r: Router) {
    router = r
    watch(
      () => r.currentRoute.value.query,
      q => {
        if (!index.value || internalNav > 0) return
        // 离开本项目（回到项目列表或切到别的项目）时不回写
        if (options.project !== undefined && r.currentRoute.value.params.project !== options.project) return
        const level = typeof q.level === 'string' ? q.level : index.value.rootId
        const sel = decodeSelection(q.sel)
        if (level !== levelId.value || encodeSelection(sel) !== encodeSelection(selection.value)) {
          setLevel(level, { history: false, select: exists(sel) ? sel : null })
        }
      },
    )
  }

  /** 首次加载：以 URL 为准 */
  async function init() {
    await reload()
    const idx = index.value
    if (!idx) return
    const q = router?.currentRoute.value.query ?? {}
    const level = typeof q.level === 'string' && idx.pathOf.has(q.level) ? q.level : idx.rootId
    const sel = decodeSelection(q.sel)
    setLevel(level, { history: false, select: exists(sel) ? sel : null })
    levelVersion.value++
  }

  return {
    project: options.project,
    // 状态（只读使用）
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
    levelVersion,
    // 操作
    init,
    reload,
    attachRouter,
    drillInto,
    goTo,
    goUp,
    select,
    revealRelation,
    revealModule,
    setHover,
  }
}

export type DeskState = ReturnType<typeof createDeskState>
