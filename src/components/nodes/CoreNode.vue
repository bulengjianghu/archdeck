<script setup lang="ts">
import Handles from './Handles.vue'
import DiffMark from './DiffMark.vue'
import StructMarks from './StructMarks.vue'
import PortMarks from './PortMarks.vue'
import SurfaceMarks from './SurfaceMarks.vue'
import RimTag from './RimTag.vue'
import type { NodeData } from './types'

defineProps<{ data: NodeData }>()
</script>

<template>
  <div
    class="core"
    :class="{
      selected: data.selected,
      dim: data.dim,
      target: data.module?.status === 'target',
      [`diff-${data.change}`]: !!data.change,
      [`surface-${data.surface?.side}`]: !!data.surface,
      'surface-grouped': !!data.surface?.grouped,
    }"
  >
    <Handles />
    <DiffMark :data="data" />
    <StructMarks :data="data" />
    <PortMarks v-if="data.ports" :ports="data.ports" :module-id="data.moduleId" />
    <SurfaceMarks v-if="data.surface" :surface="data.surface" :module-id="data.moduleId" />
    <span class="name">{{ data.name }}</span>
    <RimTag v-if="data.rim" :rim="data.rim" />
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

/* C6、L20b（ADR-0036）：展开表面——节点尺寸不变；有组名时名字让开组名那一列（左边）；顶边的组名在上部，名字居中不挡 */
.core.surface-left.surface-grouped {
  padding-left: 56px;
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
