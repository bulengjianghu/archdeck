<script setup lang="ts">
/**
 * 视图区（LY-7–LY-12，ADR-0064；第二十二轮波 1 沿用旧资料区的一列，波 2 换成主语条 + 拖拽分组）：一到两组上下排列，
 * 组高按分隔比例（LY-10b）。视图标签跟随主语，资料标签不跟随；不再有运行视角特化的步骤节（它是场景情境「描述」标签的内容）。
 */
import { useDesk } from '@/state/inject'
import DockGroup from './DockGroup.vue'

const desk = useDesk()
const ws = desk.workspace.state
</script>

<template>
  <aside class="dock" aria-label="资料区" data-region="views">
    <DockGroup
      v-for="(g, gi) in ws.groups"
      :key="gi"
      :group="g"
      :gi="gi"
      :count="ws.groups.length"
      :style="ws.groups.length > 1 ? { flex: `${gi === 0 ? ws.split : 1 - ws.split} 1 0` } : undefined"
    />
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
