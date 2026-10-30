<script setup lang="ts">
/**
 * 单个项目的架构视图，三列（W-1、WS-1，ADR-0054）：导航树 | 工作列（只属于它的工具栏、画布、属性栏、回放控制条）| 资料区。
 * 属性栏按工作列宽度并排或悬浮（WS-3）；「专注」一键收起导航树与属性栏（WS-9）。每次进入项目创建一份独立的 DeskState，
 * 其 watch 都在本组件作用域内，离开项目时随组件销毁。
 */
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter } from 'vue-router'
import { createDeskState, dockAppeared, propsPlacement, PROPS_WIDTH, type ModelPayload } from '@/state/useDeskState'
import { isCommitVersion, isIntentVersion, type VersionRef } from '@/model'
import { httpModelWriter, httpSourceFetcher } from './source/httpSource'
import { DESK_STATE } from '@/state/inject'
import GraphCanvas from './GraphCanvas.vue'
import Breadcrumb from './Breadcrumb.vue'
import Toolbar from './Toolbar.vue'
import VersionSwitcher from './VersionSwitcher.vue'
import InfoBar from './infobar/InfoBar.vue'
import GuideDialog from './GuideDialog.vue'
import PerspectiveSwitch from './PerspectiveSwitch.vue'
import PlayerBar from './PlayerBar.vue'
import DockPane from './dock/DockPane.vue'
import SourceDeltaBar from './source/SourceDeltaBar.vue'
import Panel from './panel/Panel.vue'
import NavTree from './tree/NavTree.vue'
import { OPEN_PREVIEW } from './shared/preview'
import { NAV_TAB, type NavTab } from './shared/navTab'
import { CANVAS_INSET } from './shared/canvasInset'
import { STAGE_DISPLAY, useStageDisplay } from './stage/useStageDisplay'
import { useEvolutionPrefs } from './display/useEvolutionPrefs'
import { useAssemblyPrefs } from './display/useAssemblyPrefs'
import EditDialog from './edit/EditDialog.vue'
import { confirmLeave } from './edit/leave'
import SketchCanvas from './sketch/SketchCanvas.vue'
import NewDesignDialog from './edit/NewDesignDialog.vue'
import { closeNewDesign, newDesignRequest, takeSheet } from './edit/designHere'

const props = defineProps<{ project: string; design?: string; revision?: string; commit?: string; base?: string; intent?: string }>()
const router = useRouter()
// 设计版本（ADR-0002）、提交版本（E5、E6）或持久草图版本（ADR-0024）；都没有时为当前版本
const version: VersionRef | undefined = props.commit
  ? { commit: props.commit, ...(props.base ? { base: props.base } : {}) }
  : props.design && props.revision
    ? { design: props.design, revision: props.revision }
    : props.intent
      ? { intent: props.intent }
      : undefined

async function fetchModel(): Promise<ModelPayload> {
  const enc = encodeURIComponent
  const file = isCommitVersion(version)
    ? `models/${enc(props.project)}/commits/${enc(version.commit)}.json${version.base ? `?base=${enc(version.base)}` : ''}`
    : isIntentVersion(version)
      ? `models/${enc(props.project)}/intent/${enc(version.intent)}.json`
      : version
        ? `models/${enc(props.project)}/designs/${enc(version.design)}/${enc(version.revision)}.json`
        : `models/${enc(props.project)}.json`
  const what = isCommitVersion(version)
    ? `提交「${version.commit.slice(0, 8)}」`
    : isIntentVersion(version)
      ? `持久草图「${version.intent}」`
      : version
        ? `设计版本「${version.design} / ${version.revision}」`
        : `项目「${props.project}」`
  const res = await fetch(`${import.meta.env.BASE_URL}${file}`, { cache: 'no-store' })
  if (res.status === 404) throw new Error(`${what}不存在`)
  if (!res.ok) throw new Error(`读取${what}失败：HTTP ${res.status}`)
  return res.json()
}

const desk = createDeskState(fetchModel, {
  project: props.project,
  version,
  source: httpSourceFetcher(props.project, import.meta.env.BASE_URL),
  writer: httpModelWriter(props.project, import.meta.env.BASE_URL),
})
desk.attachRouter(router)
provide(DESK_STATE, desk)
// 开发态便于在浏览器控制台检查状态
if (import.meta.env.DEV) (window as unknown as { __desk: typeof desk }).__desk = desk

// 开发态：本项目的描述文件变化后重新加载，保留当前层次与选中
const unwatchModel = desk.watchChanges(import.meta.hot)
onBeforeUnmount(unwatchModel)
// J5：「演化」叠加的开关按项目记在本地，模型加载后恢复
const evolutionPrefs = useEvolutionPrefs(props.project, desk)
// O12：「组装」开关同样按项目记在本地
const assemblyPrefs = useAssemblyPrefs(props.project, desk)
void router.isReady().then(() =>
  desk.init().then(() => {
    evolutionPrefs.restore()
    assemblyPrefs.restore()
  }),
)

// T2b 裁决 6：从当前版本「加到设计 <名>」过来的——进入草图画布后切到挂在那个模块上的一张（会话里没有时按基线推出）
if (props.design)
  watch(
    () => desk.edit.active.value,
    on => {
      const m = on ? takeSheet(props.design!) : null
      if (!m) return
      const r = desk.edit.openMount(m)
      if (!r.ok) desk.edit.notice.value = `没能切到挂在「${m}」上的草图：${r.reason}`
    },
    { immediate: true },
  )

// X7a：有未保存的草图改动时，离开（切换版本、回项目列表、浏览器前进后退）三选——保存 / 放弃 / 取消，与信息条「退出」同一个对话框；
// 关闭页面受浏览器限制只有浏览器自己的两选（beforeunload：离开即放弃）
const leaveOk = () => confirmLeave(desk.edit, 'switch', text => (desk.edit.notice.value = text))
onBeforeRouteLeave(() => leaveOk())
onBeforeRouteUpdate((to, from) => (JSON.stringify(to.params) === JSON.stringify(from.params) ? true : leaveOk()))
const onUnload = (e: BeforeUnloadEvent) => {
  if (desk.edit.canLeave() === 'confirm') e.preventDefault()
}
onMounted(() => window.addEventListener('beforeunload', onUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onUnload))

// 导航树：宽度可拖动、可折叠，记在本地（W-1）；资料区与工作列的比例按项目记在本地（W-4）
function readNumber(key: string, min: number, max: number, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    const w = raw === null ? NaN : Number(raw)
    return w >= min && w <= max ? w : fallback
  } catch {
    return fallback
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 存不了就算了 */
  }
}

const ws = desk.workspace
// WS-2：属性栏开关是工作区状态，按本机记住（沿用旧的面板折叠键）
const PROPS_KEY = 'h5p-arch-desk:panel-collapsed'
ws.setProps(readNumber(PROPS_KEY, 0, 1, 0) !== 1)
const propsOpen = computed(() => ws.state.value.propsOpen)
function toggleProps() {
  ws.setProps(!propsOpen.value)
  store(PROPS_KEY, propsOpen.value ? '0' : '1')
}

const navWidth = ref(readNumber('h5p-arch-desk:nav-width', 180, 520, 260))
// W-1：导航树的收起按视角分别记在本地——运行视角缺省收起（让出宽度给结构图与时序图），退出场景恢复结构视角的状态
const navKey = (run: boolean) => (run ? 'h5p-arch-desk:nav-collapsed:run' : 'h5p-arch-desk:nav-collapsed')
const navCollapsedOf = (run: boolean) => readNumber(navKey(run), 0, 1, run ? 1 : 0) === 1
const navCollapsed = ref(navCollapsedOf(desk.perspective.value === 'run') || ws.dockShown.value)
watch(
  () => desk.perspective.value,
  p => (navCollapsed.value = navCollapsedOf(p === 'run')),
)

function toggleNav() {
  navCollapsed.value = !navCollapsed.value
  store(navKey(desk.perspective.value === 'run'), navCollapsed.value ? '1' : '0')
}
// WS-9：专注——导航树或属性栏任一展开时都收起；都已收起时都恢复
const focused = computed(() => navCollapsed.value && !propsOpen.value)
function toggleFocus() {
  const open = focused.value
  if (navCollapsed.value !== !open) toggleNav()
  if (propsOpen.value !== open) toggleProps()
}

// W-4：资料区占整个项目视图宽度的比例，按项目记在本地
const DOCK_KEY = `h5p-arch-desk:dock-ratio:${props.project}`
const dockRatio = ref(readNumber(DOCK_KEY, 0.2, 0.75, 0.44))
const desktop = ref<HTMLElement>()
let dragging: 'dock' | 'nav' | null = null
function onDividerDown(which: 'dock' | 'nav', e: PointerEvent) {
  dragging = which
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}
function onDividerMove(e: PointerEvent) {
  if (dragging === 'nav') navWidth.value = Math.min(520, Math.max(180, e.clientX))
  else if (dragging === 'dock' && desktop.value) {
    const r = desktop.value.getBoundingClientRect()
    dockRatio.value = Math.min(0.75, Math.max(0.2, (r.right - e.clientX) / r.width))
  }
}
function onDividerUp() {
  if (dragging === 'nav') store('h5p-arch-desk:nav-width', String(navWidth.value))
  else if (dragging === 'dock') store(DOCK_KEY, String(dockRatio.value))
  dragging = null
}

// WS-3：属性栏并排还是悬浮由工作列宽度推出，不存状态
const stage = ref<HTMLElement>()
const stageWidth = ref(0)
let stageObserver: ResizeObserver | null = null
onMounted(() => {
  if (!stage.value) return
  stageWidth.value = stage.value.clientWidth
  if (typeof ResizeObserver !== 'undefined') {
    stageObserver = new ResizeObserver(entries => (stageWidth.value = entries[0].contentRect.width))
    stageObserver.observe(stage.value)
  }
})
onBeforeUnmount(() => stageObserver?.disconnect())
const placement = computed(() => propsPlacement(stageWidth.value))
const floating = computed(() => propsOpen.value && placement.value === 'floating')
const canvasInset = computed(() => (floating.value ? PROPS_WIDTH + 16 : 0))
provide(CANVAS_INSET, canvasInset)

// 资料区（G15、WS-8）：面板等组件经注入请求「预览某个文件」，在资料区打开为预览标签
provide(OPEN_PREVIEW, (path: string, line?: number) => ws.open({ kind: 'source', path, line }))
// WS-7：「▣ 资料」——有标签时隐藏 / 显示；没有标签时运行视角打开时序图，其他视角不可用
const hasDocs = computed(() => ws.state.value.groups.some(g => g.tabs.length))
function toggleDock() {
  if (hasDocs.value) ws.dispatch({ type: 'toggleDock' })
  else if (desk.perspective.value === 'run') ws.open({ kind: 'sequence' }, true)
}
// G22：当前版本下源码树的 HEAD 与描述的 source.commit 不一致（提交 / 设计版本没有代码事实，不提示）
const sourceDelta = computed(() => {
  const p = desk.files.payload.value
  return p?.status === 'local' ? (p.commitDelta ?? null) : null
})
// W-10：「怎么读这张图」
const guideOpen = ref(false)
// W-6：导航树页签由项目视图持有，画布的问题角标切到「问题」页签
const navTab = ref<NavTab>(desk.perspective.value === 'run' ? 'steps' : 'modules')
provide(NAV_TAB, navTab)
// WS-9：资料区从不显示变为显示时收起导航树，把宽度让给画布（不写进本机记忆）。例外：正在文件页签里挑文件（导航树就是打开资料的地方）；
// 因打开场景而出现时由运行视角的本机记忆决定（缺省收起，W-1：在运行视角里展开过的，下次进入仍展开）
const hasSequence = (s: typeof ws.state.value) => s.groups.some(g => g.tabs.some(t => t.doc.kind === 'sequence'))
watch(ws.state, (now, was) => {
  if (dockAppeared(was, now) && navTab.value !== 'files' && !(hasSequence(now) && !hasSequence(was))) navCollapsed.value = true
})
const issueCount = computed(() => {
  const c = desk.rework.value?.counts
  return { errors: c?.error ?? 0, warnings: c?.warning ?? 0, total: (c?.error ?? 0) + (c?.warning ?? 0) }
})
function showIssues() {
  navTab.value = 'issues'
  if (navCollapsed.value) toggleNav()
}

// 舞台显示（V8、V9）：只属于画布这块界面
provide(STAGE_DISPLAY, useStageDisplay(props.project, desk))

// 键盘：Esc 只取消选中；Backspace 返回上级，根层回项目列表（N7、N9）；
// 运行视角：← → 单步，数字键选分支
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  if (t.closest('input, textarea, select, [contenteditable="true"]')) return
  // X7a：草图画布自己处理键盘（Delete、⌘Z / ⇧⌘Z、⌘S、Esc）
  if (desk.edit.active.value) return
  if (desk.perspective.value === 'run') {
    const bp = desk.run.branchPoint.value
    if (e.key === 'ArrowRight') desk.next()
    else if (e.key === 'ArrowLeft') desk.prev()
    else if (bp && /^[1-9]$/.test(e.key) && Number(e.key) <= bp.options.length) desk.chooseBranch(bp.id, Number(e.key) - 1)
    else if (e.key !== 'Escape' && e.key !== 'Backspace') return
    if (e.key !== 'Escape' && e.key !== 'Backspace') {
      e.preventDefault()
      return
    }
  }
  if (e.key !== 'Escape' && e.key !== 'Backspace') return
  if (e.key === 'Backspace') e.preventDefault()
  if (desk.pressKey(e.key) === 'leave') void router.push('/')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div ref="desktop" class="desk">
    <aside v-show="!navCollapsed" class="nav-area" :style="{ width: `${navWidth}px` }">
      <NavTree v-if="desk.status.value === 'ready'" />
    </aside>
    <div v-show="!navCollapsed" class="divider" @pointerdown="onDividerDown('nav', $event)" @pointermove="onDividerMove" @pointerup="onDividerUp" />

    <div class="work">
      <header class="top" aria-label="工具栏">
        <button
          class="tool nav-toggle"
          :class="{ on: !navCollapsed }"
          :title="navCollapsed ? '展开导航树' : '收起导航树'"
          :aria-label="navCollapsed ? '展开导航树' : '收起导航树'"
          @click="toggleNav"
        >
          ☰
        </button>
        <VersionSwitcher />
        <!-- 草图画布下没有运行视角（场景不在草图里画） -->
        <PerspectiveSwitch v-if="desk.status.value === 'ready' && !desk.edit.active.value" />
        <!-- 「显示 ▾」的位置（R4.2，第十七轮 W4 落地） -->
        <Breadcrumb />
        <Toolbar />
        <button class="tool guide-btn" title="帮助：怎么读这张图" aria-label="怎么读这张图" @click="guideOpen = true">?</button>
        <button class="tool" :class="{ on: focused }" :title="focused ? '恢复导航树与属性栏' : '收起导航树与属性栏'" @click="toggleFocus">
          {{ focused ? '退出专注' : '专注' }}
        </button>
        <span v-if="propsOpen" class="mode" :title="floating ? '画布不够宽，属性栏悬浮在画布右侧' : '画布够宽，属性栏与画布并排'">
          {{ floating ? '悬浮' : '并排' }}
        </span>
        <button class="tool props-toggle" :class="{ on: propsOpen }" :aria-pressed="propsOpen" title="属性（跟随选中）" @click="toggleProps">▤ 属性</button>
        <button
          class="tool dock-toggle"
          :class="{ on: ws.dockShown.value }"
          :aria-pressed="ws.dockShown.value"
          :disabled="!hasDocs && desk.perspective.value !== 'run'"
          :title="hasDocs ? (ws.dockShown.value ? '隐藏资料区（标签保留）' : '显示资料区') : '还没有打开的资料：打开场景或文件'"
          @click="toggleDock"
        >
          ▣ 资料
        </button>
      </header>

      <div class="sub-bars">
        <InfoBar v-if="version && desk.status.value === 'ready'" />
        <!-- G22：源码版本提示条，加载完成后当前版本常显，一致时不出现 -->
        <SourceDeltaBar v-if="!version && desk.status.value === 'ready'" :delta="sourceDelta" />
      </div>

      <div ref="stage" class="stage">
        <main class="canvas-area" :style="{ '--canvas-inset': `${canvasInset}px` }">
          <div v-if="desk.status.value === 'loading'" class="state">正在加载架构描述…</div>
          <div v-else-if="desk.status.value === 'error'" class="state error">
            <strong>无法加载架构描述</strong>
            <p>{{ desk.loadError.value }}</p>
            <div class="actions">
              <button @click="desk.reload()">重试</button>
              <button @click="router.push('/')">返回项目列表</button>
            </div>
          </div>
          <!-- X7a：进入草图即草图画布（ADR-0025） -->
          <SketchCanvas v-else-if="desk.edit.active.value" />
          <template v-else>
            <GraphCanvas />
            <button
              v-if="issueCount.total"
              class="issue-badge"
              :class="{ bad: issueCount.errors }"
              :title="`返工清单：${issueCount.errors} 个错误、${issueCount.warnings} 个提醒，单击在导航树「问题」页签查看`"
              @click="showIssues"
            >
              ⚠ {{ issueCount.total }}
            </button>
          </template>
        </main>
        <!-- WS-2、WS-3：属性栏 330px，跟随选中；并排或悬浮由宽度推出 -->
        <aside v-if="propsOpen" class="props" :class="{ floating }" aria-label="属性">
          <header class="props-head">
            <span>▤ 属性</span>
            <button class="props-close" title="关闭属性栏（工具栏「▤ 属性」再打开）" aria-label="关闭属性栏" @click="toggleProps">×</button>
          </header>
          <div class="panel-area">
            <Panel v-if="desk.status.value === 'ready'" />
          </div>
        </aside>
      </div>
      <PlayerBar v-if="desk.perspective.value === 'run' && !desk.edit.active.value" class="player-bar" />
    </div>

    <template v-if="ws.dockShown.value">
      <div class="divider dock-divider" @pointerdown="onDividerDown('dock', $event)" @pointermove="onDividerMove" @pointerup="onDividerUp" />
      <div class="dock-area" :style="{ width: `${dockRatio * 100}%` }">
        <DockPane />
      </div>
    </template>
    <GuideDialog v-if="guideOpen" @close="guideOpen = false" />
    <EditDialog />
    <!-- F-10：「在此设计」（导航树、模型画布节点右键、属性面板）打开的新建设计对话框 -->
    <NewDesignDialog v-if="newDesignRequest" :mount="newDesignRequest.mount" @close="closeNewDesign" />
  </div>
</template>

<style scoped>
.desk {
  --toolbar-h: 42px;
  display: flex;
  height: 100%;
  min-height: 0;
}

.nav-area {
  flex: none;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--surface);
}

.work {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.top {
  display: flex;
  align-items: center;
  gap: 6px;
  height: var(--toolbar-h);
  padding: 0 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  min-width: 0;
  flex: none;
}

.top > :deep(*) {
  flex-shrink: 0;
}

/* WS-1：工具栏只有工作列这么宽，保持一行、与资料区标签栏同高：按钮不缩；版本、场景名、面包屑、搜索按需收窄（场景名、面包屑省略） */
.top {
  container-type: inline-size;
}

.top > :deep(.versions) {
  display: flex;
  align-items: center;
  flex: 0 1 auto;
  min-width: min(110px, max-content);
  overflow: hidden;
  white-space: nowrap;
}

.top :deep(.versions select) {
  max-width: 170px;
}

.top > :deep(.perspective) {
  flex: 0 1 auto;
  min-width: 0;
}

.top :deep(.perspective .seg) {
  flex: none;
}

.top :deep(.perspective .run) {
  flex: 0 1 auto;
  min-width: 4.5em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 运行视角下场景名至少留出几个字 */
.top :deep(.perspective:has(.exit) .run) {
  min-width: 110px;
}

.top > :deep(.crumbs) {
  flex: 1 4 auto;
  min-width: 56px;
}

.top > :deep(.toolbar) {
  flex: 0 1 auto;
  min-width: 84px;
}

.top :deep(.search) {
  min-width: 0;
}

.top :deep(.search input) {
  width: 150px;
  max-width: 100%;
  min-width: 76px;
}

/* 工作列窄（运行视角开了资料区）时，「编辑骨架」「新建设计」让位，资料区收起或拖宽后回来 */
@container (max-width: 1000px) {
  .top :deep(.versions .new) {
    display: none;
  }
}

.tool {
  flex: none;
  font-size: 12px;
}

.guide-btn {
  margin-left: auto;
}

.tool.on {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
}

.mode {
  flex: none;
  font-size: 11.5px;
  color: var(--text-3);
  margin-right: -6px;
}

.sub-bars {
  display: flex;
  flex-direction: column;
  flex: none;
}

.stage {
  position: relative;
  flex: 1 1 0;
  display: flex;
  min-height: 0;
  min-width: 0;
}

.canvas-area {
  position: relative;
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.props {
  flex: none;
  display: flex;
  flex-direction: column;
  width: 330px;
  min-height: 0;
  background: var(--surface);
  border-left: 1px solid var(--border);
}

.props.floating {
  position: absolute;
  top: 8px;
  right: 8px;
  bottom: 8px;
  z-index: 20;
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgb(20 30 50 / 16%);
  overflow: hidden;
}

.props-head {
  display: flex;
  align-items: center;
  padding: 3px 6px 3px 14px;
  font-size: 11.5px;
  color: var(--text-3);
  border-bottom: 1px solid var(--border);
  flex: none;
}

.props-close {
  margin-left: auto;
  border: none;
  background: none;
  font-size: 15px;
  line-height: 1;
  padding: 0 6px;
  color: var(--text-3);
}

.panel-area {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.player-bar {
  flex: none;
}

.dock-area {
  flex: none;
  min-width: 0;
  min-height: 0;
}

.state {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  text-align: center;
  color: var(--text-2);
  gap: 8px;
}

.state .actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.state.error strong {
  color: var(--danger);
}

.divider {
  flex: none;
  width: 5px;
  cursor: col-resize;
  background: var(--border);
  border-left: 2px solid var(--bg);
  border-right: 2px solid var(--bg);
}

.divider:hover {
  background: var(--accent);
}

.issue-badge {
  position: absolute;
  top: 10px;
  left: 12px;
  z-index: 6;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 10px;
  border: 1px solid var(--warning);
  background: var(--warning-soft);
  color: var(--warning);
}

.issue-badge.bad {
  border-color: var(--danger);
  background: var(--danger-soft);
  color: var(--danger);
}
</style>
