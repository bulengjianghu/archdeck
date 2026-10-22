<script setup lang="ts">
// 边的走线由 Layout 给出，不依赖句柄位置；句柄只为满足 Vue Flow 的连线前提，不可见。
// 编辑态（X7、C-8）：右侧出现可见的连线柄（source），目标句柄放在节点中心、不可见，松手落在节点附近即连上（画布的 connectionRadius）
import { Handle, Position } from '@vue-flow/core'

defineProps<{ editing?: boolean }>()
</script>

<template>
  <template v-if="editing">
    <Handle type="target" :position="Position.Top" class="ghost-handle center-handle" :connectable="true" />
    <Handle type="source" :position="Position.Right" class="edit-handle nodrag" :connectable="true" title="拖到另一个模块上建关系" />
  </template>
  <template v-else>
    <Handle type="target" :position="Position.Top" class="ghost-handle" :connectable="false" />
    <Handle type="source" :position="Position.Bottom" class="ghost-handle" :connectable="false" />
  </template>
</template>

<style>
.ghost-handle {
  opacity: 0;
  pointer-events: none;
  width: 1px !important;
  height: 1px !important;
  min-width: 0 !important;
  min-height: 0 !important;
  border: none !important;
}

.center-handle {
  top: 50% !important;
  left: 50% !important;
}

.edit-handle {
  width: 10px !important;
  height: 10px !important;
  border: 2px solid var(--surface) !important;
  background: var(--accent) !important;
  cursor: crosshair;
}
</style>
