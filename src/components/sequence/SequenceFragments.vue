<script setup lang="ts">
/**
 * 组合框：左上角标类型；loop 标条件，par 标「并行（串行回放）」，ref 显示被引用场景名；
 * alt 显示全部分支与条件，已选正常、未选淡化、未到达全部淡化；每个条件是可单击的页签，单击即改走这一支（F6e）；
 * 折叠的框（P6）注明本层合并为内部活动。
 */
import type { PositionedSequence } from '@/layout/sequence'
import type { SequenceFragment } from '@/model'

defineProps<{ ps: PositionedSequence }>()
const emit = defineEmits<{ branch: [pointId: string, option: number] }>()

const TAG = { alt: 'alt', loop: 'loop', par: 'par', ref: 'ref' } as const
function title(f: SequenceFragment): string {
  if (f.kind === 'par') return '并行（串行回放）'
  if (f.kind === 'alt') return f.branches?.[0] ? `[${f.branches[0].label}]` : ''
  return f.kind === 'loop' ? `[${f.label}]` : f.label
}
const branchClass = (chosen: boolean | null | undefined) => (chosen === null ? 'unreached' : chosen === false ? 'unchosen' : 'chosen')
</script>

<template>
  <g class="fragments">
    <g v-for="(f, k) in ps.model.fragments" :key="f.id" :class="['frag', f.kind, { collapsed: f.collapsed }]">
      <rect :x="ps.fragments[k].x" :y="ps.fragments[k].y" :width="ps.fragments[k].w" :height="ps.fragments[k].h" rx="4" class="box" />
      <path
        :d="`M${ps.fragments[k].x},${ps.fragments[k].y + 16} h${30} l6,-6 v-10`"
        class="tab"
      />
      <text :x="ps.fragments[k].x + 4" :y="ps.fragments[k].y + 12" class="kind">{{ TAG[f.kind] }}</text>
      <text
        :x="ps.fragments[k].x + 42"
        :y="ps.fragments[k].y + 12"
        class="cond"
        :class="f.kind === 'alt' ? ['pick', branchClass(f.branches?.[0]?.chosen)] : ''"
        @click="f.kind === 'alt' && f.branches?.[0] && emit('branch', f.id, f.branches[0].option)"
      >
        {{ title(f) }}<tspan v-if="f.collapsed" class="muted"> · 本层合并为内部活动</tspan>
      </text>
      <template v-if="f.branches">
        <g v-for="(y, bi) in ps.fragments[k].branchY" :key="bi" :class="f.kind === 'alt' ? branchClass(f.branches[bi + 1]?.chosen) : ''">
          <line :x1="ps.fragments[k].x" :x2="ps.fragments[k].x + ps.fragments[k].w" :y1="y + 2" :y2="y + 2" class="sep" />
          <text
            v-if="f.kind === 'alt' && f.branches[bi + 1]"
            :x="ps.fragments[k].x + 6"
            :y="y + 15"
            class="cond pick"
            @click="emit('branch', f.id, f.branches[bi + 1].option)"
          >
            [{{ f.branches[bi + 1].label }}]
          </text>
        </g>
      </template>
    </g>
  </g>
</template>

<style scoped>
.box {
  fill: none;
  stroke: var(--text-3);
  stroke-width: 1;
}

.tab {
  fill: var(--surface-2);
  stroke: var(--text-3);
}

.kind {
  font-size: 10.5px;
  font-weight: 700;
  fill: var(--text-2);
}

.cond {
  font-size: 11px;
  fill: var(--text-2);
}

.pick {
  cursor: pointer;
}

.pick:hover {
  fill: var(--accent);
  text-decoration: underline;
}

.chosen.pick,
.chosen .pick {
  font-weight: 600;
  text-decoration: underline;
}

.sep {
  stroke: var(--text-3);
  stroke-dasharray: 5 4;
}

.unchosen,
.unreached {
  opacity: 0.4;
}

.frag.ref .box {
  stroke: var(--actor);
}

.collapsed .box {
  stroke-dasharray: 3 3;
}

.muted {
  fill: var(--text-3);
}
</style>
