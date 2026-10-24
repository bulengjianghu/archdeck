<script setup lang="ts">
/**
 * L12 插座记号的 marker：画在走线终点（箭头尖端），与箭头叠放；画布的 RouteEdge 与「显示」面板的 LineSwatch 共用。
 * markerUnits 为 userSpaceOnUse，viewBox 与 px 一一对应，原点即终点。
 */
import { computed } from 'vue'
import { SOCKET_OVERSHOOT, socketPath, socketRadius } from './edgeStyle'

const props = defineProps<{ id: string; color: string; size: number }>()
const r = computed(() => socketRadius(props.size))
/** 外框：半圆在 x ∈ [OVERSHOOT − r, OVERSHOOT]、y ∈ [−r, r]，四周留 2px 给描边 */
const box = computed(() => ({ x: SOCKET_OVERSHOOT - r.value - 2, y: -r.value - 2, w: r.value + 4, h: 2 * r.value + 4 }))
</script>

<template>
  <marker
    :id="id"
    class="socket-marker"
    :viewBox="`${box.x} ${box.y} ${box.w} ${box.h}`"
    refX="0"
    refY="0"
    :markerWidth="box.w"
    :markerHeight="box.h"
    markerUnits="userSpaceOnUse"
    orient="auto"
  >
    <path :d="socketPath(size)" fill="none" :stroke="color" stroke-width="1.6" stroke-linecap="round" />
  </marker>
</template>
