<script setup lang="ts">
import { computed } from 'vue'
import { BaseEdge } from '@vue-flow/core'
import type { EdgeRoute } from '@/layout/layout'
import type { ViewEdge } from '@/model'
import { horizontalCurve, roundedPolyline, verticalCurve } from './routePath'

export interface RouteEdgeData {
  route: EdgeRoute
  edge: ViewEdge
  label: string
  selected: boolean
  dim: boolean
  /** 核心跨层边，只在悬停/选中时出现 */
  core?: boolean
  /** 设计版本：边包含新增或修改的关系 */
  change?: 'added' | 'changed'
  /** 运行视角：当前消息、走过、分支预览、时序图悬停预览 */
  play?: 'current' | 'walked' | 'preview' | 'hover'
  /** 当前消息与边的箭头方向相反（P10） */
  flowReverse?: boolean
  /** 结构中未建模的临时线（P11） */
  unmodeled?: boolean
}

const props = defineProps<{ id: string; data: RouteEdgeData; markerEnd?: string }>()

const path = computed(() => {
  const pts = props.data.route.points
  if (props.data.route.curve && pts.length === 2) return props.data.route.curve === 'h' ? horizontalCurve(pts[0], pts[1]) : verticalCurve(pts[0], pts[1])
  return roundedPolyline(pts)
})

const DASH: Record<string, string | undefined> = { depends: '6 4', implements: '6 4', event: '2 4' }

const style = computed(() => {
  const n = props.data.edge.relationIds.length
  const width = 1.5 + Math.min(2.5, (n - 1) * 0.5) + (props.data.selected ? 1.5 : 0) + (props.data.play === 'walked' ? 0.5 : 0)
  if (props.data.unmodeled) {
    return { stroke: 'var(--danger)', strokeWidth: 1.5, strokeDasharray: '5 5', opacity: props.data.play === 'preview' ? 0.7 : 0.9 }
  }
  return {
    stroke: props.data.play === 'preview' ? 'var(--warning)' : `var(--rel-${props.data.edge.type})`,
    strokeWidth: width,
    strokeDasharray: props.data.play === 'preview' ? '6 4' : props.data.edge.mode === 'async' ? '8 3 2 3' : DASH[props.data.edge.type],
    opacity: props.data.dim ? 0.12 : 1,
    transition: 'opacity 0.15s',
  }
})
</script>

<template>
  <path
    v-if="data.change"
    :d="path"
    class="edge-diff"
    fill="none"
    :stroke="`var(--diff-${data.change})`"
    :stroke-width="9"
    stroke-linecap="round"
    stroke-linejoin="round"
    :opacity="data.dim ? 0.06 : 0.28"
  />
  <path v-if="data.play === 'current' || data.play === 'hover'" :d="path" class="edge-glow" :class="data.play" fill="none" stroke-linecap="round" />
  <BaseEdge
    :id="id"
    :path="path"
    :marker-end="markerEnd"
    :style="style"
    :interaction-width="16"
    :label="data.dim ? undefined : data.label"
    :label-x="data.route.label?.x"
    :label-y="data.route.label?.y"
    :label-show-bg="true"
    :label-bg-padding="[4, 2]"
    :label-bg-border-radius="4"
    :class="{ 'edge-selected': data.selected, 'edge-core': data.core }"
  />
  <path v-if="data.play === 'current'" :d="path" class="edge-flow" :class="{ reverse: data.flowReverse }" fill="none" />
</template>

<style scoped>
.edge-diff {
  pointer-events: none;
}

.edge-glow {
  pointer-events: none;
  stroke: var(--accent);
  stroke-width: 10;
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
