<script setup lang="ts">
/**
 * 图例的示意线：按 look（关系类型、事实状态、线宽档、临时线种类）取与画布 RouteEdge 同一套样式（edgeStyle），不手写示意样式。
 * 可加箭头（同步实心 / 异步空心 / implements 空心三角）、违规红晕、回放流动、×N 标签与异常标记。
 */
import { computed } from 'vue'
import { FLOW, strokeColor, strokeStyle, type StrokeLook } from '../edges/edgeStyle'

const props = withDefaults(
  defineProps<{
    look?: StrokeLook
    /** 覆盖线色：不表示某种类型的通道说明用中性色 */
    color?: string
    width?: number
    arrow?: 'closed' | 'open' | 'triangle'
    /** 违规红晕 */
    halo?: boolean
    /** 回放当前步骤的流动 */
    flow?: boolean
    /** ×N 标签框 */
    pill?: boolean
    /** 线尾的异常标记，如 ? */
    mark?: string
  }>(),
  { look: () => ({}), color: undefined, width: 28, arrow: undefined, mark: undefined },
)

const style = computed(() => ({ ...strokeStyle(props.look), ...(props.color ? { stroke: props.color } : {}) }))
const stroke = computed(() => props.color ?? strokeColor(props.look))
/** 线的终点：给箭头、标签或标记留位置 */
const end = computed(() => props.width - 1 - (props.arrow ? 5 : 0) - (props.pill ? 10 : 0) - (props.mark ? 7 : 0))
</script>

<template>
  <svg class="swatch" :width="width" height="10" :viewBox="`0 0 ${width} 10`">
    <line v-if="halo" x1="1" y1="5" :x2="end" y2="5" stroke="var(--danger)" stroke-width="7" stroke-opacity="0.3" stroke-linecap="round" />
    <template v-if="flow">
      <line x1="1" y1="5" :x2="end" y2="5" stroke="var(--accent)" :stroke-width="FLOW.baseWidth" stroke-linecap="round" />
      <line
        class="flow"
        x1="1"
        y1="5"
        :x2="end"
        y2="5"
        stroke="var(--surface)"
        :stroke-width="FLOW.width"
        :stroke-dasharray="FLOW.dash"
        stroke-linecap="round"
      />
    </template>
    <line
      v-else
      x1="1"
      y1="5"
      :x2="end"
      y2="5"
      :stroke="style.stroke"
      :stroke-width="style.strokeWidth"
      :stroke-dasharray="style.strokeDasharray"
      :stroke-linecap="'strokeLinecap' in style ? style.strokeLinecap : undefined"
    />
    <path v-if="arrow === 'closed'" :d="`M${end - 1},1.5 L${end + 5},5 L${end - 1},8.5 Z`" :fill="stroke" />
    <path v-else-if="arrow === 'open'" :d="`M${end - 1},1.5 L${end + 5},5 L${end - 1},8.5`" fill="none" :stroke="stroke" stroke-width="1.2" />
    <path v-else-if="arrow === 'triangle'" :d="`M${end - 1},1.5 L${end + 5},5 L${end - 1},8.5 Z`" fill="var(--surface)" :stroke="stroke" stroke-width="1.2" />
    <rect v-if="pill" :x="width - 10.5" y="1" width="10" height="8" rx="4" fill="var(--surface)" stroke="var(--border-strong)" />
    <text v-if="mark" :x="width - 6" y="9" class="mark">{{ mark }}</text>
  </svg>
</template>

<style scoped>
.swatch {
  flex: none;
  overflow: visible;
}

.mark {
  font-size: 10px;
  font-weight: 700;
  fill: var(--warning);
}

.flow {
  animation: flow 0.9s linear infinite;
}

@keyframes flow {
  to {
    stroke-dashoffset: -24;
  }
}
</style>
