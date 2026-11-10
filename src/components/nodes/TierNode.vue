<script setup lang="ts">
/** L29（ADR-0038）：按依赖分层的背景——层带（浅色底、左上写层号：第 1 层为入口，最下为被依赖）或环组框（虚线圆角框、写环编号）；不参与交互 */
import type { NodeData } from './types'

defineProps<{ data: NodeData }>()
</script>

<template>
  <div class="tier-node" :class="data.tierBand?.kind" data-testid="tier-node">
    <span class="label" :style="data.tierBand?.offset !== undefined ? { left: `${data.tierBand.offset}px` } : undefined">{{ data.tierBand?.label }}</span>
  </div>
</template>

<style scoped>
.tier-node {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.band {
  background: var(--surface-2, rgba(120, 130, 150, 0.06));
  border-radius: 10px;
}

.group {
  border: 1.5px dashed var(--danger, #d14);
  border-radius: 12px;
  opacity: 0.55;
}

.label {
  position: absolute;
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
}

.band .label {
  top: 4px;
  left: 10px;
}

.group .label {
  top: -9px;
  right: 12px;
  padding: 0 4px;
  background: var(--bg);
  color: var(--danger, #d14);
}
</style>
