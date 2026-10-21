<script setup lang="ts">
import Handles from './Handles.vue'
import DiffMark from './DiffMark.vue'
import type { NodeData } from './types'

defineProps<{ data: NodeData }>()
</script>

<template>
  <div class="core" :class="{ selected: data.selected, dim: data.dim, target: data.module?.status === 'target', [`diff-${data.change}`]: !!data.change }">
    <Handles />
    <DiffMark :data="data" />
    <span class="name">{{ data.name }}</span>
    <span v-if="data.childCount > 0" class="drill">⌄ {{ data.childCount }}</span>
  </div>
</template>

<style scoped>
.core {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  background: var(--surface);
  border: 1.5px solid var(--border-strong);
  border-radius: var(--radius);
  transition: opacity 0.15s;
}

.core:hover {
  border-color: var(--accent);
}

.core.selected {
  border-color: var(--accent);
  outline: 2px solid var(--accent-soft);
}

.core.dim {
  opacity: 0.3;
}

.core.target {
  border-style: dashed;
}

.name {
  flex: 1;
  font-weight: 600;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.drill {
  flex: none;
  font-size: 11px;
  color: var(--accent);
}
</style>
