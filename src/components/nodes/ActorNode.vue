<script setup lang="ts">
import Handles from './Handles.vue'
import type { NodeData } from './types'
import { ACTOR_KIND_LABELS } from '@/model'

defineProps<{ data: NodeData }>()
const ICON = { user: '👤', system: '⇄', time: '⏱' } as const
</script>

<template>
  <div class="actor-node" :class="{ selected: data.selected, dim: data.dim, [`kind-${data.actorKind}`]: true }">
    <Handles />
    <span class="icon">{{ ICON[data.actorKind ?? 'system'] }}</span>
    <div class="text">
      <div class="name">{{ data.name }}</div>
      <div class="kind">外部参与者 · {{ ACTOR_KIND_LABELS[data.actorKind ?? 'system'] }}</div>
    </div>
  </div>
</template>

<style scoped>
.actor-node {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 100%;
  padding: 6px 12px;
  border: 1.5px solid var(--actor);
  border-radius: 26px;
  background: var(--actor-soft);
  color: var(--text);
  transition: opacity 0.15s;
}

.actor-node.selected {
  box-shadow: 0 0 0 3px var(--accent-soft);
  border-color: var(--accent);
}

.actor-node.dim {
  opacity: 0.3;
}

.icon {
  font-size: 18px;
  line-height: 1;
}

.text {
  min-width: 0;
}

.name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kind {
  font-size: 11px;
  color: var(--text-3);
}
</style>
