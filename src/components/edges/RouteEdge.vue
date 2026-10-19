<script setup lang="ts">
import { computed } from 'vue'
import { BaseEdge } from '@vue-flow/core'
import type { EdgeRoute } from '@/layout/layout'
import type { ViewEdge } from '@/model'
import { roundedPolyline, verticalCurve } from './routePath'

export interface RouteEdgeData {
  route: EdgeRoute
  edge: ViewEdge
  label: string
  selected: boolean
  dim: boolean
  /** 核心跨层边，只在悬停/选中时出现 */
  core?: boolean
}

const props = defineProps<{ id: string; data: RouteEdgeData; markerEnd?: string }>()

const path = computed(() => {
  const pts = props.data.route.points
  return props.data.route.curve && pts.length === 2 ? verticalCurve(pts[0], pts[1]) : roundedPolyline(pts)
})

const DASH: Record<string, string | undefined> = { depends: '6 4', implements: '6 4', event: '2 4' }

const style = computed(() => {
  const n = props.data.edge.relationIds.length
  const width = 1.5 + Math.min(2.5, (n - 1) * 0.5) + (props.data.selected ? 1.5 : 0)
  return {
    stroke: `var(--rel-${props.data.edge.type})`,
    strokeWidth: width,
    strokeDasharray: props.data.edge.mode === 'async' ? '8 3 2 3' : DASH[props.data.edge.type],
    opacity: props.data.dim ? 0.12 : 1,
    transition: 'opacity 0.15s',
  }
})
</script>

<template>
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
</template>
