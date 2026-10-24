<script setup lang="ts">
/**
 * 草图画布的边（F-22、X15）：两端中心之间的直线，裁到两端节点的边框；同一对节点的多条线按草图布局给的平移量错开；
 * 不走线、不避让。标签在中点或 layout.relations 记下的位置；选中的边可拖动标签，松手为一步（relabel）。待重连的线为红色虚线。
 * 聚合边（05 裁决 4：本层模块与同一个折叠引用之间的多条关系）标「N 条」，点它选中引用节点（面板展开精确关系），标签不能拖。
 * 引用线（X22）：从模块朝引用列的一侧端口（左侧列进左端口、右侧列进右端口）到引用节点朝中心区的一侧，水平切线的曲线；画在模块之上，
 * 细、半透明、不接收指针、不带标签（条数在引用节点上），相关节点选中或悬停时（hot）实色。
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
  data: SketchEdgeData & { sizes: { a: { w: number; h: number }; b: { w: number; h: number } }; hot?: boolean }
}>()
const desk = useDesk()
const { viewport } = useVueFlow('sketch')

const geo = computed(() =>
  straightEdge({ x: props.sourceX, y: props.sourceY }, { x: props.targetX, y: props.targetY }, props.data.sizes.a, props.data.sizes.b, props.data.offset),
)
/** X22：引用线的两端端口与各自朝外的方向（+1 向右、-1 向左） */
const ports = computed(() => {
  const side = props.data.external
  if (!side) return null
  const away = side === 'left' ? -1 : 1
  const refIsSource = props.data.refEnd === 'source'
  const end = (x: number, y: number, w: number, ref: boolean) => {
    const dir = ref ? -away : away
    return { x: x + (dir * w) / 2, y: y + props.data.offset, dir }
  }
  return {
    from: end(props.sourceX, props.sourceY, props.data.sizes.a.w, refIsSource),
    to: end(props.targetX, props.targetY, props.data.sizes.b.w, !refIsSource),
  }
})
const path = computed(() => {
  const p = ports.value
  if (!p) return `M ${geo.value.from.x} ${geo.value.from.y} L ${geo.value.to.x} ${geo.value.to.y}`
  const k = Math.max(40, Math.abs(p.to.x - p.from.x) / 2)
  return `M ${p.from.x} ${p.from.y} C ${p.from.x + p.from.dir * k} ${p.from.y} ${p.to.x + p.to.dir * k} ${p.to.y} ${p.to.x} ${p.to.y}`
})
/** 终点的箭头（引用线的终点切线水平、指向端口里面） */
const arrow = computed(() => {
  const p = ports.value
  const to = p ? p.to : geo.value.to
  const from = p ? { x: p.to.x + p.to.dir, y: p.to.y } : geo.value.from
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1
  const ux = (to.x - from.x) / len
  const uy = (to.y - from.y) / len
  const s = 8
  const q = (k: number, n: number) => `${to.x - ux * k + -uy * n},${to.y - uy * k + ux * n}`
  return `${to.x},${to.y} ${q(s, s / 2)} ${q(s, -s / 2)}`
})
/** L12、X23：经端口的线在终点画插座（开口半圆，凸向终点、把箭头插在里面；与画布同一记号） */
const socket = computed(() => {
  if (!props.data.port) return ''
  const p = ports.value
  const to = p ? p.to : geo.value.to
  const from = p ? { x: p.to.x + p.to.dir, y: p.to.y } : geo.value.from
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1
  const ux = (to.x - from.x) / len
  const uy = (to.y - from.y) / len
  const r = 7
  const c = { x: to.x - ux * (r - 2), y: to.y - uy * (r - 2) }
  const k = (4 / 3) * r
  const a = { x: c.x - uy * r, y: c.y + ux * r }
  const b = { x: c.x + uy * r, y: c.y - ux * r }
  return `M ${a.x} ${a.y} C ${a.x + ux * k} ${a.y + uy * k} ${b.x + ux * k} ${b.y + uy * k} ${b.x} ${b.y}`
})
/** 拖动中的标签位置（松手才写回） */
const dragging = ref<{ x: number; y: number } | null>(null)
const label = computed(() => dragging.value ?? props.data.label ?? geo.value.mid)
const many = computed(() => props.data.relationIds?.length ?? 0)
const typeLabel = computed(() => (many.value ? `${many.value} 条关系（折叠显示）` : (RELATION_TYPE_LABELS[props.data.type as RelationType] ?? props.data.type)))
/** 标签：聚合边标条数；写了说明的显示说明；没写的只在选中时显示类型（线多时不堆满画布） */
const text = computed(() =>
  props.data.external ? '' : many.value ? `${many.value} 条` : props.data.description || (props.data.selected ? typeLabel.value : ''),
)

let start: { px: number; py: number; x: number; y: number } | null = null
function onDown(e: PointerEvent) {
  if (many.value) {
    e.stopPropagation()
    if (props.data.reference) desk.select({ kind: 'module', id: props.data.reference })
    return
  }
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
  <g
    class="sk-edge"
    :class="[data.type, { selected: data.selected, pending: data.pending, changed: !!data.change, many: many > 1, external: !!data.external, hot: data.hot }]"
  >
    <path v-if="!data.external" :d="path" class="hit" />
    <path :d="path" class="line" />
    <polygon :points="arrow" class="head" />
    <path v-if="socket" :d="socket" class="socket" />
  </g>
  <EdgeLabelRenderer v-if="text">
    <div
      class="sk-edge-label nodrag nopan"
      :class="{ selected: data.selected, pending: data.pending, many: many > 1 }"
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

.socket {
  fill: none;
  stroke: var(--text-2);
  stroke-width: 1.5;
}

.sk-edge.many .line {
  stroke-width: 2.5;
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

.sk-edge.external {
  pointer-events: none;
}

.sk-edge.external .line {
  stroke-width: 1;
  opacity: 0.3;
}

.sk-edge.external .head {
  opacity: 0.3;
}

.sk-edge.external.hot .line,
.sk-edge.external.hot .head {
  opacity: 1;
}

.sk-edge.external.hot .line {
  stroke: var(--text-2);
  stroke-width: 1.5;
}

.sk-edge.external.hot .head {
  fill: var(--text-2);
}

.sk-edge.external.selected .line {
  stroke: var(--accent);
}

.sk-edge.external.selected .head {
  fill: var(--accent);
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

.sk-edge-label.many {
  font-weight: 600;
  color: var(--text-3);
}

.sk-edge-label.pending {
  border-color: var(--danger);
  color: var(--danger);
}
</style>
