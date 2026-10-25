<script setup lang="ts">
/**
 * 结构视图图例的示意线（L16，UML 类图惯例）：使用虚线 + 开口箭头、子类实线 + 空心三角、端口实现虚线 + 空心三角、组装实线 + 实心菱形（组装者一端）与开口箭头；
 * 档用明度（交互使用深、值使用中、只引类型浅，不用透明度——透明度是共享通道「变淡」）；allowed 为没有代码事实时的允许边（U16：点线、意图色）。
 * 颜色与线型取画布结构边同一套（depStyle 的 depColor / depDash，颜色变量在 styles.css，亮色暗色各一套）。
 */
import { computed } from 'vue'
import type { DepForm, DepTier } from '@/model'
import { WIDTH } from '../edges/edgeStyle'
import { depColor, depDash } from '../edges/depStyle'

const props = withDefaults(defineProps<{ kind?: DepForm | 'allowed'; tier?: DepTier; width?: number; halo?: boolean; muted?: boolean }>(), {
  kind: 'use',
  tier: undefined,
  width: 36,
})

const color = computed(() => depColor({ kind: props.kind, ...(props.tier ? { tier: props.tier } : {}) }))
const dash = computed(() => depDash(props.kind))
const triangle = computed(() => props.kind === 'subclass' || props.kind === 'implements')
const diamond = computed(() => props.kind === 'assembly')
const w = computed(() => props.width)
/** 终点留给端点记号 */
const end = computed(() => w.value - (triangle.value ? 8 : 1))
const start = computed(() => (diamond.value ? 9 : 1))
</script>

<template>
  <svg class="swatch" :width="w" height="10" :viewBox="`0 0 ${w} 10`" :data-kind="kind" :data-tier="tier">
    <line v-if="halo" x1="1" y1="5" :x2="w - 1" y2="5" stroke="var(--danger)" stroke-width="7" stroke-opacity="0.3" stroke-linecap="round" />
    <line
      :x1="start"
      y1="5"
      :x2="end"
      y2="5"
      :stroke="color"
      :stroke-width="WIDTH[0]"
      :stroke-dasharray="dash"
      :stroke-linecap="kind === 'allowed' ? 'round' : undefined"
      :opacity="muted ? 0.35 : undefined"
    />
    <!-- 空心三角：子类、端口实现，在被依赖方一端 -->
    <path v-if="triangle" :d="`M${w - 8},1 L${w - 1},5 L${w - 8},9 Z`" fill="var(--surface)" :stroke="color" stroke-width="1.2" stroke-linejoin="round" />
    <!-- 开口箭头：使用、组装（被依赖方一端）、允许边 -->
    <path
      v-else
      :d="`M${w - 6},1.5 L${w - 1},5 L${w - 6},8.5`"
      fill="none"
      :stroke="color"
      stroke-width="1.3"
      stroke-linejoin="round"
      stroke-linecap="round"
      :opacity="muted ? 0.35 : undefined"
    />
    <!-- 实心菱形：组装，在组装者一端 -->
    <path v-if="diamond" d="M1,5 L5,2 L9,5 L5,8 Z" :fill="color" />
  </svg>
</template>

<style scoped>
.swatch {
  flex: none;
  overflow: visible;
}
</style>
