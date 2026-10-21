<script setup lang="ts">
import Handles from './Handles.vue'
import DiffMark from './DiffMark.vue'
import type { NodeData } from './types'

defineProps<{ data: NodeData }>()
</script>

<template>
  <div
    class="module-node"
    :class="{
      selected: data.selected,
      dim: data.dim,
      target: data.module?.status === 'target',
      deprecated: data.module?.status === 'deprecated',
      drillable: data.childCount > 0,
      [`diff-${data.change}`]: !!data.change,
    }"
  >
    <Handles />
    <DiffMark :data="data" />
    <div class="head">
      <span class="name">{{ data.name }}</span>
      <span v-if="data.module?.kind" class="kind">{{ data.module.kind }}</span>
    </div>
    <div class="resp">{{ data.module?.responsibility }}</div>
    <span v-if="data.childCount > 0" class="drill">⌄ {{ data.childCount }}</span>
  </div>
</template>

<style scoped>
.module-node {
  position: relative;
  width: 100%;
  height: 100%;
  padding: 8px 12px;
  background: var(--surface);
  border: 1.5px solid var(--border-strong);
  border-radius: var(--radius);
  /* 不裁切：变更角标骑在上边框 */
  overflow: visible;
  transition: opacity 0.15s;
}

.module-node.drillable {
  box-shadow:
    3px 3px 0 -1px var(--surface),
    3px 3px 0 0 var(--border-strong);
}

.module-node.selected {
  border-color: var(--accent);
  outline: 2px solid var(--accent-soft);
}

.module-node.dim {
  opacity: 0.28;
}

.module-node.target {
  border-style: dashed;
}

.module-node.deprecated .name {
  text-decoration: line-through;
  color: var(--text-3);
}

.head {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.name {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kind {
  flex: none;
  font-size: 11px;
  color: var(--text-3);
}

.resp {
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.drill {
  position: absolute;
  right: 8px;
  top: 8px;
  font-size: 11px;
  color: var(--accent);
}
</style>
