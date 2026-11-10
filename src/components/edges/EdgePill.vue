<script setup lang="ts">
/**
 * 标签位（L26②，ADR-0041）：线中点的 pill，至多两段——异常段（警示色）在前、修饰段（中性）在后，段间留一点空；
 * 只有一个 <text>（各段一个 tspan），整串文字读得出（段之间垫一个不可见的「 · 」）。段宽按实际文字量，量不到时（测试环境）按估宽（labelWidth）。
 */
import { computed, ref, watchPostEffect } from 'vue'
import { PILL_GAP, labelWidth, type PillSegment } from '@/layout/canvas'

const props = defineProps<{ x: number; y: number; segments: PillSegment[]; pill: boolean }>()

const PAD_Y = 2
const H = 18
const padX = computed(() => (props.pill ? 6 : 4))
const radius = computed(() => (props.pill ? 8 : 4))

const spans: (SVGTSpanElement | null)[] = []
const measured = ref<number[] | null>(null)
watchPostEffect(() => {
  const texts = props.segments.map(s => s.text)
  try {
    const w = texts.map((_, i) => spans[i]?.getComputedTextLength?.() ?? 0)
    measured.value = w.every(n => n > 0) ? w : null
  } catch {
    measured.value = null
  }
})

/** 各段的盒子（相对 pill 左沿），整体以 (x, y) 为中心 */
const boxes = computed(() => {
  let at = 0
  const out = props.segments.map((s, i) => {
    const text = measured.value?.[i] ?? labelWidth(s.text) - 12
    const w = text + padX.value * 2
    const box = { ...s, x: at, w }
    at += w + PILL_GAP
    return box
  })
  return { items: out, w: Math.max(0, at - PILL_GAP) }
})
</script>

<template>
  <g class="edge-pill" :transform="`translate(${x - boxes.w / 2}, ${y - H / 2})`">
    <rect
      v-for="(b, i) in boxes.items"
      :key="`bg${i}`"
      class="vue-flow__edge-textbg"
      :class="b.warn ? 'warn' : 'plain'"
      :x="b.x"
      :y="0"
      :width="b.w"
      :height="H"
      :rx="radius"
      :ry="radius"
    />
    <text class="vue-flow__edge-text" :y="H / 2 + PAD_Y / 2" dominant-baseline="middle">
      <template v-for="(b, i) in boxes.items" :key="`t${i}`">
        <tspan v-if="i" class="pill-sep" visibility="hidden"> · </tspan>
        <tspan
          :ref="el => (spans[i] = el as SVGTSpanElement | null)"
          class="pill-text"
          :class="b.warn ? 'warn' : 'plain'"
          :x="b.x + padX"
          :y="H / 2 + PAD_Y / 2"
          >{{ b.text }}</tspan
        >
      </template>
    </text>
  </g>
</template>

<style scoped>
/* 警示色只给异常段；修饰段中性（L26②） */
.pill-text.warn {
  fill: var(--warning);
}

.pill-text.plain {
  fill: var(--text-2);
}

.vue-flow__edge-textbg.warn {
  stroke: var(--warning);
}
</style>
