<script setup lang="ts">
import Handles from './Handles.vue'
import DiffMark from './DiffMark.vue'
import PortMarks from './PortMarks.vue'
import type { NodeData } from './types'

defineProps<{ data: NodeData }>()
</script>

<template>
  <div class="boundary-node" :class="{ selected: data.selected, dim: data.dim, [`diff-${data.change}`]: !!data.change }">
    <Handles />
    <DiffMark :data="data" />
    <PortMarks v-if="data.ports" :ports="data.ports" :module-id="data.moduleId" />
    <div class="name">{{ data.name }}</div>
    <div class="path">外部 · {{ data.path }}</div>
  </div>
</template>

<style scoped>
.boundary-node {
  position: relative;
  width: 100%;
  height: 100%;
  padding: 5px 10px;
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text-2);
  opacity: 0.85;
  transition: opacity 0.15s;
}

.boundary-node.selected {
  border-color: var(--accent);
  opacity: 1;
}

.boundary-node.dim {
  opacity: 0.25;
}

.name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.path {
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
