<script setup lang="ts">
/**
 * 资料区（WS-1、WS-4–WS-7，ADR-0054；原「副栏」）：工作区右侧从顶到底的一列，一到两组上下排列。
 * 时序图、源代码、图解、事实页都是标签；不跟随选中，只由「打开资料」改变（WS-8）。
 * 运行视角：组之下常驻「步骤节」（第二十轮 §6，V6 新家）——选中模块等对象时显示「这次流程里它做了什么」；步骤 / 场景面板住抽屉。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import DockGroup from './DockGroup.vue'
import RunSection from '../panel/RunSection.vue'

const desk = useDesk()
const ws = desk.workspace.state
const run = computed(() => desk.perspective.value === 'run')
const runSel = computed(() => ['module', 'relation', 'edge', 'actor', 'port'].includes(desk.selected.value?.kind ?? ''))
// 步骤 / 场景面板住抽屉（运行视角），不在这里重复（02-review 缺陷 5：一个主语）
</script>

<template>
  <aside class="dock" aria-label="资料区">
    <DockGroup v-for="(g, gi) in ws.groups" :key="gi" :group="g" :gi="gi" :count="ws.groups.length" :focused="ws.focus === gi" />
    <!-- 第二十轮 §6：步骤节常驻（不随标签激活消失）；预览源代码等操作不会把它挤走 -->
    <div v-if="run && runSel" class="step-side" data-testid="dock-step-side">
      <RunSection :key="`run:${desk.selected.value?.id ?? ''}`" />
    </div>
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

/* Q4'：步骤节钉在资料区底部、限高内部滚动，不把回放参照挤走 */
.step-side {
  flex: none;
  max-height: 30%;
  overflow: auto;
  border-top: 1px solid var(--border);
  padding: 8px 10px;
  scrollbar-width: thin;
}
</style>
