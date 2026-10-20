<script setup lang="ts">
/** 按布局树排布画布区的视图；槽位内容由父组件以同名插槽提供，并拿到 collapsed / toggle */
import { ref } from 'vue'
import type { PaneLayout, PaneSlot } from './paneLayout'

defineOptions({ name: 'SplitView' })
const props = withDefaults(defineProps<{ layout: PaneLayout; path?: number[]; hidden?: PaneSlot[] }>(), { path: () => [], hidden: () => [] })
const emit = defineEmits<{ resize: [path: number[], i: number, ratio: number]; toggle: [slot: PaneSlot] }>()
type SlotProps = { collapsed: boolean; toggle: () => void }
defineSlots<{ structure?: (p: SlotProps) => unknown; sequence?: (p: SlotProps) => unknown }>()
const toggleSelf = () => props.layout.kind === 'pane' && emit('toggle', props.layout.slot)
const box = ref<HTMLElement>()

function isHidden(l: PaneLayout): boolean {
  return l.kind === 'pane' ? props.hidden.includes(l.slot) : l.children.every(isHidden)
}
function isCollapsed(l: PaneLayout): boolean {
  return l.kind === 'pane' ? !!l.collapsed : l.children.every(isCollapsed)
}

/** 每块的 flex：隐藏的不占位；收起的只占一条标题栏 */
function flexOf(k: number): string {
  if (props.layout.kind !== 'split') return '1 1 0'
  const child = props.layout.children[k]
  const visible = props.layout.children.filter(c => !isHidden(c) && !isCollapsed(c))
  if (isCollapsed(child)) return '0 0 auto'
  if (visible.length === 1) return '1 1 0'
  return `${props.layout.sizes[k]} 1 0`
}

let dragging = -1
function onDown(i: number, e: PointerEvent) {
  dragging = i
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}
function onMove(e: PointerEvent) {
  if (dragging < 0 || !box.value || props.layout.kind !== 'split') return
  const r = box.value.getBoundingClientRect()
  const ratio = props.layout.dir === 'column' ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width
  emit('resize', props.path, dragging, ratio)
}
function onUp() {
  dragging = -1
}
</script>

<template>
  <div v-if="layout.kind === 'pane'" class="pane" :class="{ collapsed: layout.collapsed }">
    <slot :name="layout.slot" :collapsed="!!layout.collapsed" :toggle="toggleSelf" />
  </div>
  <div v-else ref="box" class="split" :class="layout.dir">
    <template v-for="(child, k) in layout.children" :key="k">
      <div
        v-if="k > 0 && !isHidden(child) && !isHidden(layout.children[k - 1]) && !isCollapsed(child) && !isCollapsed(layout.children[k - 1])"
        class="divider"
        @pointerdown="onDown(k - 1, $event)"
        @pointermove="onMove"
        @pointerup="onUp"
      />
      <div v-show="!isHidden(child)" class="cell" :style="{ flex: flexOf(k) }">
        <SplitView :layout="child" :path="[...path, k]" :hidden="hidden" @resize="(p, i, r) => emit('resize', p, i, r)" @toggle="s => emit('toggle', s)">
          <template v-for="name in ['structure', 'sequence'] as const" #[name]="slotProps: SlotProps" :key="name">
            <slot :name="name" v-bind="slotProps" />
          </template>
        </SplitView>
      </div>
    </template>
  </div>
</template>

<style scoped>
.split {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.split.column {
  flex-direction: column;
}

.cell {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: flex;
}

.pane {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.divider {
  flex: none;
  background: var(--border);
}

.column > .divider {
  height: 5px;
  cursor: row-resize;
  border-top: 2px solid var(--bg);
  border-bottom: 2px solid var(--bg);
}

.row > .divider {
  width: 5px;
  cursor: col-resize;
}

.divider:hover {
  background: var(--accent);
}
</style>
