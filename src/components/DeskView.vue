<script setup lang="ts">
/**
 * 单个项目的架构视图（LY-1，ADR-0064）：左边系统——竖栏 + 侧栏（停靠，LY-3、LY-4）+ 画布（页头 LY-5）；右边视图区——主语条 + 至多上下两组标签（LY-7–LY-12）。
 * 没有全宽顶栏，竖栏顶格、侧栏、画布、视图区的页头同高 44px、底线连成一条（LY-2）；选中不改变任何区域的宽度（I3）。侧栏、视图区的开合与宽度是工作区状态，只由人开合。
 * 底色按区域性质分（LY-2a，负责人 2026-11-08 走查）：竖栏、侧栏、视图区与三区页头是面板底（--surface），画布正文是唯一下沉的台面（--bg）；
 * 区与区之间只画 1px 线，拖拽的命中区在线两侧透明扩展，不占可见宽度。
 * 「我在哪」（⚠、源码、版本胶囊）在画布左上角（TB-7）；回放胶囊浮在画布底部居中（CD-7）。每次进入项目创建一份独立的 DeskState，
 * 其 watch 都在本组件作用域内，离开项目时随组件销毁。
 */
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter } from 'vue-router'
import { NO_WRITER } from '@/state/sync/writer'
import { browserMemory, createDeskState, type ModelPayload } from '@/state/useDeskState'
import { isCommitVersion, isIntentVersion, type VersionRef } from '@/model'
import { httpModelWriter, httpSourceFetcher } from './source/httpSource'
import { DESK_STATE } from '@/state/inject'
import { httpAgentTransport, type AgentEvents } from '@/state/sync/agent'
import GraphCanvas from './GraphCanvas.vue'
import CanvasTitle from './CanvasTitle.vue'
import CanvasHead from './CanvasHead.vue'
import ProjectMenu from './ProjectMenu.vue'
import InfoBar from './infobar/InfoBar.vue'
import GuideDialog from './GuideDialog.vue'
import { OPEN_GUIDE, type GuideSection } from './shared/guide'
import PlayerBar from './PlayerBar.vue'
import DockPane from './dock/DockPane.vue'
import { subjectLabel } from './dock/subjectLabel'
import SideBar from './tree/SideBar.vue'
import SideRail from './tree/SideRail.vue'
import { OPEN_PREVIEW } from './shared/preview'
import { HAS_EXPLAINER } from './panel/related'
import { SIDE_NAV, type ModulesMode, type SidePage } from './shared/navTab'
import { OPEN_PROPS } from './shared/openProps'
import { SIDE_FILTERS, createSideFilters } from './shared/sideFilters'
import { REF_PEEK } from './shared/refPeek'
import { playerPlacement } from './shared/playerPlacement'
import { STAGE_DISPLAY, useStageDisplay } from './stage/useStageDisplay'
import { useEvolutionPrefs } from './display/useEvolutionPrefs'
import { useAssemblyPrefs } from './display/useAssemblyPrefs'
import EditDialog from './edit/EditDialog.vue'
import { ask } from './edit/useEditDialog'
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

// 静态 demo（vite build --mode demo）只读：没有写入（预渲染数据不可写，编辑入口在 ProjectMenu 一并隐藏）、没有 agent 对话
const demo = import.meta.env.MODE === 'demo'
const desk = createDeskState(fetchModel, {
  project: props.project,
  version,
  source: httpSourceFetcher(props.project, import.meta.env.BASE_URL),
  writer: demo ? NO_WRITER : httpModelWriter(props.project, import.meta.env.BASE_URL),
  agent: demo ? undefined : httpAgentTransport(import.meta.env.BASE_URL, import.meta.hot as unknown as AgentEvents | undefined),
  memory: browserMemory(),
})
desk.attachRouter(router)
provide(DESK_STATE, desk)
// 开发态便于在浏览器控制台检查状态
if (import.meta.env.DEV) (window as unknown as { __desk: typeof desk }).__desk = desk

// 开发态：本项目的描述文件变化后重新加载，保留当前层次与选中
const unwatchModel = desk.watchChanges(import.meta.hot)
onBeforeUnmount(unwatchModel)
onBeforeUnmount(() => desk.dialogue.dispose())
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

const ws = desk.workspace
// LY-4：侧栏的页（模块 / 场景 / 改动）只属于界面，由项目视图持有（场景胶囊、改动徽标要能切页）
const sideNav = { page: ref<SidePage>('modules'), mode: ref<ModulesMode>('modules') }
provide(SIDE_NAV, sideNav)
// LY-4d：侧栏页的筛选（侧栏「筛选 ▾」与画布「场景 ▾」共用一份）
provide(SIDE_FILTERS, createSideFilters())
/** LY-3：侧栏开合与宽度是工作区状态（本机记忆经同步适配器），只由人开合 */
const sidebar = computed(() => ws.state.value.sidebar)
/** LY-12：视图区可整体收起；宽度是占竖栏右边这块（侧栏 + 画布 + 视图区）的比例（LY-10b），竖栏的 44px 不参与 */
const viewsShown = computed(() => !ws.state.value.collapsed)
const viewsWidth = computed(() => ws.state.value.width)
const desktop = ref<HTMLElement>()
/** LY-3：竖栏宽（与 SideRail 同） */
const RAIL_W = 44
function onDividerDown(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const move = (ev: PointerEvent) => {
    const r = desktop.value?.getBoundingClientRect()
    if (r && r.width > RAIL_W) ws.dispatch({ type: 'setWidth', width: (r.right - ev.clientX) / (r.width - RAIL_W) })
  }
  const up = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}
/** LY-12：视图区收起时画布右上角的胶囊「视图 · 主语名 ›」，单击展开 */
const subjectName = computed(() => {
  const idx = desk.index.value
  const s = desk.subject.value
  return idx && s ? subjectLabel(idx, s).name : ''
})
const openViews = () => ws.dispatch({ type: 'setCollapsed', collapsed: false })

/** LY-15：视图里悬停的模块引用在画布上的节点（视图区写、画布读） */
const refPeek = ref<string | null>(null)
provide(REF_PEEK, refPeek)

/** DL-20：手势编辑需要表单时（右键「编辑字段…」、改动页定位到的项）——激活「描述」标签（原抽屉内容在那里，波 2 过渡） */
provide(OPEN_PROPS, () => ws.showView('description'))

// CD-7：回放胶囊浮在画布底部居中；与左下角的缩放胶囊相碰时右移（playerPlacement；悬浮卡片避让 CD-8 随抽屉删除，LY-16）
const PLAYER_MARGIN = 12
const canvasArea = ref<HTMLElement>()
const canvasWidth = ref(0)
let canvasObserver: ResizeObserver | null = null
onMounted(() => {
  if (!canvasArea.value || typeof ResizeObserver === 'undefined') return
  canvasWidth.value = canvasArea.value.clientWidth
  canvasObserver = new ResizeObserver(entries => (canvasWidth.value = entries[0].contentRect.width))
  canvasObserver.observe(canvasArea.value)
})
onBeforeUnmount(() => canvasObserver?.disconnect())
const player = ref<{ $el: HTMLElement }>()
const playerSize = ref({ w: 0, h: 0 })
/** 缩放胶囊的右沿（相对画布左沿） */
const zoomRight = ref(0)
let playerObserver: ResizeObserver | null = null
watch(
  () => player.value?.$el,
  el => {
    playerObserver?.disconnect()
    playerObserver = null
    if (!el || typeof ResizeObserver === 'undefined') return
    playerObserver = new ResizeObserver(() => {
      playerSize.value = { w: el.offsetWidth, h: el.offsetHeight }
      const area = el.parentElement?.getBoundingClientRect()
      const zoom = el.parentElement?.querySelector('.zoom-pill')?.getBoundingClientRect()
      zoomRight.value = area && zoom ? zoom.right - area.left : 0
    })
    playerObserver.observe(el)
  },
  { flush: 'post' },
)
onBeforeUnmount(() => playerObserver?.disconnect())
const playerShown = computed(() => desk.playing.value && !desk.edit.active.value && desk.status.value === 'ready')
const playerAt = computed(() =>
  playerPlacement({ canvasWidth: canvasWidth.value, inset: 0, playerWidth: playerSize.value.w, zoomRight: zoomRight.value, margin: PLAYER_MARGIN }),
)
const playerStyle = computed(() => ({ left: `${playerAt.value.left}px` }))

// 视图区（G15）：面板等组件经注入请求「预览某个文件」，在视图区打开为预览的资料标签
provide(OPEN_PREVIEW, (path: string, line?: number) => ws.open({ kind: 'source', path, line }))
// PC-9、EX-1：图解入口——模块有没有图解由模型层判定（desk.explainers）
provide(HAS_EXPLAINER, (id: string) => desk.explainers.has(id))
// W-10：「怎么读这张图」
const guideOpen = ref(false)
/** L51：图例关系组的「?」打开帮助并定位到「读一条线」 */
const guideSection = ref<GuideSection>()
function openGuide(section?: GuideSection) {
  guideSection.value = section
  guideOpen.value = true
}
provide(OPEN_GUIDE, openGuide)
/** LY-4a：画布的 ⚠ 胶囊打开「问题」资料标签 */
function showIssues() {
  ws.open({ kind: 'issues' }, true)
  if (ws.state.value.collapsed) openViews()
}
// CI-4：单击画布上的改动徽标——侧栏切到「改动」页（人的单击：收起着就展开）
watch(
  () => desk.edit.changes.reveal.value,
  r => {
    if (!r) return
    sideNav.page.value = 'changes'
    if (!sidebar.value.open) ws.dispatch({ type: 'setSidebar', open: true })
  },
)
// CI-5、DL-2：撤回有级联 / 之后又被改过时先列出确认（与编辑的二次确认同一对话框）
watch(
  () => desk.edit.changes.pending.value,
  async p => {
    if (!p) return
    const ok = await ask({ title: p.title, lines: p.lines, ok: '撤回', danger: true })
    if (ok) p.confirm()
    else desk.edit.changes.cancelPending()
  },
)

// TB-4：搜索面板——⌕ 或 ⌘K（Ctrl+K）打开，再按关闭；焦点在输入框里也生效
const searchOpen = ref(false)
function onSearchKey(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return
  e.preventDefault()
  searchOpen.value = !searchOpen.value
}
onMounted(() => window.addEventListener('keydown', onSearchKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onSearchKey))

// 舞台显示（V8、V9）：只属于画布这块界面
provide(STAGE_DISPLAY, useStageDisplay(props.project, desk))

// 键盘：Esc 只取消选中；Backspace 返回上级，根层回项目列表（N7、N9）；
// 回放：← → 单步，数字键选分支
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  if (t.closest('input, textarea, select, [contenteditable="true"]')) return
  // X7a：草图画布自己处理键盘（Delete、⌘Z / ⇧⌘Z、⌘S、Esc）
  if (desk.edit.active.value) return
  if (desk.playing.value) {
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
  <!-- LY-1：系统（侧栏 + 画布）｜ 视图（主语条 + 标签组）；没有全宽顶栏，三区各自有 44px 页头、底线对齐（LY-2） -->
  <div ref="desktop" class="desk">
    <!-- LY-3：竖栏——侧栏收起时也在 -->
    <SideRail />
    <aside v-if="sidebar.open" class="side-area" :style="{ width: `${sidebar.width}px` }">
      <ProjectMenu />
      <SideBar v-if="desk.status.value === 'ready'" />
    </aside>

    <section class="sys" aria-label="系统">
      <CanvasHead v-model:search="searchOpen" />
      <InfoBar v-if="version && desk.status.value === 'ready'" />
      <main ref="canvasArea" class="canvas-area" data-region="canvas" :style="viewsShown ? undefined : { '--views-pill-h': '34px' }">
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
          <GraphCanvas :peek="refPeek" />
          <!-- TB-7：画布左上角——⚠、源码胶囊、版本胶囊（LY-5） -->
          <CanvasTitle @issues="showIssues" />
        </template>
        <!-- LY-12：视图区收起时，画布右上角的「视图 · 主语名 ›」 -->
        <button
          v-if="!viewsShown && desk.status.value === 'ready'"
          class="views-pill"
          data-views-pill
          :title="`展开视图区（主语：${subjectName}）`"
          @click="openViews"
        >
          视图 · <span class="nm">{{ subjectName }}</span> ›
        </button>
        <!-- CD-7：回放胶囊浮在画布底部居中，与左下角的缩放胶囊同一行 -->
        <PlayerBar v-if="playerShown" ref="player" class="player-bar" :class="{ wide: !playerAt.fits }" :style="playerStyle" />
      </main>
    </section>

    <template v-if="viewsShown">
      <div class="divider" role="separator" aria-orientation="vertical" aria-label="拖动调整视图区宽度" @pointerdown="onDividerDown" />
      <div class="views-area" :style="{ width: `calc((100% - ${RAIL_W}px) * ${viewsWidth})` }">
        <DockPane />
      </div>
    </template>

    <GuideDialog v-if="guideOpen" :section="guideSection" @close="guideOpen = false" />
    <EditDialog />
    <!-- F-10：「在此设计」（侧栏模块树、模型画布节点右键、描述标签）打开的新建设计对话框 -->
    <NewDesignDialog v-if="newDesignRequest" :mount="newDesignRequest.mount" @close="closeNewDesign" />
  </div>
</template>

<style scoped>
.desk {
  --head-h: 44px;
  --toolbar-h: 44px;
  display: flex;
  height: 100%;
  min-height: 0;
  min-width: 0;
}

/* LY-3：侧栏停靠——挤压画布（只由人开合，选中不改变任何区域的宽度，I3） */
.side-area {
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
}

.side-area > :deep(.side-bar) {
  flex: 1 1 0;
  min-height: 0;
}

.sys {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.canvas-area {
  position: relative;
  background: var(--bg);
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.views-pill {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 8;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 260px;
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
  color: var(--text-2);
  font-size: 12px;
  white-space: nowrap;
  box-shadow: var(--card-shadow);
}

.views-pill .nm {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text);
}

.views-pill:hover {
  color: var(--text);
}

/* CD-7：回放胶囊在画布底部居中 */
.player-bar {
  position: absolute;
  bottom: 12px;
  z-index: 21;
}

.views-area {
  flex: none;
  min-width: 280px;
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

/* 画布与视图区之间只画 1px 线；命中区在线两侧透明扩展 */
.divider {
  position: relative;
  z-index: 25;
  flex: none;
  width: 1px;
  cursor: col-resize;
  background: var(--border);
}

.divider::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  right: -4px;
}

.divider:hover {
  background: var(--border-strong);
}
</style>
