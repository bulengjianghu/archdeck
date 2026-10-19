<script setup lang="ts">
import type { NodeData } from './types'

defineProps<{ data: NodeData }>()
</script>

<template>
  <div class="more" :class="{ dim: data.dim }" title="单击查看该层全部模块，双击进入该层">+{{ data.hiddenCount }} 个其他模块</div>
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

.more.dim {
  opacity: 0.3;
}
</style>
