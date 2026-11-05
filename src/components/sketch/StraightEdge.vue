<script setup lang="ts">
/**
 * 草图画布的边（F-22、X15）：本层之间的线与模型画布同一套正交走线（T2.5，草图布局给出折线，节点位置取草图的，避让节点、同对错开）；
 * 拖动中节点离开草图里的位置时退回两端中心之间的直线（松手后重新走线）。标签在中点或 layout.relations 记下的位置；选中的边可拖动标签，松手为一步（relabel）。草图的线都是交互，一律实线（L18，ADR-0035）；待重连的线为红色实线、标签标红。
 * 聚合边（05 裁决 4：本层模块与同一个折叠引用之间的多条关系）标「N 条」，点它选中引用节点（面板展开精确关系），标签不能拖。
 * 引用线（X22）：从模块朝引用列的一侧端口（左侧列进左端口、右侧列进右端口）到引用节点朝中心区的一侧，水平切线的曲线；画在模块之上，
 * 细、半透明、不接收指针、不带标签（条数在引用节点上），相关节点选中或悬停时（hot）实色。
 */
import { computed, ref } from 'vue'
import { EdgeLabelRenderer, useVueFlow } from '@vue-flow/core'
import { mechTags, pointAlong, straightEdge, type SketchEdgeData } from '@/layout/layout'
import { roundedPolyline } from '../edges/routePath'
import { composePill } from '@/layout/canvas'
import type { RelationType } from '@/model'
import { useDesk } from '@/state/inject'
import { RELATION_TYPE_LABELS } from '../shared/labels'

const props = defineProps<{
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  data: SketchEdgeData & {
    sizes: { a: { w: number; h: number }; b: { w: number; h: number } }
    centers?: { a: { x: number; y: number }; b: { x: number; y: number } }
    hot?: boolean
    hovered?: boolean
    /** CI-3：改动项的号、刚应用的一轮、改动页签里正悬停 */
    number?: number
    recent?: boolean
  }
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
/** T2.5：走好的折线——两端还在草图里的位置时用它（拖动中退回直线） */
const route = computed(() => {
  const r = props.data.route
  const c = props.data.centers
  if (!r || r.length < 2 || !c) return null
  // 句柄是节点中心的 1px 隐藏点，Vue Flow 报的坐标与中心差一两个像素：差 6px 以内算还在原位
  const near = (a: { x: number; y: number }, x: number, y: number) => Math.abs(a.x - x) < 6 && Math.abs(a.y - y) < 6
  return near(c.a, props.sourceX, props.sourceY) && near(c.b, props.targetX, props.targetY) ? r : null
})
const path = computed(() => {
  const p = ports.value
  if (!p && route.value) return roundedPolyline(route.value)
  if (!p) return `M ${geo.value.from.x} ${geo.value.from.y} L ${geo.value.to.x} ${geo.value.to.y}`
  const k = Math.max(40, Math.abs(p.to.x - p.from.x) / 2)
  return `M ${p.from.x} ${p.from.y} C ${p.from.x + p.from.dir * k} ${p.from.y} ${p.to.x + p.to.dir * k} ${p.to.y} ${p.to.x} ${p.to.y}`
})
/** 终点的箭头（引用线的终点切线水平、指向端口里面） */
const arrow = computed(() => {
  const p = ports.value
  const r = !p ? route.value : null
  const to = p ? p.to : r ? r[r.length - 1] : geo.value.to
  const from = p ? { x: p.to.x + p.to.dir, y: p.to.y } : r ? r[r.length - 2] : geo.value.from
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
const label = computed(() => dragging.value ?? props.data.label ?? (route.value ? pointAlong(route.value, 0.5) : geo.value.mid))
const many = computed(() => props.data.relationIds?.length ?? 0)
const typeLabel = computed(() => (many.value ? `${many.value} 条关系（折叠显示）` : (RELATION_TYPE_LABELS[props.data.type as RelationType] ?? props.data.type)))
/** 标签：聚合边标条数；写了说明的显示说明；没写的只在选中时显示类型（线多时不堆满画布） */
/** L35、L26：机制写在说明或条数之后（与画布标签位同一套组装与上限，草图没有异常，只有一段中性；其余「+k」悬停列出） */
const pill = computed(() => {
  const t = props.data.external ? '' : many.value ? `${many.value} 条` : props.data.description || (props.data.selected ? typeLabel.value : '')
  return composePill(t, props.data.external ? [] : mechTags(props.data.mechs, Math.max(1, many.value)))
})
const text = computed(() => pill.value.text)
const more = computed(() =>
  pill.value.hidden.length ? `\n另：${pill.value.hidden.map(p => p.tag + (p.count && p.count < (p.total ?? 0) ? ` ${p.count}` : '')).join('、')}` : '',
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
    :class="[
      data.type,
      {
        selected: data.selected,
        pending: data.pending,
        changed: !!data.change,
        many: many > 1,
        external: !!data.external,
        hot: data.hot,
        hovered: data.hovered,
      },
    ]"
  >
    <path v-if="!data.external" :d="path" class="hit" />
    <path v-if="data.hovered" :d="path" class="hover-casing" />
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
      :title="`${typeLabel}${data.selected ? '（拖动可移动标签）' : ''}${more}`"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
    >
      {{ text }}
    </div>
  </EdgeLabelRenderer>
  <!-- CI-3：关系上的改动号（在线的中点偏上），单击在「改动」页签里滚到 -->
  <EdgeLabelRenderer v-if="data.number">
    <button
      class="sk-edge-num nodrag nopan"
      :class="{ recent: data.recent, hot: data.hot }"
      data-testid="change-badge"
      :data-n="data.number"
      :style="{ transform: `translate(-50%, -100%) translate(${label.x}px, ${label.y - 10}px)` }"
      :title="`改动 #${data.number}：单击在「改动」页签里看`"
      @click.stop="desk.edit.changes.revealItem(data.number)"
      @mouseenter="desk.edit.changes.setHover(data.number)"
      @mouseleave="desk.edit.changes.setHover(null)"
    >
      #{{ data.number }}
    </button>
  </EdgeLabelRenderer>
</template>

<style scoped>
.sk-edge-num {
  position: absolute;
  pointer-events: all;
  padding: 0 5px;
  height: 16px;
  line-height: 14px;
  border-radius: 8px;
  border: 1px solid var(--accent);
  background: var(--surface);
  color: var(--accent);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
}
.sk-edge-num.recent {
  background: var(--accent);
  color: var(--surface);
}
.sk-edge-num.hot {
  outline: 2px solid var(--accent);
}

.hit {
  fill: none;
  stroke: transparent;
  stroke-width: 14;
}

/* L25（第十一轮）：悬停的线——背景色衬边 + 投影，线加粗 */
.hover-casing {
  fill: none;
  stroke: var(--surface);
  stroke-width: 6;
  stroke-linecap: round;
  filter: drop-shadow(0 1px 2.5px var(--hover-shadow));
  pointer-events: none;
}

.sk-edge.hovered .line {
  stroke-width: 2.5;
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
