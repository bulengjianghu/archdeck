<script setup lang="ts">
/**
 * 资料区（WS-1、WS-4–WS-7，ADR-0054；原「副栏」）：工作区右侧从顶到底的一列，一到两组上下排列。
 * 时序图、源代码（以及 W5 的图解）都是标签；不跟随选中，只由「打开资料」改变（WS-8）。
 */
import { useDesk } from '@/state/inject'
import DockGroup from './DockGroup.vue'

const desk = useDesk()
const ws = desk.workspace.state
</script>

<template>
  <aside class="dock" aria-label="资料区">
    <DockGroup v-for="(g, gi) in ws.groups" :key="gi" :group="g" :gi="gi" :count="ws.groups.length" :focused="ws.focus === gi" />
  </aside>
</template>

<style scoped>
.dock {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: var(--surface);
}
</style>
