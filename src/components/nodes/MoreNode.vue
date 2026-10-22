<script setup lang="ts">
import type { NodeData } from './types'

defineProps<{ data: NodeData }>()
</script>

<template>
  <div
    class="more"
    :class="{ dim: data.dim, expanded: !!data.expanded }"
    :title="data.expanded ? '收起临时展开的模块' : '单击临时展开（不改层次），双击下钻到这一层'"
  >
    {{ data.expanded ? `收起 ${data.expanded} 个` : `+${data.hiddenCount} 个其他模块` }}
  </div>
</template>

<style scoped>
.more {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 12px;
  color: var(--text-3);
  border: 1px dashed var(--layer-border);
  border-radius: var(--radius);
}

.more {
  cursor: pointer;
}

.more.expanded {
  border-style: solid;
  color: var(--accent);
}

.more.dim {
  opacity: 0.3;
}
</style>
