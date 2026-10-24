<script setup lang="ts">
/**
 * 结构边的端点记号（L16）：开口箭头、空心三角（子类、端口实现）、实心菱形（组装）。
 * markerUnits 为 userSpaceOnUse、原点在线回缩后的端点：终点记号（marker-end）x 轴沿走线方向；起点记号（marker-start）用 auto-start-reverse，同样指向原端点。
 * 画布的 DepEdge 与「显示」面板的图例共用。
 */
import { computed } from 'vue'
import { umlDepth, umlPath, type UmlEnd } from './depStyle'

const props = defineProps<{ id: string; end: UmlEnd; color: string; size: number; lineWidth: number; start?: boolean }>()
const d = computed(() => umlDepth(props.end, props.size))
const box = computed(() => ({ x: -3, y: -props.size / 2 - 3, w: d.value + 6, h: props.size + 6 }))
</script>

<template>
  <marker
    :id="id"
    class="uml-marker"
    :viewBox="`${box.x} ${box.y} ${box.w} ${box.h}`"
    refX="0"
    refY="0"
    :markerWidth="box.w"
    :markerHeight="box.h"
    markerUnits="userSpaceOnUse"
    :orient="start ? 'auto-start-reverse' : 'auto'"
  >
    <path
      v-if="end === 'open'"
      :d="umlPath(end, size)"
      fill="none"
      :stroke="color"
      :stroke-width="lineWidth + 0.5"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
    <path
      v-else-if="end === 'triangle'"
      :d="umlPath(end, size)"
      fill="var(--surface)"
      :stroke="color"
      :stroke-width="Math.max(1.2, lineWidth)"
      stroke-linejoin="round"
    />
    <path v-else :d="umlPath(end, size)" :fill="color" :stroke="color" stroke-width="1" stroke-linejoin="round" />
  </marker>
</template>
