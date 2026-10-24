<script setup lang="ts">
/** O9：共用件架上的共用件——紧凑一行的小块；单击选中、双击下钻，悬停或选中时画出它与使用者之间的边（O10） */
import Handles from './Handles.vue'
import DiffMark from './DiffMark.vue'
import type { NodeData } from './types'

defineProps<{ data: NodeData }>()
</script>

<template>
  <div
    class="shared-node"
    :class="{ selected: data.selected, dim: data.dim, target: data.module?.status === 'target', [`diff-${data.change}`]: !!data.change }"
    :title="`${data.name}（共用件${data.module?.role === 'bus' ? '：事件总线' : ''}）`"
  >
    <Handles />
    <DiffMark :data="data" />
    <span class="name">{{ data.name }}</span>
    <span v-if="data.childCount > 0" class="drill">⌄ {{ data.childCount }}</span>
  </div>
</template>

<style scoped>
.shared-node {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  font-size: 12px;
  background: var(--surface-2, var(--surface));
  border: 1px solid var(--border);
  border-radius: 6px;
  transition: opacity 0.15s;
}

.shared-node:hover,
.shared-node.selected {
  border-color: var(--accent);
}

.shared-node.selected {
  outline: 2px solid var(--accent-soft);
}

.shared-node.dim {
  opacity: 0.35;
}

.shared-node.target {
  border-style: dashed;
}

.name {
  flex: 1;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.drill {
  flex: none;
  font-size: 10.5px;
  color: var(--accent);
}
</style>
