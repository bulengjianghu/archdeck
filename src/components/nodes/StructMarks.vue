<script setup lang="ts">
/**
 * 结构视角的节点角标（ADR-0031）：
 * - L17：左缘色条 = 不稳定度三档（稳定 / 居中 / 易变），下边框左侧「入 Ca · 出 Ce」（共用件架上的块只标入）；
 * - K15b：面板查询影响面时闭包里的节点——上边框左侧标方向与距离（牵动 = 传入、依赖 = 传出、双向），外圈按距离由深到浅；
 *   K15d：可能波及的外圈与标记浅一档（不加字，悬停说明）。
 * - L20①：有入口的模块在同一行加「表面 W」（K19）；
 * - B2、L21③：跨界折叠的束——朝外一侧的小记号「界外 入 N · 出 M」，悬停列目标。
 * 环的编号与「共用 ×N」仍由 DiffMark 画（共享通道）。
 */
import { computed } from 'vue'
import type { NodeData } from './types'

const props = defineProps<{ data: NodeData; compact?: boolean }>()
const STABILITY = { stable: '稳定', balanced: '居中', unstable: '易变' } as const
const DIRECTION = { in: '牵动', out: '依赖', both: '双向' } as const
const m = computed(() => props.data.metrics)
const imp = computed(() => props.data.impact)
const dist = computed(() => (imp.value ? (imp.value.distance >= 3 ? '3+' : String(imp.value.distance)) : ''))
const metricsTitle = computed(() => {
  const x = m.value
  if (!x) return ''
  const i = x.instability === null ? '—' : x.instability.toFixed(2)
  const w = x.w !== undefined ? ` · 表面宽度 W ${x.w}（子树外引用的不同表面元素数，K19）` : ''
  return `扇入 Ca ${x.ca}（子树外依赖它的模块）· 扇出 Ce ${x.ce}（它依赖的子树外模块）· 不稳定度 I ${i}${x.band ? `（${STABILITY[x.band]}）` : ''}（K16、L17）${w}`
})
const cross = computed(() => props.data.crossFold)
const crossText = computed(() => {
  const x = cross.value
  if (!x) return ''
  return `界外 ${[x.in ? `入 ${x.in}` : '', x.out ? `出 ${x.out}` : ''].filter(Boolean).join(' · ')}`
})
const impactTitle = computed(() => {
  const x = imp.value
  if (!x) return ''
  const what = x.direction === 'in' ? '改选中的模块会牵动它（影响面）' : x.direction === 'out' ? '选中的模块要它才能工作（依赖面）' : '既在影响面又在依赖面'
  const maybe = x.possible
    ? '；可能波及——只经可截断处（只用具名契约：端口、具名接口、声明的数据结构，或只是再导出）到达，改内部实现时变更可能在那里停下（K15d）'
    : ''
  return `${what}，距离 ${x.distance}${x.inCycle ? '，在模块环中' : ''}${maybe}（K15）`
})
</script>

<template>
  <span v-if="m?.band" class="stability" :class="m.band" :data-band="m.band" :title="metricsTitle" />
  <span v-if="m" class="metrics" :class="{ compact }" data-testid="node-metrics" :title="metricsTitle"
    >入 {{ m.ca }}<template v-if="!m.inOnly"> · 出 {{ m.ce }}</template
    ><template v-if="m.w !== undefined">
      · <span data-testid="node-surface-w">表面 {{ m.w }}</span></template
    ></span
  >
  <span v-if="cross" class="cross-fold" :class="cross.side" data-testid="cross-fold" :data-in="cross.in" :data-out="cross.out" :title="cross.title">{{
    crossText
  }}</span>
  <span v-if="imp" class="impact-ring" :class="[imp.direction, `d${Math.min(imp.distance, 3)}`, { possible: imp.possible }]" />
  <span
    v-if="imp"
    class="impact-mark"
    :class="[imp.direction, { possible: imp.possible }]"
    data-testid="impact-mark"
    :data-distance="dist"
    :data-possible="imp.possible ? '' : undefined"
    :title="impactTitle"
    >{{ DIRECTION[imp.direction] }} {{ dist }}<template v-if="imp.inCycle"> ↻</template></span
  >
</template>

<style scoped>
.stability {
  position: absolute;
  left: 2px;
  top: 6px;
  bottom: 6px;
  width: 4px;
  border-radius: 2px;
  pointer-events: auto;
}

.stability.stable {
  background: var(--stability-stable);
}

.stability.balanced {
  background: var(--stability-mid);
}

.stability.unstable {
  background: var(--stability-unstable);
}

.metrics {
  position: absolute;
  left: 10px;
  bottom: -9px;
  z-index: 1;
  padding: 0 6px;
  font-size: 10.5px;
  line-height: 16px;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  white-space: nowrap;
}

.metrics.compact {
  bottom: -8px;
  font-size: 10px;
  line-height: 14px;
}

.cross-fold {
  position: absolute;
  z-index: 2;
  padding: 0 5px;
  font-size: 10px;
  line-height: 14px;
  color: var(--text-3);
  background: var(--surface);
  border: 1px dashed var(--border-strong);
  border-radius: 7px;
  white-space: nowrap;
  pointer-events: auto;
}

.cross-fold.top {
  top: -8px;
  right: 10px;
}

.cross-fold.bottom {
  bottom: -8px;
  right: 10px;
}

.cross-fold.left {
  left: -6px;
  top: 50%;
  transform: translate(-100%, -50%);
}

.cross-fold.right {
  right: -6px;
  top: 50%;
  transform: translate(100%, -50%);
}

.impact-ring {
  position: absolute;
  inset: -5px;
  border: 2px solid var(--impact-color);
  border-radius: calc(var(--radius) + 4px);
  pointer-events: none;
}

.impact-ring.d2 {
  border-style: dashed;
  opacity: 0.75;
}

.impact-ring.d3 {
  border-style: dotted;
  opacity: 0.6;
}

.impact-ring,
.impact-mark {
  --impact-color: var(--impact-in);
}

.impact-ring.out,
.impact-mark.out {
  --impact-color: var(--impact-out);
}

.impact-ring.both,
.impact-mark.both {
  --impact-color: var(--impact-both);
}

.impact-ring.possible {
  opacity: 0.4;
}

/* K15d：可能波及浅一档——底色换成方向色的浅底、字用方向色，不加字 */
.impact-mark.possible {
  color: var(--impact-color);
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--impact-color);
  opacity: 0.75;
}

.impact-mark {
  position: absolute;
  top: -10px;
  left: 10px;
  z-index: 2;
  padding: 0 6px;
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  color: var(--surface);
  background: var(--impact-color);
  border-radius: 8px;
  white-space: nowrap;
  pointer-events: auto;
}
</style>
