<script setup lang="ts">
/** 设计版本的变更角标：骑在节点上边框，显示「新增 / 修改」与「涉及 N 处变更」 */
import type { NodeData } from './types'

defineProps<{ data: NodeData }>()
</script>

<template>
  <div v-if="data.change || data.touched" class="diff-mark">
    <span v-if="data.change === 'added'" class="diff-tag added">新增</span>
    <span v-else-if="data.change === 'changed'" class="diff-tag changed">修改</span>
    <span v-if="data.touched" class="diff-tag touched">△ {{ data.touched }}</span>
  </div>
</template>

<style scoped>
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
