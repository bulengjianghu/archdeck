<script setup lang="ts">
/** 线宽 = 合了几条本图的边（L18 共享通道）：三个视角的「线」一节同一行、同一句（文字取 SHARED_CHANNELS，C1） */
import LineSwatch from './LineSwatch.vue'
import { SHARED_TEXT } from './labels'

const NEUTRAL = 'var(--text-2)'
</script>

<template>
  <div class="reading-row" data-testid="legend-width" :title="SHARED_TEXT.width">
    <span class="dim">粗细</span>
    <span class="pair"><LineSwatch :color="NEUTRAL" :width="16" :look="{ weight: 1 }" />1</span>
    <span class="pair"><LineSwatch :color="NEUTRAL" :width="16" :look="{ weight: 2 }" />2–4</span>
    <span class="pair"><LineSwatch :color="NEUTRAL" :width="22" :look="{ weight: 3 }" pill />≥5 ×N</span>
  </div>
</template>
