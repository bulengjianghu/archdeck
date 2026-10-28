<script setup lang="ts">
/** L36（第十四轮 F4、F8，ADR-0043）：层标题旁的状态记号——只表来源与状态：算出 / 待确认 / 已确认 */
import { LAYER_STATUS, type LayerStatus } from '@/layout/layout'

defineProps<{ status: LayerStatus }>()
</script>

<template>
  <span class="layer-status" :class="status" data-testid="layer-status" :data-status="status" :title="LAYER_STATUS[status].title">{{
    LAYER_STATUS[status].text
  }}</span>
</template>

<style scoped>
.layer-status {
  display: inline-block;
  margin-left: 6px;
  padding: 0 5px;
  font-size: 10.5px;
  font-weight: 500;
  line-height: 15px;
  border-radius: 3px;
  white-space: nowrap;
  vertical-align: 1px;
  pointer-events: auto;
}

.layer-status.computed {
  color: var(--text-3);
  border: 1px dashed var(--border-strong);
}

.layer-status.pending {
  color: var(--warning);
  border: 1px dashed currentColor;
}

.layer-status.confirmed {
  color: var(--accent);
  border: 1px solid currentColor;
}
</style>
