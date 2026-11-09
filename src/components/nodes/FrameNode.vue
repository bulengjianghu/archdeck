<script setup lang="ts">
/** 边界框（A7、L4）：系统框（根层只有它）或当前父模块框（下钻后在系统框之内），标题在框线左上；不参与交互。
 * 代表当前父模块的框带本层计数「共用件 N · 折叠 M」（右上，O11）与共用件架的字样（O9） */
import type { NodeData } from './types'

defineProps<{ data: NodeData }>()
</script>

<template>
  <div class="frame-node">
    <span class="label">{{ data.name }}</span>
    <span v-if="data.counts" class="counts" data-testid="level-counts">共用件 {{ data.counts.shared }} · 折叠 {{ data.counts.folded }}</span>
    <span v-if="data.shelfAt !== undefined" class="shelf-label" :style="{ top: `${data.shelfAt}px` }">共用件</span>
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

.label,
.counts {
  position: absolute;
  top: -10px;
  padding: 0 6px;
  font-size: 11px;
  color: var(--text-3);
  background: var(--bg);
}

.label {
  left: 16px;
}

.counts {
  right: 16px;
}

.shelf-label {
  position: absolute;
  left: 28px;
  transform: translateY(-50%);
  font-size: 11px;
  color: var(--text-3);
}
</style>
