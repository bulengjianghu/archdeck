<script setup lang="ts">
/**
 * 泳道头（D-2）：固定在时序图顶部与底部，消息区夹在中间纵向滚动。顶部另画分组框（P13）与系统边界线（A7）。
 * 坐标与消息区共用 PositionedSequence 的横坐标，横向滚动时一起移动。选中模块、文件、关系、视图边、参与者时突出相关泳道（R15）。
 */
import { computed } from 'vue'
import type { PositionedSequence } from '@/layout/sequence'
import { SEQ, headsHeight } from '@/layout/sequence'

const props = defineProps<{
  ps: PositionedSequence
  where: 'top' | 'bottom'
  groupName: (parentId: string) => string
  /** R15：突出的泳道（视图节点 ID） */
  lanes?: ReadonlySet<string>
}>()

const lanes = computed(() => props.ps.model.participants.map(p => ({ p, box: props.ps.lanes.get(p.nodeId)! })).filter(x => x.box))
const top = computed(() => props.where === 'top')
/** 顶部：泳道头在分组框之下；底部：只画泳道头 */
const headY = computed(() => (top.value ? props.ps.headY : 6))
const height = computed(() => (top.value ? headsHeight(props.ps) : SEQ.headerH))
const ICON = { actor: '👤', boundary: '↗', module: '' } as const
</script>

<template>
  <svg :width="ps.size.w" :height="height" class="heads" :class="where">
    <template v-if="top">
      <g v-for="g in ps.groups" :key="`${g.parentId}@${g.x}`">
        <rect :x="g.x - 6" :y="4" :width="g.w + 12" :height="ps.headY + SEQ.headerH - 12" rx="6" class="group-box" />
        <text :x="g.x" :y="16" class="group-name">{{ groupName(g.parentId) }}</text>
      </g>
    </template>
    <line v-if="ps.boundaryX !== undefined" :x1="ps.boundaryX" :x2="ps.boundaryX" :y1="0" :y2="height" class="sys-boundary" />
    <g v-for="{ p, box } in lanes" :key="p.nodeId" :class="['lane', p.kind, { emph: props.lanes?.has(p.nodeId) }]">
      <line :x1="box.x + box.w / 2" :x2="box.x + box.w / 2" :y1="top ? headY + SEQ.headerH - 12 : 0" :y2="top ? height : headY" class="lifeline" />
      <rect :x="box.x" :y="headY" :width="box.w" :height="SEQ.headerH - 12" rx="6" class="head" />
      <text :x="box.x + box.w / 2" :y="headY + (SEQ.headerH - 12) / 2 + 4" text-anchor="middle" class="head-text">{{ ICON[p.kind] }} {{ p.name }}</text>
    </g>
  </svg>
</template>

<style scoped>
.heads {
  display: block;
}

.group-box {
  fill: var(--surface-2);
  stroke: var(--border);
}

.group-name {
  font-size: 10.5px;
  font-weight: 600;
  fill: var(--text-3);
}

.sys-boundary {
  stroke: var(--actor);
  stroke-dasharray: 4 4;
}

.lifeline {
  stroke: var(--border-strong);
  stroke-dasharray: 3 4;
}

.head {
  fill: var(--surface);
  stroke: var(--border-strong);
}

.lane.emph .head {
  stroke: var(--accent);
  stroke-width: 2;
  fill: var(--accent-soft);
}

.lane.emph .head-text {
  fill: var(--accent);
}

.lane.emph .lifeline {
  stroke: var(--accent);
  stroke-dasharray: none;
  stroke-width: 1.5;
}

.actor .head {
  fill: var(--actor-soft);
  stroke: var(--actor);
}

.boundary .head {
  stroke-dasharray: 4 3;
  fill: var(--bg);
}

.head-text {
  font-size: 12px;
  font-weight: 600;
  fill: var(--text);
}
</style>
