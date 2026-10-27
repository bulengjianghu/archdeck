<script setup lang="ts">
/**
 * 关系边与临时线（L10、ADR-0018、ADR-0029）：一个通道一个维度——
 * 颜色 = 关系类型（查询低饱和 + 半透明、委托实色、未分类中性灰）；线型 = 行为还是依赖（L18，ADR-0035：交互实线，依赖类的线虚线）；箭头 = 同步实心、异步空心；
 * 插座 = 经端口（L12，目标端与箭头叠放）；线宽 = 聚合条数三档；标签位 = ×N、把手与 L26 的异常和修饰（未证实、违规、回调、混合、经上层、未建模……），一律画成 pill；
 * 晕 = 违规（优先）/ 设计变更、选中（强调色窄晕）、回放当前（宽晕 + 流动）。
 * 依赖类的线（代码依赖叠加线 K9、组装叠加 O12、承载缺段 L22）用依赖的端点记号（UmlMarker：开口箭头，组装另在依赖方一端实心菱形）。
 * 时间耦合（J5）：灰色波浪线、无箭头、标 ×N；无依赖无关系的更深色——线型的唯一例外。
 * 第八轮：束内修饰不一致标「混合」、悬停列出各条（D8）；结构视角选中束时它承载的交互临时画出（实线）、带强调色晕（L22 反向）。
 */
import { computed } from 'vue'
import { BaseEdge } from '@vue-flow/core'
import type { RouteEdgeData } from '@/layout/canvas'
import type { Point } from '@/layout/layout'
import { horizontalCurve, retractEnd, roundedPolyline, verticalCurve, wavyPath } from './routePath'
import ArrowMarker from './ArrowMarker.vue'
import SocketMarker from './SocketMarker.vue'
import UmlMarker from './UmlMarker.vue'
import { FLOW, arrowDepth, arrowSize, isDependencyLine, strokeColor, strokeStyle } from './edgeStyle'
import { depEnds, umlDepth } from './depStyle'

const props = defineProps<{ id: string; data: RouteEdgeData }>()

const couple = computed(() => props.data.temp === 'couple')
const draw = (pts: Point[]) => {
  if (couple.value && pts.length === 2) return wavyPath(pts[0], pts[1])
  const c = props.data.route.curve
  if (c && pts.length === 2) return c === 'h' ? horizontalCurve(pts[0], pts[1]) : verticalCurve(pts[0], pts[1])
  return roundedPolyline(pts, 8, props.data.jumps)
}

const look = computed(() => ({ ...props.data, type: props.data.edge.type, isolated: props.data.couple?.isolated }))
const color = computed(() => strokeColor(look.value))
const base = computed(() => ({ ...strokeStyle(look.value), ...(props.data.temp ? {} : { transition: 'opacity 0.15s' }) }))
/** L25：悬停的边加粗一档、不透明度拉满（查询线悬停时也变实）；衬边比线宽 4px */
const style = computed(() => (props.data.hovered ? { ...base.value, strokeWidth: Number(base.value.strokeWidth) + 1, opacity: 1 } : base.value))
const casing = computed(() => (props.data.hovered || props.data.hoverPair ? Number(style.value.strokeWidth) + 4 : 0))
/** 箭头大小随线宽档；线在箭头处回缩一个箭头深度（晕与红晕仍沿完整走线） */
const size = computed(() => arrowSize(props.data.weight))
const path = computed(() => draw(props.data.route.points))
/** L18、L16：依赖类的线用依赖的端点记号——组装叠加依赖方一端实心菱形、被依赖方开口箭头；代码依赖叠加线与承载缺段开口箭头 */
const dep = computed(() => (isDependencyLine(props.data) ? depEnds(props.data.temp === 'assembly' ? 'assembly' : 'use') : null))
/** L20②、L23a②（ADR-0036）：散开到端口点的一段（`#to:`）不画箭头，点就是终点记号 */
const toDot = computed(() => props.id.includes('#to:'))
const linePath = computed(() => {
  if (couple.value || toDot.value) return path.value
  const { points, curve } = props.data.route
  if (!dep.value) return draw(retractEnd(points, curve, arrowDepth(size.value)))
  let pts = retractEnd(points, curve, umlDepth(dep.value.end, size.value))
  if (dep.value.start) pts = retractEnd([...pts].reverse(), curve, umlDepth(dep.value.start, size.value)).reverse()
  return draw(pts)
})

/** 每条边自带箭头 marker，颜色跟随线色 */
const markerId = computed(() => `arrow-${props.id.replace(/[^\w-]/g, c => `_${c.charCodeAt(0)}`)}`)
const depStartId = computed(() => `${markerId.value}-start`)
/** L12：经端口的边在目标端加插座记号（沿完整走线的终点定向，与箭头叠放） */
const socket = computed(() => !!props.data.port && !couple.value)
const socketId = computed(() => `socket-${markerId.value.slice('arrow-'.length)}`)
</script>

<template>
  <defs>
    <UmlMarker v-if="dep" :id="markerId" :end="dep.end" :color="color" :size="size" :line-width="style.strokeWidth" />
    <ArrowMarker v-else :id="markerId" :kind="data.arrow" :color="color" :size="size" :line-width="style.strokeWidth" />
    <UmlMarker v-if="dep?.start" :id="depStartId" :end="dep.start" :color="color" :size="size" :line-width="style.strokeWidth" start />
    <SocketMarker v-if="socket" :id="socketId" :color="color" :size="size" />
  </defs>
  <path
    v-if="data.change && !data.violated"
    :d="path"
    class="edge-diff"
    fill="none"
    :stroke="`var(--diff-${data.change})`"
    :stroke-width="9"
    stroke-linecap="round"
    stroke-linejoin="round"
    :opacity="data.dim ? 0.06 : 0.28"
  />
  <path v-if="data.violated && !data.temp" :d="path" class="edge-violated" fill="none" stroke-linecap="round" :opacity="data.dim ? 0.06 : 0.3" />
  <path
    v-if="casing"
    :d="linePath"
    class="edge-hover-casing"
    :class="{ pair: !data.hovered }"
    fill="none"
    :stroke-width="casing"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
  <path v-if="data.selected" :d="path" class="edge-selected-glow" fill="none" stroke-linecap="round" stroke-linejoin="round" />
  <path v-if="data.temp === 'carried'" :d="path" class="edge-carried-glow" fill="none" stroke-linecap="round" stroke-linejoin="round" />
  <path v-if="data.play === 'current' || data.play === 'hover'" :d="path" class="edge-glow" :class="data.play" fill="none" stroke-linecap="round" />
  <g
    :class="{ 'edge-label-pill': data.pill, 'edge-label-warn': data.warn, 'edge-couple': couple, 'edge-couple-isolated': couple && data.couple?.isolated }"
    :data-temp="data.temp"
    :data-mixed="data.mixed ? '' : undefined"
  >
    <title v-if="data.title">{{ data.title }}</title>
    <BaseEdge
      :id="id"
      :path="linePath"
      :marker-end="couple || toDot ? undefined : `url(#${markerId})`"
      :marker-start="dep?.start ? `url(#${depStartId})` : undefined"
      :style="style"
      :interaction-width="16"
      :label="data.dim || !data.label ? undefined : data.label"
      :label-x="data.route.label?.x"
      :label-y="data.route.label?.y"
      :label-show-bg="true"
      :label-bg-padding="data.pill ? [6, 2] : [4, 2]"
      :label-bg-border-radius="data.pill ? 8 : 4"
      :class="{ 'edge-selected': data.selected, 'edge-core': data.core }"
    />
  </g>
  <path v-if="socket" :d="path" class="edge-socket" fill="none" stroke="none" :opacity="style.opacity" :marker-end="`url(#${socketId})`" />
  <template v-if="data.play === 'current'">
    <path :d="linePath" class="edge-flow-base" fill="none" stroke-linecap="round" :stroke-width="FLOW.baseWidth" />
    <path
      :d="linePath"
      class="edge-flow"
      :class="{ reverse: data.flowReverse }"
      fill="none"
      stroke-linecap="round"
      :stroke-width="FLOW.width"
      :stroke-dasharray="FLOW.dash"
    />
  </template>
</template>

<style scoped>
.edge-diff,
.edge-socket {
  pointer-events: none;
}

.edge-violated {
  pointer-events: none;
  stroke: var(--danger);
  stroke-width: 8;
}

/* L22：反向高亮的承载交互——强调色宽一档的晕 */
.edge-carried-glow {
  pointer-events: none;
  stroke: var(--accent);
  stroke-width: 9;
  opacity: 0.28;
}

/* L25（第十一轮）：悬停——线下垫背景色衬边并加投影，线本身加粗一档、不透明；配对边（L24）只垫衬边、不加投影 */
.edge-hover-casing {
  pointer-events: none;
  stroke: var(--surface);
  filter: drop-shadow(0 1px 2.5px var(--hover-shadow));
}

.edge-hover-casing.pair {
  filter: none;
}

/* 选中：强调色窄晕，与回放当前步骤的宽晕区分；线宽不变 */
.edge-selected-glow {
  pointer-events: none;
  stroke: var(--accent);
  stroke-width: 6;
  opacity: 0.35;
}

.edge-glow {
  pointer-events: none;
  stroke: var(--accent);
  stroke-width: 12;
  opacity: 0.18;
}

.edge-glow.hover {
  stroke: var(--warning);
}

/* 当前消息：沿步骤自己的方向流动（P10），与边的箭头相反时反向。
   底线加粗为强调色，上面走一串浅色短点——不管边本身什么颜色、多粗都看得出流动 */
.edge-flow-base {
  pointer-events: none;
  stroke: var(--accent);
}

.edge-flow {
  pointer-events: none;
  stroke: var(--surface);
  animation: flow 0.9s linear infinite;
}

.edge-flow.reverse {
  animation-direction: reverse;
}

@keyframes flow {
  to {
    stroke-dashoffset: -36;
  }
}
</style>
