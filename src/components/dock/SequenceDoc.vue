<script setup lang="ts">
/**
 * 时序图标签的内容（WS-10）：顶部一行——本层不可见提示与跳转（R11）、「定位」（调用时序图暴露的 centerCurrent）、
 * 「图例」（时序图的箭头约定，ADR-0017）；下面是时序图。原在副栏标题栏（ADR-0010，被 ADR-0054 部分取代）。
 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import SequenceView from '../sequence/SequenceView.vue'

const desk = useDesk()
const sequence = ref<InstanceType<typeof SequenceView>>()
/** R11：当前帧在本层不可见 */
const hiddenCurrent = computed(() => !!desk.run.frame.value && desk.run.currentIndex.value === null)
/** 时序图图例浮层：再点「图例」或焦点移出即收起 */
const help = ref(false)
</script>

<template>
  <div class="seq-doc">
    <div class="tools">
      <span v-if="hiddenCurrent" class="hint"> 本层不可见：<button class="link" @click="desk.goTo(desk.run.frameLevel.value!)">到能看到它的层次</button> </span>
      <button class="locate" :disabled="desk.run.currentIndex.value === null" @click="sequence?.centerCurrent()">定位</button>
      <button class="help" title="时序图图例" aria-label="时序图图例" :aria-expanded="help" @click="help = !help" @blur="help = false">图例</button>
    </div>
    <div v-if="help" class="seq-legend" role="note" aria-label="时序图图例">
      <div class="item">
        <svg viewBox="0 0 32 10">
          <line x1="1" y1="5" x2="26" y2="5" />
          <path d="M24,1 L31,5 L24,9 z" class="solid" /></svg
        >同步调用（实线、实心箭头）
      </div>
      <div class="item">
        <svg viewBox="0 0 32 10">
          <line x1="1" y1="5" x2="27" y2="5" stroke-dasharray="6 4" />
          <path d="M24,1 L31,5 L24,9" class="open" /></svg
        >异步（虚线、开放箭头）
      </div>
      <div class="item">
        <svg viewBox="0 0 32 10">
          <line x1="1" y1="5" x2="27" y2="5" stroke-dasharray="2 3" />
          <path d="M24,1 L31,5 L24,9" class="open" /></svg
        >返回（点线）
      </div>
    </div>
    <SequenceView ref="sequence" />
  </div>
</template>

<style scoped>
.seq-doc {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.tools {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  flex: none;
}

.hint {
  color: var(--warning);
}

.locate {
  margin-left: auto;
}

.locate,
.help {
  flex: none;
  font-size: 11.5px;
  padding: 1px 8px;
}

.locate:disabled {
  opacity: 0.4;
}

.seq-legend {
  position: absolute;
  top: 32px;
  right: 10px;
  z-index: 10;
  padding: 6px 10px;
  font-size: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 6px 20px rgb(0 0 0 / 12%);
}

.seq-legend .item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 22px;
  white-space: nowrap;
}

.seq-legend svg {
  flex: none;
  width: 32px;
  height: 10px;
  overflow: visible;
}

.seq-legend line,
.seq-legend .open {
  fill: none;
  stroke: var(--text-2);
  stroke-width: 1.5;
}

.seq-legend .solid {
  fill: var(--text-2);
}
</style>
