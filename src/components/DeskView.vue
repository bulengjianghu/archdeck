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
const onModelChanged = (data: { project?: string }) => {
  if (data?.project === props.project) void desk.reload()
}
import.meta.hot?.on('arch-model:changed', onModelChanged)
onBeforeUnmount(() => import.meta.hot?.off('arch-model:changed', onModelChanged))
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

// 键盘：Esc 先取消选中，再返回上级；Backspace 直接返回上级
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  if (t.closest('input, textarea, [contenteditable="true"]')) return
  if (e.key === 'Escape') {
    if (desk.selection.value) desk.select(null)
    else desk.goUp()
  } else if (e.key === 'Backspace') {
    e.preventDefault()
    // 已在项目根层时回到项目列表
    if (desk.levelPath.value.length <= 1) void router.push('/')
    else desk.goUp()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="desk" :style="{ '--panel-w': collapsed ? '0px' : `${panelWidth}px` }">
    <header class="top">
      <VersionSwitcher />
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
        <GraphCanvas />
        <IssueBanner />
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
