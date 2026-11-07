<script setup lang="ts">
/**
 * 视图区（LY-7–LY-12，ADR-0064）：页头是主语条，其下一到两组标签上下排列，组高按分隔比例（LY-10b），分隔可拖。
 * 拖拽标签（LY-10）：拖到另一组的标签栏或组内换序；只有一组时拖动中出现下半区的落点「拖到这里，上下对照」= 开下组；一组拖空即合并（状态层 normalize）。
 * 视图标签跟随主语，资料标签不跟随；只读工作区状态、只发意图（desk.workspace.dispatch）。
 */
import { provide, ref } from 'vue'
import { useDesk } from '@/state/inject'
import DockGroup from './DockGroup.vue'
import SubjectBar from './SubjectBar.vue'
import { TAB_DRAG } from './tabDrag'

const desk = useDesk()
const ws = desk.workspace
/** 正在拖的标签（HTML5 拖放；只在视图区内有效） */
const dragging = ref<string | null>(null)
provide(TAB_DRAG, dragging)
const zoneOver = ref(false)
function dropZone() {
  const id = dragging.value
  zoneOver.value = false
  dragging.value = null
  if (id) ws.dispatch({ type: 'move', id, group: 1, index: 0 })
}

// LY-10：上下两组的分隔可拖（比例 0.2–0.8 由状态层夹住）
const groupsEl = ref<HTMLElement>()
function onSplitDown(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const move = (ev: PointerEvent) => {
    const r = groupsEl.value?.getBoundingClientRect()
    if (r && r.height > 0) ws.dispatch({ type: 'setSplit', split: (ev.clientY - r.top) / r.height })
  }
  const up = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}
</script>

<template>
  <section class="views" aria-label="视图" data-region="views">
    <SubjectBar />
    <div ref="groupsEl" class="groups" :class="{ dragging: !!dragging }">
      <template v-for="(g, gi) in ws.state.value.groups" :key="gi">
        <div v-if="gi > 0" class="gsplit" role="separator" aria-orientation="horizontal" aria-label="拖动调整上下组高度" @pointerdown="onSplitDown" />
        <DockGroup
          :group="g"
          :gi="gi"
          :count="ws.state.value.groups.length"
          :style="ws.state.value.groups.length > 1 ? { flex: `${gi === 0 ? ws.state.value.split : 1 - ws.state.value.split} 1 0` } : undefined"
        />
      </template>
      <div
        v-if="dragging && ws.state.value.groups.length === 1 && ws.state.value.groups[0].tabs.length > 1"
        class="splitzone"
        :class="{ over: zoneOver }"
        data-splitzone
        @dragover.prevent="zoneOver = true"
        @dragleave="zoneOver = false"
        @drop.prevent="dropZone"
      >
        拖到这里，上下对照
      </div>
    </div>
  </section>
</template>

<style scoped>
.views {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: var(--surface);
}

.groups {
  position: relative;
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.gsplit {
  flex: none;
  height: 5px;
  cursor: row-resize;
  background: var(--surface);
  border-top: 1px solid var(--border);
}

.gsplit:hover {
  background: var(--border);
}

.splitzone {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 10px;
  height: 38%;
  display: grid;
  place-items: center;
  border: 1.5px dashed var(--border-strong);
  border-radius: 10px;
  font-size: 12.5px;
  color: var(--text-2);
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  z-index: 4;
}

.splitzone.over {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
