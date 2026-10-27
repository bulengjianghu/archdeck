<script setup lang="ts">
/**
 * 结构边（L15、L16、L21，ADR-0031、ADR-0032）：束、散开的元素级边与承载段，结构视图私有的编码按 depStyle（端点记号表形态——◇ 为端口实现，明度表档，色相中性）；
 * 共享通道与交互边同义（L18）——线型 = 依赖（一律虚线，ADR-0035）、线宽 = 聚合条数三档（束内元素级边条数）、选中 = 强调色窄晕、聚焦变淡 = 透明度、违规 = 红晕（已知为淡红晕、已豁免为灰描边）。
 * 标签只有角标与异常标记（L26：「×N 元素」、违规、未解释，另有越过入口、逆稳定）；形态、元素、档、条数、覆盖与规则判定在悬停说明里。
 * 承载段（L22，交互视角选中交互时临时画出）带强调色晕。
 */
import { computed } from 'vue'
import { BaseEdge } from '@vue-flow/core'
import type { RouteEdgeData } from '@/layout/canvas'
import type { Point } from '@/layout/layout'
import { horizontalCurve, retractEnd, roundedPolyline, verticalCurve } from './routePath'
import { DOT_ARROW, arrowSize } from './edgeStyle'
import { depEnds, depStroke, umlDepth } from './depStyle'
import UmlMarker from './UmlMarker.vue'

const props = defineProps<{ id: string; data: RouteEdgeData }>()
const look = computed(() => props.data.dep!)
const draw = (pts: Point[]) => {
  const c = props.data.route.curve
  if (c && pts.length === 2) return c === 'h' ? horizontalCurve(pts[0], pts[1]) : verticalCurve(pts[0], pts[1])
  return roundedPolyline(pts, 8, props.data.jumps)
}
const base = computed(() => ({ ...depStroke({ ...look.value, weight: props.data.weight, dim: props.data.dim }), transition: 'opacity 0.15s' }))
/** L25：悬停的边加粗一档、不透明度拉满；衬边比线宽 4px */
const style = computed(() => (props.data.hovered ? { ...base.value, strokeWidth: Number(base.value.strokeWidth) + 1, opacity: 1 } : base.value))
const casing = computed(() => (props.data.hovered ? Number(style.value.strokeWidth) + 4 : 0))
/** L20②（ADR-0036 返工）：接到端口点的元素级边——走线终点就是点的边缘，终点记号小一档（16 个点并排不互相压住），起点记号照常 */
const toDot = computed(() => !!look.value.element && !look.value.rest)
const size = computed(() => arrowSize(props.data.weight) + (look.value.kind === 'subclass' || look.value.kind === 'implements' ? 2 : 0))
const endSize = computed(() => (toDot.value ? DOT_ARROW : size.value))
/** C3：越过入口的元素级边在终点画一个小叉（接到节点本体，没有经过入口） */
const bypassAt = computed(() => {
  if (!look.value.bypass) return null
  const pts = props.data.route.points
  const b = pts[pts.length - 1]
  const a = pts[pts.length - 2] ?? b
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const t = Math.min(1, (size.value + 6) / len)
  return { x: b.x - (b.x - a.x) * t, y: b.y - (b.y - a.y) * t }
})
const ends = computed(() => depEnds(look.value.kind))
const path = computed(() => draw(props.data.route.points))
/** 线在两端的记号处回缩，记号从回缩处画到原端点（晕仍沿完整走线） */
const linePath = computed(() => {
  const { points, curve } = props.data.route
  let pts = retractEnd(points, curve, umlDepth(ends.value.end, endSize.value))
  if (ends.value.start) pts = retractEnd([...pts].reverse(), curve, umlDepth(ends.value.start, size.value)).reverse()
  return draw(pts)
})
const safe = computed(() => props.id.replace(/[^\w-]/g, c => `_${c.charCodeAt(0)}`))
</script>

<template>
  <defs>
    <UmlMarker :id="`dep-end-${safe}`" :end="ends.end" :color="style.stroke" :size="endSize" :line-width="style.strokeWidth" />
    <UmlMarker v-if="ends.start" :id="`dep-start-${safe}`" :end="ends.start" :color="style.stroke" :size="size" :line-width="style.strokeWidth" start />
  </defs>
  <g
    class="dep-edge"
    :class="{ 'dep-carrier': look.carrier }"
    :data-kind="look.kind"
    :data-tier="look.tier"
    :data-violation="look.violation"
    :data-elements="look.elements"
    :data-element="look.element?.name"
    :data-bypass="look.bypass ? '' : undefined"
  >
    <title>{{ look.title }}</title>
    <path
      v-if="look.violation"
      :d="path"
      class="dep-violation"
      :class="look.violation"
      fill="none"
      stroke-linecap="round"
      stroke-linejoin="round"
      :opacity="data.dim ? 0.06 : undefined"
    />
    <path v-if="casing" :d="linePath" class="edge-hover-casing" fill="none" :stroke-width="casing" stroke-linecap="round" stroke-linejoin="round" />
    <path v-if="data.selected" :d="path" class="edge-selected-glow" fill="none" stroke-linecap="round" stroke-linejoin="round" />
    <g :class="{ 'edge-label-warn': data.warn, 'dep-label-soft': !data.warn }">
      <BaseEdge
        :id="id"
        :path="linePath"
        :marker-end="`url(#dep-end-${safe})`"
        :marker-start="ends.start ? `url(#dep-start-${safe})` : undefined"
        :style="style"
        :interaction-width="16"
        :label="data.dim || !data.label ? undefined : data.label"
        :label-x="data.route.label?.x"
        :label-y="data.route.label?.y"
        :label-show-bg="true"
        :label-bg-padding="[4, 2]"
        :label-bg-border-radius="4"
        :class="{ 'edge-selected': data.selected }"
      />
    </g>
    <path
      v-if="bypassAt"
      class="dep-bypass"
      :d="`M${bypassAt.x - 4},${bypassAt.y - 4} L${bypassAt.x + 4},${bypassAt.y + 4} M${bypassAt.x - 4},${bypassAt.y + 4} L${bypassAt.x + 4},${bypassAt.y - 4}`"
      :opacity="data.dim ? 0.12 : 1"
    />
  </g>
</template>

<style scoped>
.dep-violation {
  pointer-events: none;
  stroke-width: 8;
}

.dep-violation.new {
  stroke: var(--danger);
  opacity: 0.3;
}

.dep-violation.known {
  stroke: var(--danger);
  opacity: 0.13;
}

.dep-violation.allowed {
  stroke: var(--text-3);
  stroke-width: 6;
  opacity: 0.25;
}

/* L25（第十一轮）：悬停——线下垫背景色衬边并加投影，线本身加粗一档、不透明；配对边（L24）只垫衬边、不加投影 */
.edge-hover-casing {
  pointer-events: none;
  stroke: var(--surface);
  filter: drop-shadow(0 1px 2.5px var(--hover-shadow));
}

.edge-selected-glow {
  pointer-events: none;
  stroke: var(--accent);
  stroke-width: 6;
  opacity: 0.35;
}

.dep-bypass {
  pointer-events: none;
  fill: none;
  stroke: var(--warning);
  stroke-width: 1.8;
  stroke-linecap: round;
}

.dep-carrier .edge-selected-glow {
  stroke-width: 8;
  opacity: 0.4;
}

.dep-label-soft :deep(.vue-flow__edge-text) {
  fill: var(--text-3);
}
</style>
