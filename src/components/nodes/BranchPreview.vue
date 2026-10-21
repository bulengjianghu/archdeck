<script setup lang="ts">
/** 停在分支点时各选项首条消息的预览序号：单击即选这一支（F6） */
import { useDesk } from '@/state/inject'
import type { NodeData } from './types'

defineProps<{ data: NodeData }>()
const desk = useDesk()
</script>

<template>
  <button class="preview" @click.stop="desk.chooseBranch(data.preview!.pointId, data.preview!.option)">
    {{ data.preview!.option + 1 }} · {{ data.preview!.label }}
  </button>
</template>

<style scoped>
.preview {
  transform: translate(-50%, -50%);
  width: max-content;
  max-width: 200px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border: 1.5px dashed var(--warning);
  background: var(--warning-soft);
  color: var(--warning);
  border-radius: 10px;
}
</style>
