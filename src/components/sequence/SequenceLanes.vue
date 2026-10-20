<script setup lang="ts">
/**
 * 泳道与消息：参与者头部与生命线、按序自上而下的消息（R2：同步实线实心箭头、异步虚线开放箭头、显式返回点线；S10a 只画显式返回）；
 * 内部活动画成生命线上的激活条；外部参与者在最左，竖线隔出系统边界（A7）。
 */
import { computed } from 'vue'
import type { PositionedSequence } from '@/layout/sequence'
import { SEQ } from '@/layout/sequence'
import type { SequenceMessage } from '@/model'

const props = defineProps<{ ps: PositionedSequence; current: number | null; walked: number; hover: string | null }>()
const emit = defineEmits<{ pick: [m: SequenceMessage]; hover: [m: SequenceMessage | null] }>()

const lanes = computed(() =>
  props.ps.model.participants.map(p => ({ p, box: props.ps.lanes.get(p.nodeId)! })).filter(x => x.box),
)
const cx = (nodeId: string) => {
  const b = props.ps.lanes.get(nodeId)
  return b ? b.x + b.w / 2 : 0
}
const ICON = { actor: '👤', boundary: '↗', module: '' } as const

function state(m: SequenceMessage): string {
  if (m.status !== 'path') return m.status
  if (m.pathIndex === props.current) return 'current'
  return m.pathIndex !== undefined && m.pathIndex < props.walked ? 'walked' : 'future'
}
const isHover = (m: SequenceMessage) => !!m.frameIds[0] && props.hover === `step:${m.frameIds[0]}`
</script>

<template>
  <g class="lanes">
    <line v-if="ps.boundaryX !== undefined" :x1="ps.boundaryX" :x2="ps.boundaryX" :y1="4" :y2="ps.size.h" class="sys-boundary" />
    <text v-if="ps.boundaryX !== undefined" :x="ps.boundaryX + 4" :y="ps.size.h - 6" class="sys-label">系统边界</text>
    <g v-for="{ p, box } in lanes" :key="p.nodeId" :class="['lane', p.kind]">
      <line :x1="box.x + box.w / 2" :x2="box.x + box.w / 2" :y1="SEQ.headerH" :y2="ps.size.h - 8" class="lifeline" />
      <rect :x="box.x" :y="8" :width="box.w" :height="SEQ.headerH - 12" rx="6" class="head" />
      <text :x="box.x + box.w / 2" :y="8 + (SEQ.headerH - 12) / 2 + 4" text-anchor="middle" class="head-text">
        {{ ICON[p.kind] }} {{ p.name }}
      </text>
      <title>{{ p.id }}</title>
    </g>
  </g>
  <g class="messages">
    <g
      v-for="(m, i) in ps.model.messages"
      :key="i"
      :class="['msg', m.kind, state(m), { unmodeled: m.unmodeled, hover: isHover(m) }]"
      @click="m.kind !== 'empty' && emit('pick', m)"
      @mouseenter="m.kind !== 'empty' && emit('hover', m)"
      @mouseleave="emit('hover', null)"
    >
      <rect class="hit" :x="0" :y="ps.messages[i].y - 14" width="100%" :height="28" />
      <template v-if="m.kind === 'empty'">
        <text :x="ps.size.w / 2" :y="ps.messages[i].y + 4" text-anchor="middle" class="empty">{{ m.label }}</text>
      </template>
      <template v-else-if="m.kind === 'internal'">
        <rect :x="cx(m.from) - 5" :y="ps.messages[i].y - 10" width="10" height="20" rx="2" class="activation" />
        <text :x="cx(m.from) + 10" :y="ps.messages[i].y + 4" class="label">{{ m.label || '内部活动' }}</text>
      </template>
      <template v-else>
        <line
          :x1="cx(m.from)"
          :x2="cx(m.to) + (cx(m.to) > cx(m.from) ? -2 : 2)"
          :y1="ps.messages[i].y"
          :y2="ps.messages[i].y"
          class="arrow"
          :marker-end="`url(#seq-${m.kind === 'call' ? 'solid' : 'open'})`"
        />
        <text :x="(cx(m.from) + cx(m.to)) / 2" :y="ps.messages[i].y - 5" text-anchor="middle" class="label">
          {{ m.label }}<tspan v-if="m.unmodeled" class="tag"> · 结构中未建模</tspan>
        </text>
      </template>
      <text v-if="m.pathIndex !== undefined" x="4" :y="ps.messages[i].y + 4" class="num">{{ m.pathIndex + 1 }}</text>
    </g>
  </g>
</template>

<style scoped>
.sys-boundary {
  stroke: var(--actor);
  stroke-dasharray: 4 4;
}

.sys-label {
  font-size: 10px;
  fill: var(--actor);
}

.lifeline {
  stroke: var(--border-strong);
  stroke-dasharray: 3 4;
}

.head {
  fill: var(--surface);
  stroke: var(--border-strong);
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

.msg {
  cursor: pointer;
}

.msg.empty {
  cursor: default;
}

.hit {
  fill: transparent;
}

.msg:hover .hit,
.msg.hover .hit {
  fill: var(--surface-2);
}

.msg.current .hit {
  fill: var(--accent-soft);
}

.arrow {
  stroke: var(--text-2);
  stroke-width: 1.5;
}

.async .arrow {
  stroke-dasharray: 6 4;
}

.return .arrow {
  stroke-dasharray: 2 3;
}

.current .arrow {
  stroke: var(--accent);
  stroke-width: 2.5;
}

.unmodeled .arrow {
  stroke: var(--danger);
}

.activation {
  fill: var(--surface-3);
  stroke: var(--text-3);
}

.current .activation {
  fill: var(--accent-soft);
  stroke: var(--accent);
}

.label {
  font-size: 11.5px;
  fill: var(--text-2);
}

.current .label {
  fill: var(--accent);
  font-weight: 600;
}

.tag {
  fill: var(--danger);
}

.num {
  font-size: 10px;
  fill: var(--text-3);
}

.future {
  opacity: 0.55;
}

.unchosen,
.unreached {
  opacity: 0.28;
}

.empty {
  font-size: 11px;
  fill: var(--text-3);
}
</style>
