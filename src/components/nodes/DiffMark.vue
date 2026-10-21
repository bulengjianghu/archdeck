<script setup lang="ts">
/** 节点角标，骑在节点上边框：设计版本的「新增 / 修改」与「涉及 N 处变更」（左）；代码事实开启时本层环的编号（右，Y4） */
import type { NodeData } from './types'

defineProps<{ data: NodeData }>()
</script>

<template>
  <div v-if="data.change || data.touched" class="diff-mark">
    <span v-if="data.change === 'added'" class="diff-tag added">新增</span>
    <span v-else-if="data.change === 'changed'" class="diff-tag changed">修改</span>
    <span v-if="data.touched" class="diff-tag touched">△ {{ data.touched }}</span>
  </div>
  <span v-if="data.cycle" class="cycle-mark" :title="`本层的环 ${data.cycle}：与同编号的节点互相依赖`">↻ {{ data.cycle }}</span>
</template>

<style scoped>
.cycle-mark {
  position: absolute;
  top: -9px;
  right: 10px;
  z-index: 1;
  padding: 0 6px;
  font-size: 11px;
  line-height: 16px;
  color: var(--danger);
  background: var(--surface);
  border: 1px solid var(--danger);
  border-radius: 8px;
  pointer-events: none;
}

.diff-mark {
  position: absolute;
  top: -9px;
  left: 10px;
  display: flex;
  gap: 4px;
  z-index: 1;
  pointer-events: none;
}
</style>
