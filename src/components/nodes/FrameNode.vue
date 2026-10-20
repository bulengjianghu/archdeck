<script setup lang="ts">
/** 内部结构外的边界框：根层为系统边界，其他层次为当前父模块（A7）；不参与交互 */
import type { NodeData } from './types'

defineProps<{ data: NodeData }>()
</script>

<template>
  <div class="frame-node">
    <span class="label">{{ data.name }}</span>
  </div>
</template>

<style scoped>
.frame-node {
  width: 100%;
  height: 100%;
  border: 1.5px dashed var(--border-strong);
  border-radius: 14px;
  pointer-events: none;
}

.label {
  position: absolute;
  top: -10px;
  left: 16px;
  padding: 0 6px;
  font-size: 11px;
  color: var(--text-3);
  background: var(--bg);
}
</style>
