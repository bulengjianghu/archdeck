<script setup lang="ts">
/**
 * 图例 · 规则（结构视角，U15、Y4；ADR-0058）：只解码治理的两个非文字记号——违规红晕（共享通道 L18；已知的淡红晕）与本层环编号 ↻N（T0 裁决 3）。
 * 允许 / 无约束不加标记（缺省态不列，ADR-0041 四问）；「逆稳定」是写在线上的提示词（U17），归脚注。
 * 图例按上下文显示（L47，G14）：本层没有这两个记号时整节不出现（出现集合由 state/desk/legend 一处派生）。
 */
import StructureSwatch from './StructureSwatch.vue'
import { SHARED_TEXT } from './labels'

defineProps<{ presence: Set<string> }>()
</script>

<template>
  <section v-if="presence.has('rule:violation') || presence.has('shared:cycle')" class="sec" aria-label="规则">
    <div class="sec-title">规则</div>
    <div v-if="presence.has('rule:violation')" class="item" data-tag="违规">
      <span class="sw kind"><StructureSwatch halo /></span>
      <span>{{ SHARED_TEXT.violation }}</span>
    </div>
    <div v-if="presence.has('shared:cycle')" class="item" data-tag="环">
      <span class="sw kind"><span class="cycle">↻N</span></span>
      <span>{{ SHARED_TEXT.cycle }}</span>
    </div>
  </section>
</template>

<style scoped>
.sw.kind {
  width: 36px;
}
</style>
