<script setup lang="ts">
/**
 * 关系边与临时线（L10、ADR-0018）：一个通道一个维度——
 * 颜色 = 关系类型（编译期低饱和、更细）；线型 = 事实状态（实 / 虚 / 点）；箭头 = 同步实心、异步空心、implements 空心三角；
 * 线宽 = 聚合条数三档；标签 = ×N（pill）与异常；晕 = 违规（优先）/ 设计变更、选中（强调色窄晕）、回放当前（宽晕 + 流动）。
 * 时间耦合（J5）：灰色波浪线、无箭头、标 ×N；无依赖无关系的更深色。
 */
import { computed } from 'vue'
import { BaseEdge } from '@vue-flow/core'
import type { RouteEdgeData } from '@/layout/canvas'
import type { Point } from '@/layout/layout'
import { horizontalCurve, retractEnd, roundedPolyline, verticalCurve, wavyPath } from './routePath'
import ArrowMarker from './ArrowMarker.vue'
import { FLOW, arrowDepth, arrowSize, strokeColor, strokeStyle } from './edgeStyle'

const props = defineProps<{ id: string; data: RouteEdgeData }>()

const couple = computed(() => props.data.temp === 'couple')
const draw = (pts: Point[]) => {
  if (couple.value && pts.length === 2) return wavyPath(pts[0], pts[1])
  const c = props.data.route.curve
  if (c && pts.length === 2) return c === 'h' ? horizontalCurve(pts[0], pts[1]) : verticalCurve(pts[0], pts[1])
  return roundedPolyline(pts, 8, props.data.jumps)
}

const look = computed(() => ({ ...props.data, type: props.data.edge.type, isolated: props.data.couple?.isolated }))
const color = computed(() => strokeColor(look.value))
const style = computed(() => ({ ...strokeStyle(look.value), ...(props.data.temp ? {} : { transition: 'opacity 0.15s' }) }))
/** 箭头大小随线宽档；线在箭头处回缩一个箭头深度（晕与红晕仍沿完整走线） */
const size = computed(() => arrowSize(props.data.weight))
const path = computed(() => draw(props.data.route.points))
const linePath = computed(() => (couple.value ? path.value : draw(retractEnd(props.data.route.points, props.data.route.curve, arrowDepth(size.value)))))

/** 每条边自带箭头 marker，颜色跟随线色 */
const markerId = computed(() => `arrow-${props.id.replace(/[^\w-]/g, c => `_${c.charCodeAt(0)}`)}`)
</script>

<template>
  <defs>
    <ArrowMarker :id="markerId" :kind="data.arrow" :color="color" :size="size" :line-width="style.strokeWidth" />
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
  <g :class="{ 'edge-label-pill': data.pill, 'edge-label-warn': data.warn, 'edge-couple': couple, 'edge-couple-isolated': couple && data.couple?.isolated }">
    <BaseEdge
      :id="id"
      :path="linePath"
      :marker-end="couple ? undefined : `url(#${markerId})`"
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
  <template v-if="data.play === 'current'">
    <path :d="linePath" class="edge-flow-base" fill="none" stroke-linecap="round" :stroke-width="FLOW.baseWidth" />
    <path
      :d="linePath"
      class="edge-flow"
      :class="{ reverse: data.flowReverse }"
      fill="none"
      stroke-linecap="round"
      :stroke-width="FLOW.width"
      :stroke-dasharray="FLOW.dash"
    />
  </template>
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

/* 当前消息：沿步骤自己的方向流动（P10），与边的箭头相反时反向。
   底线加粗为强调色，上面走一串浅色短点——不管边本身什么颜色、多粗都看得出流动 */
.edge-flow-base {
  pointer-events: none;
  stroke: var(--accent);
}

.edge-flow {
  pointer-events: none;
  stroke: var(--surface);
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
