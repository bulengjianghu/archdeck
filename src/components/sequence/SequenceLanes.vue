<script setup lang="ts">
/**
 * 消息区：生命线与按序自上而下的消息（R2：同步实线实心箭头、异步虚线开放箭头、显式返回点线；S10a 只画显式返回）；
 * 内部活动画成生命线上的激活条；外部参与者在最左，竖线隔出系统边界（A7）。
 * 选中突出（R15、R16）：只有选中的步骤用选中样式，配对的调用 / 返回加浅色「配对」标记；选中其他对象时突出泳道的生命线，
 * 进度所在的消息只在序号旁加小标记。
 * 泳道头在 SequenceHeads（固定在顶部与底部，D-2）。不做悬停弹出（W-1）。
 */
import { computed } from 'vue'
import type { PositionedSequence } from '@/layout/sequence'
import { headsHeight } from '@/layout/sequence'
import type { SequenceMessage } from '@/model'
import type { Emphasis } from '@/state/transition'

const props = defineProps<{
  ps: PositionedSequence
  /** 进度所在的可见消息序号 */
  current: number | null
  walked: number
  hover: string | null
  /** R15、R16：选中突出；null 表示结构视角 */
  emphasis: Emphasis | null
}>()
const emit = defineEmits<{ pick: [m: SequenceMessage]; hover: [m: SequenceMessage | null] }>()
const top = computed(() => headsHeight(props.ps))

const lanes = computed(() => props.ps.model.participants.map(p => ({ p, box: props.ps.lanes.get(p.nodeId)! })).filter(x => x.box))
const cx = (nodeId: string) => {
  const b = props.ps.lanes.get(nodeId)
  return b ? b.x + b.w / 2 : 0
}

function state(m: SequenceMessage): string {
  if (m.status !== 'path' || m.pathIndex === undefined) return m.status
  const em = props.emphasis
  if (em?.selected === m.pathIndex) return 'selected'
  const pos = m.pathIndex < props.walked ? 'walked' : 'future'
  return pos + (em?.paired.has(m.pathIndex) ? ' paired' : '')
}
/** 选中的不是步骤时，进度所在的消息只在序号旁加小标记 */
const isProgress = (m: SequenceMessage) => m.pathIndex !== undefined && m.pathIndex === props.current && props.emphasis?.selected == null
const isHover = (m: SequenceMessage) => !!m.frameIds[0] && props.hover === `step:${m.frameIds[0]}`
</script>

<template>
  <g class="lanes">
    <line v-if="ps.boundaryX !== undefined" :x1="ps.boundaryX" :x2="ps.boundaryX" :y1="top" :y2="ps.size.h" class="sys-boundary" />
    <text v-if="ps.boundaryX !== undefined" :x="ps.boundaryX + 4" :y="ps.size.h - 6" class="sys-label">系统边界</text>
    <line
      v-for="{ p, box } in lanes"
      :key="p.nodeId"
      :x1="box.x + box.w / 2"
      :x2="box.x + box.w / 2"
      :y1="top"
      :y2="ps.size.h"
      :class="['lifeline', { emph: emphasis?.lanes.has(p.nodeId) }]"
    />
  </g>
  <g class="messages">
    <g
      v-for="(m, i) in ps.model.messages"
      :key="i"
      :class="['msg', m.kind, state(m), { unmodeled: m.temp === 'unmodeled', hover: isHover(m) }]"
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
        <text :x="cx(m.from) + 10" :y="ps.messages[i].y + 4" class="label"
          >{{ m.label || '内部活动' }}<tspan v-if="ps.messages[i].evidence === 'none'" class="no-evidence"> ?</tspan
          ><tspan v-if="m.shared?.length" class="shared-tag" data-testid="shared-badge">
            · {{ m.shared.length > 1 ? `共用 ×${m.shared.length}` : `共用 ${m.shared[0].name}`
            }}<title>经过共用件：{{ m.shared.map(s => s.name).join('、') }}（P18）</title></tspan
          ></text
        >
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
          {{ m.label }}<tspan v-if="m.temp === 'unmodeled'" class="tag"> · 结构中未建模</tspan
          ><tspan v-else-if="m.temp === 'upper'" class="upper-tag"> · 经由上层关系</tspan
          ><tspan v-if="ps.messages[i].evidence === 'none'" class="no-evidence"> ?</tspan
          ><tspan v-if="state(m).includes('paired')" class="pair-tag"> · 配对</tspan>
        </text>
      </template>
      <text v-if="m.pathIndex !== undefined" x="4" :y="ps.messages[i].y + 4" class="num"
        >{{ m.pathIndex + 1 }}<tspan v-if="isProgress(m)" class="progress" dx="2">◂</tspan></text
      >
    </g>
  </g>
</template>

<style scoped>
.shared-tag {
  fill: var(--text-3);
  font-size: 11px;
}

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

.msg.selected .hit {
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

.selected .arrow {
  stroke: var(--accent);
  stroke-width: 2.5;
}

/* R15：配对的调用 / 返回只加浅色标记 */
.paired .arrow {
  stroke: var(--accent);
  stroke-opacity: 0.45;
}

.upper-tag {
  font-size: 10px;
  fill: var(--text-3);
}

.pair-tag {
  font-size: 10px;
  fill: var(--accent);
  opacity: 0.7;
}

.unmodeled .arrow {
  stroke: var(--danger);
}

.activation {
  fill: var(--surface-3);
  stroke: var(--text-3);
}

.selected .activation {
  fill: var(--accent-soft);
  stroke: var(--accent);
}

.label {
  font-size: 11.5px;
  fill: var(--text-2);
}

.selected .label {
  fill: var(--accent);
  font-weight: 600;
}

.tag {
  fill: var(--danger);
}

/* S17：无证据的消息，与结构图未证实边同一记号 */
.no-evidence {
  fill: var(--warning);
  font-weight: 700;
}

.num {
  font-size: 10px;
  fill: var(--text-3);
}

/* 选中的不是步骤时，进度所在的位置 */
.progress {
  fill: var(--accent);
  font-size: 10px;
}

.lifeline.emph {
  stroke: var(--accent);
  stroke-dasharray: none;
  stroke-width: 1.5;
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
