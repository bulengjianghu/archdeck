<script setup lang="ts">
/**
 * 关系线的箭头 marker（L10）：画布的 RouteEdge 与「显示」面板的 LineSwatch 共用。
 * 大小随线宽档（arrowSize），空心「V」的描边 = 线宽 + 1，空心三角描边略粗于线；参考点在底边中点，线需先回缩 arrowDepth。
 */
import { computed } from 'vue'
import { ARROW_PATH, type ArrowKind } from './edgeStyle'

const props = defineProps<{ id: string; kind: ArrowKind; color: string; size: number; lineWidth: number }>()
/** viewBox 单位与 px 的换算：viewBox 宽 10 */
const unit = computed(() => 10 / props.size)
</script>

<template>
  <marker :id="id" viewBox="0 0 10 10" refX="1" refY="5" :markerWidth="size" :markerHeight="size" markerUnits="userSpaceOnUse" orient="auto">
    <path
      v-if="kind === 'open'"
      :d="ARROW_PATH.open"
      fill="none"
      :stroke="color"
      :stroke-width="(lineWidth + 1) * unit"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
    <path
      v-else-if="kind === 'triangle'"
      :d="ARROW_PATH.triangle"
      fill="var(--surface)"
      :stroke="color"
      :stroke-width="(lineWidth + 0.5) * unit"
      stroke-linejoin="round"
    />
    <path v-else :d="ARROW_PATH.closed" :fill="color" />
  </marker>
</template>
