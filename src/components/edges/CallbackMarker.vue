<script setup lang="ts">
/**
 * L24 回程钩记号的 marker：画在走线起点（发起方一端），与线叠放、不改线型与箭头；画布的 RouteEdge 与「显示」面板的 LineSwatch 共用。
 * markerUnits 为 userSpaceOnUse，viewBox 与 px 一一对应，原点即起点。
 */
import { computed } from 'vue'
import { callbackHookRadius, callbackPath } from './edgeStyle'

const props = defineProps<{ id: string; color: string; size: number }>()
const h = computed(() => callbackHookRadius(props.size))
/** 外框：钩在 x ∈ [0, 3h]、y ∈ [−2.7h, 0]，四周留 2px 给描边 */
const box = computed(() => ({ x: -2, y: -2.7 * h.value - 2, w: 3 * h.value + 4, h: 2.7 * h.value + 4 }))
</script>

<template>
  <marker
    :id="id"
    class="callback-marker"
    :viewBox="`${box.x} ${box.y} ${box.w} ${box.h}`"
    refX="0"
    refY="0"
    :markerWidth="box.w"
    :markerHeight="box.h"
    markerUnits="userSpaceOnUse"
    orient="auto"
  >
    <path :d="callbackPath(size)" fill="none" :stroke="color" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
  </marker>
</template>
