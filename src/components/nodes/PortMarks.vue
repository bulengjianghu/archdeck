<script setup lang="ts">
/**
 * L13：节点定义的端口记号——骑在进边一侧（顶边 / 自左向右布局时左边）的后半，每个端口一个小记号（插座半圆 + 实现者数），
 * 超过 3 个合成一个「端口 ×N」。单击端口即选中它（V2，URL sel=p:<接口 ID>）；单击合成的记号选中定义模块（面板「端口」一节逐个列出）。
 * 不参与布局：布局在进边一侧的后半留了位置（L11 的保留端口）。
 */
import { useDesk } from '@/state/inject'
import type { NodePorts } from '@/layout/canvas'

const props = defineProps<{ ports: NodePorts; moduleId: string }>()
const desk = useDesk()
const pick = (id: string) => desk.select({ kind: 'port', id })
const pickAll = () => desk.select({ kind: 'module', id: props.moduleId })
</script>

<template>
  <div class="port-marks nodrag" :class="ports.side" @dblclick.stop>
    <button
      v-for="p in ports.items"
      :key="p.id"
      class="port-mark"
      :class="{ selected: ports.selected === p.id, orphan: !p.implementers }"
      :data-port="p.id"
      :title="`端口「${p.name}」：实现者 ${p.implementers}（单击看端口面板）`"
      :aria-label="`端口 ${p.name}，实现者 ${p.implementers}`"
      @click.stop="pick(p.id)"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1 A4 4 0 0 0 2 9" /></svg>
      <span class="n">{{ p.implementers }}</span>
    </button>
    <button
      v-if="ports.merged"
      class="port-mark merged"
      :class="{ selected: !!ports.selected }"
      :title="`${ports.merged} 个端口（单击在面板里逐个列出）`"
      :aria-label="`端口 ×${ports.merged}`"
      @click.stop="pickAll"
    >
      端口 ×{{ ports.merged }}
    </button>
  </div>
</template>

<style scoped>
/* 顶边：后半（右半）骑在边框上；左边：后半（下半）骑在边框上 */
.port-marks {
  position: absolute;
  display: flex;
  gap: 3px;
  z-index: 2;
  pointer-events: none;
}

.port-marks.top {
  left: 55%;
  right: 6px;
  top: -9px;
  flex-direction: row;
  justify-content: flex-start;
}

.port-marks.left {
  top: 55%;
  bottom: 4px;
  left: -9px;
  flex-direction: column;
  justify-content: flex-start;
}

.port-mark {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 1px;
  height: 17px;
  padding: 0 4px 0 2px;
  font: inherit;
  font-size: 10.5px;
  line-height: 1;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  cursor: pointer;
}

.port-mark svg path {
  fill: none;
  stroke: var(--rel-commands);
  stroke-width: 1.6;
  stroke-linecap: round;
}

.port-mark.orphan {
  border-color: var(--warning);
}

.port-mark.merged {
  padding: 0 6px;
}

.port-mark:hover {
  border-color: var(--accent);
}

.port-mark.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}
</style>
