<script setup lang="ts">
/**
 * 单个项目的架构视图：导航树 + 画布区 + 属性面板（W-1）；「专注」一键收起两侧栏。每次进入项目创建一份独立的 DeskState，
 * 其 watch 都在本组件作用域内，离开项目时随组件销毁。
 */
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { useRouter } from 'vue-router'
import { createDeskState, type ModelPayload } from '@/state/useDeskState'
import { isCommitVersion, type VersionRef } from '@/model'
import { httpSourceFetcher } from './source/httpSource'
import { DESK_STATE } from '@/state/inject'
import GraphCanvas from './GraphCanvas.vue'
import Breadcrumb from './Breadcrumb.vue'
import Toolbar from './Toolbar.vue'
import IssueBanner from './IssueBanner.vue'
import VersionSwitcher from './VersionSwitcher.vue'
import DesignBar from './DesignBar.vue'
import CommitBar from './CommitBar.vue'
import PerspectiveSwitch from './PerspectiveSwitch.vue'
import PlayerBar from './PlayerBar.vue'
import SplitView from './split/SplitView.vue'
import AsidePane from './split/AsidePane.vue'
import { useAside } from './split/useAside'
import { directionOf, readLayout, resize, saveLayout, setDirection, toggleSlot, type PaneLayout } from './split/paneLayout'
import Panel from './panel/Panel.vue'
import NavTree from './tree/NavTree.vue'
import { OPEN_PREVIEW } from './shared/preview'
import { STAGE_DISPLAY, useStageDisplay } from './stage/useStageDisplay'

const props = defineProps<{ project: string; design?: string; revision?: string; commit?: string; base?: string }>()
const router = useRouter()
// 设计版本（ADR-0002）或提交版本（E5、E6）；都没有时为当前版本
const version: VersionRef | undefined = props.commit
  ? { commit: props.commit, ...(props.base ? { base: props.base } : {}) }
  : props.design && props.revision
    ? { design: props.design, revision: props.revision }
    : undefined

async function fetchModel(): Promise<ModelPayload> {
  const enc = encodeURIComponent
  const file = isCommitVersion(version)
    ? `models/${enc(props.project)}/commits/${enc(version.commit)}.json${version.base ? `?base=${enc(version.base)}` : ''}`
    : version
      ? `models/${enc(props.project)}/designs/${enc(version.design)}/${enc(version.revision)}.json`
      : `models/${enc(props.project)}.json`
  const what = isCommitVersion(version)
    ? `提交「${version.commit.slice(0, 8)}」`
    : version
      ? `设计版本「${version.design} / ${version.revision}」`
      : `项目「${props.project}」`
  const res = await fetch(`${import.meta.env.BASE_URL}${file}`, { cache: 'no-store' })
  if (res.status === 404) throw new Error(`${what}不存在`)
  if (!res.ok) throw new Error(`读取${what}失败：HTTP ${res.status}`)
  return res.json()
}

const desk = createDeskState(fetchModel, { project: props.project, version, source: httpSourceFetcher(props.project, import.meta.env.BASE_URL) })
desk.attachRouter(router)
provide(DESK_STATE, desk)
// 开发态便于在浏览器控制台检查状态
if (import.meta.env.DEV) (window as unknown as { __desk: typeof desk }).__desk = desk

// 开发态：本项目的描述文件变化后重新加载，保留当前层次与选中
const unwatchModel = desk.watchChanges(import.meta.hot)
onBeforeUnmount(unwatchModel)
void router.isReady().then(() => desk.init())

// 导航树与属性面板：宽度可拖动、可折叠，记在本地（W-1）
function readNumber(key: string, min: number, max: number, fallback: number): number {
  try {
    const w = Number(localStorage.getItem(key))
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

const panelWidth = ref(readNumber('h5p-arch-desk:panel-width', 280, 900, 420))
const collapsed = ref(readNumber('h5p-arch-desk:panel-collapsed', 0, 1, 0) === 1)
function togglePanel() {
  collapsed.value = !collapsed.value
  store('h5p-arch-desk:panel-collapsed', collapsed.value ? '1' : '0')
}

const navWidth = ref(readNumber('h5p-arch-desk:nav-width', 180, 520, 260))
const navCollapsed = ref(readNumber('h5p-arch-desk:nav-collapsed', 0, 1, 0) === 1)
function toggleNav() {
  navCollapsed.value = !navCollapsed.value
  store('h5p-arch-desk:nav-collapsed', navCollapsed.value ? '1' : '0')
}
// W-1：专注——任一侧栏展开时全部收起；都已收起时全部恢复
const focused = computed(() => navCollapsed.value && collapsed.value)
function toggleFocus() {
  const open = focused.value
  if (navCollapsed.value !== !open) toggleNav()
  if (collapsed.value !== !open) togglePanel()
}

let dragging: 'panel' | 'nav' | null = null
function onDividerDown(which: 'panel' | 'nav', e: PointerEvent) {
  dragging = which
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}
function onDividerMove(e: PointerEvent) {
  if (dragging === 'panel') panelWidth.value = Math.min(900, Math.max(280, window.innerWidth - e.clientX))
  else if (dragging === 'nav') navWidth.value = Math.min(520, Math.max(180, e.clientX))
}
function onDividerUp() {
  if (dragging === 'panel') store('h5p-arch-desk:panel-width', String(panelWidth.value))
  else if (dragging === 'nav') store('h5p-arch-desk:nav-width', String(navWidth.value))
  dragging = null
}

// 副栏（G15）：页签与预览文件只属于这块界面
const aside = useAside(desk)
const { previewPath, tab: asideTab, run } = aside
provide(OPEN_PREVIEW, aside.open)

// 舞台显示（V8、V9）：只属于画布这块界面
provide(STAGE_DISPLAY, useStageDisplay(props.project, desk))

// 画布区分屏：结构图与副栏左右或上下排列（W-4），方向、比例与收起状态按项目记在本地
const paneLayout = ref<PaneLayout>(readLayout(props.project))
const paneDir = computed(() => directionOf(paneLayout.value))
function onDirection(dir: 'row' | 'column') {
  paneLayout.value = setDirection(paneLayout.value, dir)
  saveLayout(props.project, paneLayout.value)
}
function onResize(path: number[], i: number, ratio: number) {
  paneLayout.value = resize(paneLayout.value, path, i, ratio)
  saveLayout(props.project, paneLayout.value)
}
function onToggle(slot: 'structure' | 'aside') {
  paneLayout.value = toggleSlot(paneLayout.value, slot)
  saveLayout(props.project, paneLayout.value)
}

// 键盘：Esc 先取消选中，再返回上级；Backspace 返回上级，根层回项目列表（N7、N9）；
// 运行视角：← → 单步，数字键选分支
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  if (t.closest('input, textarea, select, [contenteditable="true"]')) return
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
  <div class="desk" :style="{ '--panel-w': collapsed ? '0px' : `${panelWidth}px`, '--nav-w': navCollapsed ? '0px' : `${navWidth}px` }">
    <header class="top">
      <button class="collapse nav-toggle" :title="navCollapsed ? '展开导航树' : '收起导航树'" @click="toggleNav">
        {{ navCollapsed ? '导航 ›' : '‹ 导航' }}
      </button>
      <VersionSwitcher />
      <PerspectiveSwitch v-if="desk.status.value === 'ready'" />
      <Breadcrumb />
      <Toolbar />
      <button class="collapse" :class="{ on: focused }" :title="focused ? '恢复导航树与属性面板' : '收起导航树与属性面板'" @click="toggleFocus">
        {{ focused ? '退出专注' : '专注' }}
      </button>
      <button class="collapse panel-toggle" :title="collapsed ? '展开属性面板' : '收起属性面板'" @click="togglePanel">
        {{ collapsed ? '‹ 面板' : '面板 ›' }}
      </button>
    </header>

    <CommitBar v-if="isCommitVersion(version) && desk.status.value === 'ready'" class="design-bar" />
    <DesignBar v-else-if="version && desk.status.value === 'ready'" class="design-bar" />

    <aside v-show="!navCollapsed" class="nav-area">
      <NavTree v-if="desk.status.value === 'ready'" />
    </aside>
    <div v-show="!navCollapsed" class="divider nav-divider" @pointerdown="onDividerDown('nav', $event)" @pointermove="onDividerMove" @pointerup="onDividerUp" />

    <main class="canvas-area">
      <div v-if="desk.status.value === 'loading'" class="state">正在加载架构描述…</div>
      <div v-else-if="desk.status.value === 'error'" class="state error">
        <strong>无法加载架构描述</strong>
        <p>{{ desk.loadError.value }}</p>
        <div class="actions">
          <button @click="desk.reload()">重试</button>
          <button @click="router.push('/')">返回项目列表</button>
        </div>
      </div>
      <template v-else>
        <SplitView :layout="paneLayout" :hidden="aside.hidden.value ? ['aside'] : []" @resize="onResize" @toggle="onToggle">
          <template #structure>
            <GraphCanvas />
            <IssueBanner />
          </template>
          <template #aside="{ collapsed, toggle }">
            <AsidePane
              v-if="!aside.hidden.value"
              :collapsed="collapsed"
              :dir="paneDir"
              :tab="asideTab"
              :run="run"
              :preview-path="previewPath"
              @toggle="toggle"
              @direction="onDirection"
              @tab="t => (asideTab = t)"
              @close="aside.close"
            />
          </template>
        </SplitView>
        <PlayerBar v-if="desk.perspective.value === 'run'" class="player-bar" />
      </template>
    </main>

    <div
      v-show="!collapsed"
      class="divider panel-divider"
      @pointerdown="onDividerDown('panel', $event)"
      @pointermove="onDividerMove"
      @pointerup="onDividerUp"
    />
    <aside v-show="!collapsed" class="panel-area">
      <Panel v-if="desk.status.value === 'ready'" />
    </aside>
  </div>
</template>

<style scoped>
.desk {
  display: grid;
  grid-template-columns: var(--nav-w) auto minmax(0, 1fr) auto var(--panel-w);
  grid-template-rows: auto auto minmax(0, 1fr);
  height: 100%;
}

.design-bar {
  grid-column: 1 / -1;
}

.top {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 14px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  min-width: 0;
}

.collapse {
  margin-left: auto;
  flex: none;
  font-size: 12px;
}

.nav-toggle {
  margin-left: 0;
}

.panel-toggle {
  margin-left: 0;
}

.collapse.on {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
}

.nav-area {
  grid-row: 3;
  grid-column: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-right: 1px solid var(--border);
}

.nav-divider {
  grid-column: 2;
}

.panel-divider {
  grid-column: 4;
}

.canvas-area {
  grid-row: 3;
  grid-column: 3;
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.canvas-area > :deep(.split) {
  flex: 1 1 auto;
}

.player-bar {
  flex: none;
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
  grid-row: 3;
  width: 5px;
  cursor: col-resize;
  background: var(--border);
  border-left: 2px solid var(--bg);
  border-right: 2px solid var(--bg);
}

.divider:hover {
  background: var(--accent);
}

.panel-area {
  grid-row: 3;
  grid-column: 5;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: var(--surface);
}
</style>
