<script setup lang="ts">
/** L37 ①：环编号（Y4）在名称行——身份的一部分，不与顶边的端口记号争位置；分层总览的带画在标题栏右上（band） */
import type { NodeData } from './types'

defineProps<{ data: NodeData; band?: boolean }>()
</script>

<template>
  <span
    v-if="data.cycle !== undefined && !data.restHidden?.includes('cycle')"
    class="cycle-mark"
    :class="{ band }"
    :title="`本层的环 ${data.cycle}：与同编号的节点互相依赖`"
    >↻ {{ data.cycle }}</span
  >
</template>

<style scoped>
.cycle-mark {
  flex: none;
  padding: 0 5px;
  font-size: 10.5px;
  font-weight: 500;
  line-height: 15px;
  color: var(--danger);
  background: var(--surface);
  border: 1px solid var(--danger);
  border-radius: 8px;
  white-space: nowrap;
}

.cycle-mark.band {
  position: absolute;
  top: -9px;
  right: 10px;
  z-index: 1;
  pointer-events: none;
}
</style>
