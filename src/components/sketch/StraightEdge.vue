<script setup lang="ts">
/**
 * 草图画布的边（F-22、X15）：两端中心之间的直线，裁到两端节点的边框；同一对节点的多条线按草图布局给的平移量错开；
 * 不走线、不避让。标签在中点或 layout.relations 记下的位置；选中的边可拖动标签，松手为一步（relabel）。待重连的线为红色虚线。
 */
import { computed, ref } from 'vue'
import { EdgeLabelRenderer, useVueFlow } from '@vue-flow/core'
import { straightEdge, type SketchEdgeData } from '@/layout/layout'
import type { RelationType } from '@/model'
import { useDesk } from '@/state/inject'
import { RELATION_TYPE_LABELS } from '../shared/labels'

const props = defineProps<{
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  data: SketchEdgeData & { sizes: { a: { w: number; h: number }; b: { w: number; h: number } } }
}>()
const desk = useDesk()
const { viewport } = useVueFlow('sketch')

const geo = computed(() =>
  straightEdge({ x: props.sourceX, y: props.sourceY }, { x: props.targetX, y: props.targetY }, props.data.sizes.a, props.data.sizes.b, props.data.offset),
)
const path = computed(() => `M ${geo.value.from.x} ${geo.value.from.y} L ${geo.value.to.x} ${geo.value.to.y}`)
/** 终点的箭头 */
const arrow = computed(() => {
  const { from, to } = geo.value
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1
  const ux = (to.x - from.x) / len
  const uy = (to.y - from.y) / len
  const s = 8
  const p = (k: number, n: number) => `${to.x - ux * k + -uy * n},${to.y - uy * k + ux * n}`
  return `${to.x},${to.y} ${p(s, s / 2)} ${p(s, -s / 2)}`
})
/** 拖动中的标签位置（松手才写回） */
const dragging = ref<{ x: number; y: number } | null>(null)
const label = computed(() => dragging.value ?? props.data.label ?? geo.value.mid)
const typeLabel = computed(() => RELATION_TYPE_LABELS[props.data.type as RelationType] ?? props.data.type)
/** 标签：写了说明的显示说明；没写的只在选中时显示类型（线多时不堆满画布） */
const text = computed(() => props.data.description || (props.data.selected ? typeLabel.value : ''))

let start: { px: number; py: number; x: number; y: number } | null = null
function onDown(e: PointerEvent) {
  desk.select({ kind: 'relation', id: props.id })
  if (!props.data.selected) return
  e.stopPropagation()
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  start = { px: e.clientX, py: e.clientY, ...label.value }
}
function onMove(e: PointerEvent) {
  if (!start) return
  const z = viewport.value.zoom || 1
  dragging.value = { x: start.x + (e.clientX - start.px) / z, y: start.y + (e.clientY - start.py) / z }
}
function onUp() {
  const to = dragging.value
  start = null
  dragging.value = null
  if (to) desk.edit.relabel(props.id, { x: Math.round(to.x), y: Math.round(to.y) })
}
</script>

<template>
  <g class="sk-edge" :class="[data.type, { selected: data.selected, pending: data.pending, changed: !!data.change }]">
    <path :d="path" class="hit" />
    <path :d="path" class="line" />
    <polygon :points="arrow" class="head" />
  </g>
  <EdgeLabelRenderer v-if="text">
    <div
      class="sk-edge-label nodrag nopan"
      :class="{ selected: data.selected, pending: data.pending }"
      :style="{ transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)` }"
      :data-relation="id"
      :title="`${typeLabel}${data.selected ? '（拖动可移动标签）' : ''}`"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
    >
      {{ text }}
    </div>
  </EdgeLabelRenderer>
</template>

<style scoped>
.hit {
  fill: none;
  stroke: transparent;
  stroke-width: 14;
}

.line {
  fill: none;
  stroke: var(--text-3);
  stroke-width: 1.5;
}

.head {
  fill: var(--text-3);
}

.sk-edge.depends .line {
  stroke-dasharray: 6 4;
}

.sk-edge.selected .line {
  stroke: var(--accent);
  stroke-width: 2.5;
}

.sk-edge.selected .head {
  fill: var(--accent);
}

.sk-edge.changed .line {
  stroke: var(--diff-added);
}

.sk-edge.pending .line {
  stroke: var(--danger);
  stroke-dasharray: 4 3;
}

.sk-edge-label {
  position: absolute;
  max-width: 180px;
  padding: 1px 6px;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  pointer-events: all;
  cursor: pointer;
}

.sk-edge-label.selected {
  border-color: var(--accent);
  color: var(--accent);
  cursor: move;
}

.sk-edge-label.pending {
  border-color: var(--danger);
  color: var(--danger);
}
</style>
