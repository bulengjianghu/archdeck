<script setup lang="ts">
/**
 * 单个项目的架构视图。第二十二轮波 1（ADR-0064）：视图区（原资料区）显示新的工作区状态——视图标签跟随主语、按情境排布、常在可收起；
 * 顶栏、导航浮层与选中抽屉仍是旧版式（波 2 换成侧栏 + 画布 | 视图区两部分），抽屉与浮层的开合是这里的本地值、只由人开合。
 * 「我在哪」在画布左上角的标题行（TB-7）；回放胶囊浮在画布底部居中、避让悬浮卡片（CD-7、CD-8）。每次进入项目创建一份独立的 DeskState，
 * 其 watch 都在本组件作用域内，离开项目时随组件销毁。
 */
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter } from 'vue-router'
import { browserMemory, createDeskState, type ModelPayload } from '@/state/useDeskState'
import { isCommitVersion, isIntentVersion, type VersionRef } from '@/model'
import { httpModelWriter, httpSourceFetcher } from './source/httpSource'
import { DESK_STATE } from '@/state/inject'
import { httpAgentTransport, type AgentEvents } from '@/state/sync/agent'
import GraphCanvas from './GraphCanvas.vue'
import CanvasTitle from './CanvasTitle.vue'
import SearchPalette from './SearchPalette.vue'
import ProjectMenu from './ProjectMenu.vue'
import MoreMenu from './MoreMenu.vue'
import ToolIcon from './shared/ToolIcon.vue'
import InfoBar from './infobar/InfoBar.vue'
import GuideDialog from './GuideDialog.vue'
import DisplayMenu from './display/DisplayMenu.vue'
import { OPEN_GUIDE, type GuideSection } from './shared/guide'
import PerspectiveSwitch from './PerspectiveSwitch.vue'
import PlayerBar from './PlayerBar.vue'
import DockPane from './dock/DockPane.vue'
import Panel from './panel/Panel.vue'
import NavTree from './tree/NavTree.vue'
import { OPEN_PREVIEW } from './shared/preview'
import { HAS_EXPLAINER } from './panel/related'
import { NAV_TAB, type NavTab } from './shared/navTab'
import { OPEN_PROPS } from './shared/openProps'
import { CANVAS_INSET } from './shared/canvasInset'
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

const desk = createDeskState(fetchModel, {
  project: props.project,
  version,
  source: httpSourceFetcher(props.project, import.meta.env.BASE_URL),
  writer: httpModelWriter(props.project, import.meta.env.BASE_URL),
  agent: httpAgentTransport(import.meta.env.BASE_URL, import.meta.hot as unknown as AgentEvents | undefined),
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
// 第二十二轮波 1 的过渡（波 2 删抽屉与浮层）：选中抽屉与导航浮层的开合是呈现层的本地值，不再进工作区状态；
// 只由人开合（LY-16：不随运行视角、资料区出现自动收起），按本机记住
const PROPS_KEY = 'h5p-arch-desk:panel-collapsed'
const PROPS_WIDTH = 330
const MIN_CANVAS = 620
const propsOpen = ref(readNumber(PROPS_KEY, 0, 1, 1) !== 1)
const setProps = (open: boolean) => (propsOpen.value = open)
function toggleProps() {
  setProps(!propsOpen.value)
  // DL-20：草图编辑态的展开收起只在这一回（缺省收起），不改本机记住的偏好
  if (!desk.edit.active.value) store(PROPS_KEY, propsOpen.value ? '0' : '1')
}

// 导航树是画布左缘的浮层抽屉（过渡）：不挤压画布，宽度固定 300，缺省收起，开合按本机记住（不再按视角分别记）
const navWidth = ref(300)
const NAV_KEY = 'h5p-arch-desk:nav-collapsed'
const navCollapsed = ref(readNumber(NAV_KEY, 0, 1, 1) === 1)
// DL-20（过渡）：草图编辑态选中面板缺省收起——对话在场后表单用得少；退出时恢复进入前的样子
let propsBeforeEdit: boolean | null = null
watch(
  () => desk.edit.active.value,
  on => {
    // 过渡：浮层盖住画布左缘，进入草图收起它（不写本机记忆）；波 2 侧栏停靠后按 LY-3 只由人开合，这条随浮层删
    if (on) navCollapsed.value = true
    if (on) {
      propsBeforeEdit = propsOpen.value
      if (propsOpen.value) setProps(false)
    } else if (propsBeforeEdit !== null) {
      if (propsBeforeEdit !== propsOpen.value) setProps(propsBeforeEdit)
      propsBeforeEdit = null
    }
  },
  { immediate: true },
)
/** DL-20：手势编辑需要表单时按需展开（右键「编辑字段…」、改动页签定位到的项） */
provide(OPEN_PROPS, () => {
  if (!propsOpen.value) setProps(true)
})

function toggleNav() {
  navCollapsed.value = !navCollapsed.value
  store(NAV_KEY, navCollapsed.value ? '1' : '0')
}

// 专注：导航树或属性栏任一展开时都收起；都已收起时都恢复
const focused = computed(() => navCollapsed.value && !propsOpen.value)
function toggleFocus() {
  const open = focused.value
  if (navCollapsed.value !== !open) toggleNav()
  if (propsOpen.value !== open) toggleProps()
}

// LY-10b：视图区占整个项目视图宽度的比例，是工作区状态（本机记忆经同步适配器）
const dockRatio = computed(() => ws.state.value.width)
/** LY-12：视图区可整体收起 */
const viewsShown = computed(() => !ws.state.value.collapsed)
const desktop = ref<HTMLElement>()
let dragging: 'dock' | null = null
function onDividerDown(which: 'dock', e: PointerEvent) {
  dragging = which
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}
function onDividerMove(e: PointerEvent) {
  if (dragging === 'dock' && desktop.value) {
    const r = desktop.value.getBoundingClientRect()
    ws.dispatch({ type: 'setWidth', width: (r.right - e.clientX) / r.width })
  }
}
function onDividerUp() {
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
const placement = computed(() => (stageWidth.value - PROPS_WIDTH >= MIN_CANVAS ? 'docked' : 'floating'))
// DL-20：草图编辑态展开的选中面板浮在画布右侧，不挤压画布（画布宽度不变，草图的可用区域不随之重排）
const floating = computed(() => propsOpen.value && (placement.value === 'floating' || desk.edit.active.value))
const canvasInset = computed(() => (floating.value ? PROPS_WIDTH + 16 : 0))
provide(CANVAS_INSET, canvasInset)

// CD-8：回放胶囊的位置（playerPlacement）；放不下时悬浮卡片列底部让出胶囊
const PLAYER_MARGIN = 12
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
const playerShown = computed(() => desk.perspective.value === 'run' && !desk.edit.active.value && desk.status.value === 'ready')
const canvasWidth = computed(() => (propsOpen.value && !floating.value ? stageWidth.value - PROPS_WIDTH : stageWidth.value))
const playerAt = computed(() =>
  playerPlacement({
    canvasWidth: canvasWidth.value,
    inset: canvasInset.value,
    playerWidth: playerSize.value.w,
    zoomRight: zoomRight.value,
    margin: PLAYER_MARGIN,
  }),
)
const playerFits = computed(() => playerAt.value.fits)
const playerStyle = computed(() => ({ left: `${playerAt.value.left}px` }))
const propsStyle = computed(() =>
  floating.value && playerShown.value && !playerFits.value ? { bottom: `${playerSize.value.h + 2 * PLAYER_MARGIN}px` } : undefined,
)

// 资料区（G15、WS-8）：面板等组件经注入请求「预览某个文件」，在资料区打开为预览标签
provide(OPEN_PREVIEW, (path: string, line?: number) => ws.open({ kind: 'source', path, line }))
// PC-9、EX-1：相关资料卡的图解入口——模块有没有图解由模型层判定（desk.explainers）
provide(HAS_EXPLAINER, (id: string) => desk.explainers.has(id))
// LY-12：「▣」——收起 / 展开视图区（图解常驻，视图区总有内容）
function toggleDock() {
  ws.dispatch({ type: 'setCollapsed', collapsed: !ws.state.value.collapsed })
}
// W-10：「怎么读这张图」
const guideOpen = ref(false)
/** L51：图例关系组的「?」打开帮助并定位到「读一条线」 */
const guideSection = ref<GuideSection>()
function openGuide(section?: GuideSection) {
  guideSection.value = section
  guideOpen.value = true
}
provide(OPEN_GUIDE, openGuide)
// W-6：导航树页签由项目视图持有，画布的问题角标切到「问题」页签
const navTab = ref<NavTab>(desk.perspective.value === 'run' ? 'steps' : 'modules')
provide(NAV_TAB, navTab)
function showIssues() {
  navTab.value = 'issues'
  if (navCollapsed.value) toggleNav()
}
// CI-4：单击画布上的改动徽标——展开导航树、切到「改动」页签
watch(
  () => desk.edit.changes.reveal.value,
  r => {
    if (!r) return
    navTab.value = 'changes'
    if (navCollapsed.value) toggleNav()
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
// TB-2：「▤ 属性」的悬停提示写当前并排还是悬浮（WS-3）
const propsTip = computed(() =>
  propsOpen.value ? `选中面板（跟随选中）· 当前${floating.value ? '浮在画布右侧：宽度不够挤压' : '挤压画布'}；单击关闭` : '属性（跟随选中）：单击打开',
)
const dockTip = computed(() => (viewsShown.value ? '视图：收起视图区（专注地图）' : '视图：展开视图区'))

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
    <!-- 第二十轮读先方案 §4：顶栏拉通（项目 · 视角 · 搜索 · 显示 · 抽屉开关），下方画布 + 辅助栏双栏 -->
    <header class="top" aria-label="工具栏">
      <ProjectMenu />
      <span class="vsep" aria-hidden="true" />
      <button
        class="ib nav-toggle"
        :class="{ on: !navCollapsed }"
        :title="navCollapsed ? '展开导航树' : '收起导航树'"
        aria-label="导航树"
        :aria-pressed="!navCollapsed"
        @click="toggleNav"
      >
        <ToolIcon name="nav" />
      </button>
      <!-- 草图画布下没有运行视角（场景不在草图里画） -->
      <PerspectiveSwitch v-if="desk.status.value === 'ready' && !desk.edit.active.value" />
      <span class="spacer" />
      <!-- L49、TB-3：「显示 ▾」——没有画布记号的显示设置；有非默认设置时带一个点 -->
      <DisplayMenu v-if="desk.status.value === 'ready' && !desk.edit.active.value" />
      <span class="vsep" aria-hidden="true" />
      <button
        class="ib"
        data-search-toggle
        :class="{ on: searchOpen }"
        title="搜索模块（⌘K）"
        aria-label="搜索模块"
        :aria-expanded="searchOpen"
        @click="searchOpen = !searchOpen"
      >
        <ToolIcon name="search" />
      </button>
      <button
        class="ib"
        :class="{ on: focused }"
        :title="focused ? '退出专注：恢复导航树与选中面板' : '专注：收起导航树与选中面板'"
        :aria-label="focused ? '退出专注' : '专注'"
        :aria-pressed="focused"
        @click="toggleFocus"
      >
        <ToolIcon name="focus" />
      </button>
      <button class="ib props-toggle" :class="{ on: propsOpen }" :aria-pressed="propsOpen" :title="propsTip" aria-label="属性" @click="toggleProps">
        <ToolIcon name="props" />
      </button>
      <button class="ib dock-toggle" :class="{ on: viewsShown }" :aria-pressed="viewsShown" :title="dockTip" aria-label="资料" @click="toggleDock">
        <ToolIcon name="dock" />
      </button>
      <MoreMenu />
      <SearchPalette v-if="desk.status.value === 'ready'" v-model:open="searchOpen" />
    </header>

    <div class="sub-bars">
      <InfoBar v-if="version && desk.status.value === 'ready'" />
    </div>

    <div class="body">
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
            <!-- TB-7：画布标题行——面包屑、⚠、源码胶囊、版本胶囊；导航浮层开着时让位到抽屉右侧（02-review 缺陷 3） -->
            <CanvasTitle :style="{ left: navCollapsed ? undefined : `${navWidth + 12}px` }" @issues="showIssues" />
          </template>
          <!-- CD-7、CD-8：回放胶囊浮在画布底部居中，与左下角的缩放胶囊同一行 -->
          <PlayerBar v-if="playerShown" ref="player" class="player-bar" :class="{ wide: !playerFits }" :style="playerStyle" />
        </main>
        <!-- 第二十轮 §4：选中面板是抽屉——宽度够时挤压画布，不够时浮在画布右侧（实底，不透传点击）；× 右上角 -->
        <aside v-if="propsOpen" class="props" :class="{ floating }" :style="propsStyle" aria-label="属性">
          <div class="panel-area">
            <button class="props-close" title="关闭选中面板" aria-label="关闭属性栏" @click="toggleProps">×</button>
            <Panel v-if="desk.status.value === 'ready'" />
          </div>
        </aside>
        <!-- 导航树＝画布左缘的浮层抽屉：不挤压画布 -->
        <aside v-show="!navCollapsed" class="nav-area" :style="{ width: `${navWidth}px` }">
          <NavTree v-if="desk.status.value === 'ready'" />
        </aside>
      </div>

      <template v-if="viewsShown">
        <div class="divider dock-divider" @pointerdown="onDividerDown('dock', $event)" @pointermove="onDividerMove" @pointerup="onDividerUp" />
        <div class="dock-area" :style="{ width: `${dockRatio * 100}%` }">
          <DockPane />
        </div>
      </template>
    </div>

    <GuideDialog v-if="guideOpen" :section="guideSection" @close="guideOpen = false" />
    <EditDialog />
    <!-- F-10：「在此设计」（导航树、模型画布节点右键、属性面板）打开的新建设计对话框 -->
    <NewDesignDialog v-if="newDesignRequest" :mount="newDesignRequest.mount" @close="closeNewDesign" />
  </div>
</template>

<style scoped>
.desk {
  --toolbar-h: 44px;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* 第二十轮读先方案 §4：顶栏之下是画布 + 辅助栏双栏；抽屉与树都挂在画布上 */
.body {
  flex: 1 1 0;
  display: flex;
  min-width: 0;
  min-height: 0;
}

/* 导航树＝画布左缘的浮层抽屉（第二十轮 §4）：不挤压画布，实底投影 */
.nav-area {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
  box-shadow: var(--card-shadow);
}

.nav-area > :deep(.nav-tree) {
  flex: 1 1 0;
  height: auto;
  min-height: 0;
  overflow: hidden;
}

.top {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  height: var(--toolbar-h);
  padding: 0 10px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  min-width: 0;
  flex: none;
}

.top > .nav-toggle {
  margin-right: 4px;
}

.spacer {
  flex: 1 1 0;
  min-width: 0;
}

/* TB-1：视角段与右侧按钮都不收缩，工作列再窄挤掉的只是中间的空白 */
.top > * {
  flex-shrink: 0;
}

.top > .spacer {
  flex-shrink: 1;
}

.vsep {
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background: var(--border);
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

/* 选中面板＝抽屉（第二十轮 §4，取代 CD-2「属性卡片立在画布上」）：实底面板，挤压画布；放不下时浮在画布右侧、不透传点击 */
.props {
  position: relative;
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
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  border-left: 1px solid var(--border);
  box-shadow: var(--card-shadow);
}

/* CD-3：× 在属性列滚动区右上角、身份卡（第一张卡）的右上角（上沿 12、右沿 12）；身份卡粘顶（ADR-0061），× 恒在可视区，悬停身份卡或键盘聚焦时显出 */
.props-close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 7; /* 高于粘顶的身份卡（CD-3，ADR-0061）：× 悬在身份卡右上角、可单击 */
  border: none;
  background: none;
  font-size: 15px;
  line-height: 1;
  padding: 2px 6px;
  color: var(--text-3);
  opacity: 0;
  transition: opacity 0.15s;
}

.panel-area:has(.id-card:hover) .props-close,
.props-close:hover,
.props-close:focus-visible {
  opacity: 1;
}

.panel-area {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  scrollbar-width: thin;
}

/* CD-7：回放胶囊在画布底部居中（left 由 CD-8 推出：居中于未被悬浮卡片盖住的部分） */
.player-bar {
  position: absolute;
  bottom: 12px;
  z-index: 21;
}

/* TB-1：工作列放不下工具栏时资料区先让位 */
.dock-area {
  flex: 0 1 auto;
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
</style>
