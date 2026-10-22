<script setup lang="ts">
/**
 * 图例的示意线：按 look（关系类型、事实状态、线宽档、临时线种类）取与画布 RouteEdge 同一套样式（edgeStyle），不手写示意样式。
 * 可加箭头（同步实心 / 异步空心 / implements 空心三角，与画布同一个 ArrowMarker，线同样回缩一个箭头深度）、违规红晕、回放流动、×N 标签与异常标记。
 */
import { computed, useId } from 'vue'
import { FLOW, arrowDepth, arrowSize, strokeColor, strokeStyle, type ArrowKind, type StrokeLook } from '../edges/edgeStyle'
import ArrowMarker from '../edges/ArrowMarker.vue'

const props = withDefaults(
  defineProps<{
    look?: StrokeLook
    /** 覆盖线色：不表示某种类型的通道说明用中性色 */
    color?: string
    width?: number
    arrow?: ArrowKind
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
// <script setup> 每个实例都会重跑，模块级计数器在这里不唯一；用 useId 保证每条示意引用自己的箭头
const markerId = `swatch-arrow-${useId()}`
const size = computed(() => arrowSize(props.look.weight))
/** 线的终点：给箭头、标签或标记留位置；有箭头时再回缩一个箭头深度，箭头尖落在 tip */
const tip = computed(() => props.width - 1 - (props.pill ? 10 : 0) - (props.mark ? 7 : 0))
const end = computed(() => tip.value - (props.arrow ? arrowDepth(size.value) : 0))
</script>

<template>
  <svg class="swatch" :width="width" height="10" :viewBox="`0 0 ${width} 10`">
    <defs v-if="arrow">
      <ArrowMarker :id="markerId" :kind="arrow" :color="stroke" :size="size" :line-width="style.strokeWidth" />
    </defs>
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
      :marker-end="arrow ? `url(#${markerId})` : undefined"
    />
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
