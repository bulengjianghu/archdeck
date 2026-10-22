<script setup lang="ts">
/**
 * 关系边与临时线（L10、ADR-0018）：一个通道一个维度——
 * 颜色 = 关系类型（编译期低饱和、更细）；线型 = 事实状态（实 / 虚 / 点）；箭头 = 同步实心、异步空心、implements 空心三角；
 * 线宽 = 聚合条数三档；标签 = ×N（pill）与异常；晕 = 违规（优先）/ 设计变更、选中（强调色窄晕）、回放当前（宽晕 + 流动）。
 */
import { computed } from 'vue'
import { BaseEdge } from '@vue-flow/core'
import type { RouteEdgeData } from '@/layout/canvas'
import { horizontalCurve, roundedPolyline, verticalCurve } from './routePath'

const props = defineProps<{ id: string; data: RouteEdgeData }>()

const path = computed(() => {
  const pts = props.data.route.points
  if (props.data.route.curve && pts.length === 2) return props.data.route.curve === 'h' ? horizontalCurve(pts[0], pts[1]) : verticalCurve(pts[0], pts[1])
  return roundedPolyline(pts)
})

/** 线宽档位（px）：运行时 / 编译期 */
const WIDTH = { runtime: [1.5, 2.5, 3.5], compile: [1, 1.75, 2.5] } as const
const DASHED = '6 4'
const DOTTED = '0.5 4.5'

const color = computed(() => {
  const d = props.data
  if (d.temp === 'code') return d.violated ? 'var(--danger)' : 'var(--edge-code)'
  if (d.temp === 'unmodeled') return 'var(--danger)'
  if (d.play === 'preview') return 'var(--warning)'
  if (d.muted) return 'var(--text-3)'
  return `var(--rel-${d.edge.type})`
})

const style = computed(() => {
  const d = props.data
  if (d.temp === 'code') return { stroke: color.value, strokeWidth: 2, strokeDasharray: DOTTED, strokeLinecap: 'round' as const, opacity: d.dim ? 0.12 : 0.95 }
  if (d.temp === 'unmodeled') return { stroke: color.value, strokeWidth: 1.5, strokeDasharray: '5 5', opacity: d.play === 'preview' ? 0.7 : 0.9 }
  return {
    stroke: color.value,
    strokeWidth: WIDTH[d.compile ? 'compile' : 'runtime'][d.weight - 1],
    // 线型只表事实状态；分支预览与经由上层（P15）的临时线为虚线
    strokeDasharray: d.play === 'preview' || d.temp === 'upper' || d.factState === 'unconfirmed' ? DASHED : undefined,
    opacity: d.dim ? 0.12 : d.muted ? 0.45 : 1,
    transition: 'opacity 0.15s',
  }
})

/** 每条边自带箭头 marker，颜色跟随线色 */
const markerId = computed(() => `arrow-${props.id.replace(/[^\w-]/g, c => `_${c.charCodeAt(0)}`)}`)
</script>

<template>
  <defs>
    <marker :id="markerId" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto">
      <path v-if="data.arrow === 'open'" d="M1,1 L9,5 L1,9" fill="none" :stroke="color" stroke-width="1.5" stroke-linejoin="round" />
      <path v-else-if="data.arrow === 'triangle'" d="M1,1 L9,5 L1,9 Z" fill="var(--surface)" :stroke="color" stroke-width="1.3" stroke-linejoin="round" />
      <path v-else d="M0,0 L10,5 L0,10 Z" :fill="color" />
    </marker>
  </defs>
  <path
    v-if="data.change && !data.violated"
    :d="path"
    class="edge-diff"
    fill="none"
    :stroke="`var(--diff-${data.change})`"
    :stroke-width="9"
    stroke-linecap="round"
    stroke-linejoin="round"
    :opacity="data.dim ? 0.06 : 0.28"
  />
  <path v-if="data.violated && !data.temp" :d="path" class="edge-violated" fill="none" stroke-linecap="round" :opacity="data.dim ? 0.06 : 0.3" />
  <path v-if="data.selected" :d="path" class="edge-selected-glow" fill="none" stroke-linecap="round" stroke-linejoin="round" />
  <path v-if="data.play === 'current' || data.play === 'hover'" :d="path" class="edge-glow" :class="data.play" fill="none" stroke-linecap="round" />
  <g :class="{ 'edge-label-pill': data.pill, 'edge-label-warn': data.warn }">
    <BaseEdge
      :id="id"
      :path="path"
      :marker-end="`url(#${markerId})`"
      :style="style"
      :interaction-width="16"
      :label="data.dim || !data.label ? undefined : data.label"
      :label-x="data.route.label?.x"
      :label-y="data.route.label?.y"
      :label-show-bg="true"
      :label-bg-padding="data.pill ? [6, 2] : [4, 2]"
      :label-bg-border-radius="data.pill ? 8 : 4"
      :class="{ 'edge-selected': data.selected, 'edge-core': data.core }"
    />
  </g>
  <path v-if="data.play === 'current'" :d="path" class="edge-flow" :class="{ reverse: data.flowReverse }" fill="none" />
</template>

<style scoped>
.edge-diff {
  pointer-events: none;
}

.edge-violated {
  pointer-events: none;
  stroke: var(--danger);
  stroke-width: 8;
}

/* 选中：强调色窄晕，与回放当前步骤的宽晕区分；线宽不变 */
.edge-selected-glow {
  pointer-events: none;
  stroke: var(--accent);
  stroke-width: 6;
  opacity: 0.35;
}

.edge-glow {
  pointer-events: none;
  stroke: var(--accent);
  stroke-width: 12;
  opacity: 0.18;
}

.edge-glow.hover {
  stroke: var(--warning);
}

/* 当前消息：沿步骤自己的方向流动（P10），与边的箭头相反时反向 */
.edge-flow {
  pointer-events: none;
  stroke: var(--accent);
  stroke-width: 3;
  stroke-dasharray: 10 8;
  animation: flow 0.9s linear infinite;
}

.edge-flow.reverse {
  animation-direction: reverse;
}

@keyframes flow {
  to {
    stroke-dashoffset: -36;
  }
}
</style>
