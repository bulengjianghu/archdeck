<script setup lang="ts">
// 边的走线由 Layout 给出，不依赖句柄位置；句柄只为满足 Vue Flow 的连线前提，不可见。
import { Handle, Position } from '@vue-flow/core'
</script>

<template>
  <Handle type="target" :position="Position.Top" class="ghost-handle" :connectable="false" />
  <Handle type="source" :position="Position.Bottom" class="ghost-handle" :connectable="false" />
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
</style>
