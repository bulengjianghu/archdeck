<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useDesk } from './state/inject'
import GraphCanvas from './components/GraphCanvas.vue'
import Breadcrumb from './components/Breadcrumb.vue'
import Toolbar from './components/Toolbar.vue'
import IssueBanner from './components/IssueBanner.vue'
import Panel from './components/panel/Panel.vue'

const desk = useDesk()

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
    desk.goUp()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="desk" :style="{ '--panel-w': collapsed ? '0px' : `${panelWidth}px` }">
    <header class="top">
      <Breadcrumb />
      <Toolbar />
      <button class="collapse" :title="collapsed ? '展开属性面板' : '收起属性面板'" @click="collapsed = !collapsed">
        {{ collapsed ? '‹ 面板' : '面板 ›' }}
      </button>
    </header>

    <main class="canvas-area">
      <div v-if="desk.status.value === 'loading'" class="state">正在加载架构描述…</div>
      <div v-else-if="desk.status.value === 'error'" class="state error">
        <strong>无法加载架构描述</strong>
        <p>{{ desk.loadError.value }}</p>
        <button @click="desk.reload()">重试</button>
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
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
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

.state.error strong {
  color: var(--danger);
}

.divider {
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
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: var(--surface);
}
</style>
