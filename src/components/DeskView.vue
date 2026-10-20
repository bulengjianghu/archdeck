<script setup lang="ts">
/**
 * 单个项目的架构视图：画布 + 属性面板。每次进入项目创建一份独立的 DeskState，
 * 其 watch 都在本组件作用域内，离开项目时随组件销毁。
 */
import { onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { useRouter } from 'vue-router'
import { createDeskState, type ModelPayload } from '@/state/useDeskState'
import { DESK_STATE } from '@/state/inject'
import GraphCanvas from './GraphCanvas.vue'
import Breadcrumb from './Breadcrumb.vue'
import Toolbar from './Toolbar.vue'
import IssueBanner from './IssueBanner.vue'
import VersionSwitcher from './VersionSwitcher.vue'
import DesignBar from './DesignBar.vue'
import PerspectiveSwitch from './PerspectiveSwitch.vue'
import PlayerBar from './PlayerBar.vue'
import SequenceView from './sequence/SequenceView.vue'
import SplitView from './split/SplitView.vue'
import { readLayout, resize, saveLayout, toggleSlot, type PaneLayout } from './split/paneLayout'
import Panel from './panel/Panel.vue'

const props = defineProps<{ project: string; design?: string; revision?: string }>()
const router = useRouter()
const version = props.design && props.revision ? { design: props.design, revision: props.revision } : undefined

async function fetchModel(): Promise<ModelPayload> {
  const enc = encodeURIComponent
  const file = version ? `models/${enc(props.project)}/designs/${enc(version.design)}/${enc(version.revision)}.json` : `models/${enc(props.project)}.json`
  const what = version ? `设计版本「${version.design} / ${version.revision}」` : `项目「${props.project}」`
  const res = await fetch(`${import.meta.env.BASE_URL}${file}`, { cache: 'no-store' })
  if (res.status === 404) throw new Error(`${what}不存在`)
  if (!res.ok) throw new Error(`读取${what}失败：HTTP ${res.status}`)
  return res.json()
}

const desk = createDeskState(fetchModel, { project: props.project, version })
desk.attachRouter(router)
provide(DESK_STATE, desk)
// 开发态便于在浏览器控制台检查状态
if (import.meta.env.DEV) (window as unknown as { __desk: typeof desk }).__desk = desk

// 开发态：本项目的描述文件变化后重新加载，保留当前层次与选中
const unwatchModel = desk.watchChanges(import.meta.hot)
onBeforeUnmount(unwatchModel)
void router.isReady().then(() => desk.init())

// 面板宽度可拖动、可折叠
const panelWidth = ref(readWidth())
const collapsed = ref(false)
let dragging = false

function readWidth(): number {
  try {
    const w = Number(localStorage.getItem('h5p-arch-desk:panel-width'))
    return w >= 280 && w <= 900 ? w : 420
  } catch {
    return 420
  }
}

function onDividerDown(e: PointerEvent) {
  dragging = true
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}
function onDividerMove(e: PointerEvent) {
  if (!dragging) return
  panelWidth.value = Math.min(900, Math.max(280, window.innerWidth - e.clientX))
}
function onDividerUp() {
  if (!dragging) return
  dragging = false
  try {
    localStorage.setItem('h5p-arch-desk:panel-width', String(panelWidth.value))
  } catch {
    /* 存不了就算了 */
  }
}

// 画布区分屏：上结构图、下时序图（W-4），比例与收起状态按项目记在本地
const paneLayout = ref<PaneLayout>(readLayout(props.project))
function onResize(path: number[], i: number, ratio: number) {
  paneLayout.value = resize(paneLayout.value, path, i, ratio)
  saveLayout(props.project, paneLayout.value)
}
function onToggle(slot: 'structure' | 'sequence') {
  paneLayout.value = toggleSlot(paneLayout.value, slot)
  saveLayout(props.project, paneLayout.value)
}

// 键盘：Esc 先取消选中，再返回上级；Backspace 返回上级，根层回项目列表（N7、N9）；
// 运行视角：← → 单步，空格播放 / 暂停，数字键选分支
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  if (t.closest('input, textarea, select, [contenteditable="true"]')) return
  if (desk.perspective.value === 'run') {
    const bp = desk.branchPoint.value
    if (e.key === 'ArrowRight') desk.next()
    else if (e.key === 'ArrowLeft') desk.prev()
    else if (e.key === ' ') desk.playback.value?.playing ? desk.pause() : desk.play()
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
  <div class="desk" :style="{ '--panel-w': collapsed ? '0px' : `${panelWidth}px` }">
    <header class="top">
      <VersionSwitcher />
      <PerspectiveSwitch v-if="desk.status.value === 'ready'" />
      <Breadcrumb />
      <Toolbar />
      <button class="collapse" :title="collapsed ? '展开属性面板' : '收起属性面板'" @click="collapsed = !collapsed">
        {{ collapsed ? '‹ 面板' : '面板 ›' }}
      </button>
    </header>

    <DesignBar v-if="version && desk.status.value === 'ready'" class="design-bar" />

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
        <SplitView :layout="paneLayout" :hidden="desk.perspective.value === 'run' ? [] : ['sequence']" @resize="onResize" @toggle="onToggle">
          <template #structure>
            <GraphCanvas />
            <IssueBanner />
          </template>
          <template #sequence="{ collapsed, toggle }">
            <SequenceView v-if="desk.perspective.value === 'run'" :collapsed="collapsed" @toggle="toggle" />
          </template>
        </SplitView>
        <PlayerBar v-if="desk.perspective.value === 'run'" class="player-bar" />
      </template>
    </main>

    <div
      v-show="!collapsed"
      class="divider"
      @pointerdown="onDividerDown"
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
  grid-template-columns: minmax(0, 1fr) auto var(--panel-w);
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

.canvas-area {
  grid-row: 3;
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
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: var(--surface);
}
</style>
