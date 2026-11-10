<script setup lang="ts">
/**
 * 表面端口点（C6、L20②④、L20b、L23；ADR-0036 定尺寸点阵）：展开表面的节点在入边一侧画一排点——不写名字，形状按种类（端口 ◇、操作 ●、类型 ○、数据 ■，
 * 与图例 ELEMENT_KIND_MARK 同一套），位置取布局在收起态节点上排出的点（自上而下骑在顶边，自左向右骑在左边）；节点尺寸不变。
 * 返工（2026-10-28）：每个点的命中区 12px（记号 8px 画在命中区中央），悬停一定出现画布自己的提示框（挂到 body、按屏幕坐标放，不随缩放变小，
 * 不靠浏览器 title）——「名字 · 种类」「属于 <子模块>」「扇入 N：使用它的模块」；同时经 hoverSurfaceElement 让画布高亮落在点上的边与发起方、
 * 面板「表面」一节同一行同亮。单击 = 选中其模块（节点单击照常），并请求属性面板「表面」一节定位到该元素（focusSurfaceElement，L20④，不进 URL）。
 * 结构视角被显示偏好收起的元素（本层没有画出来的边接到它）变淡。L20b：画布上不写组名（组间隙由布局留出），所属子模块只在提示框里。
 * 封顶外与放不下的元素收进行尾的「+N」，悬停说明清单在面板。
 */
import { computed, ref } from 'vue'
import type { NodeSurface, SurfaceMark } from '@/layout/canvas'
import { ELEMENT_KIND_LABEL } from '../display/labels'
import { focusSurfaceElement, hoverSurfaceElement, leaveSurfaceElement, useSurfaceHover } from '../panel/surfaceFocus'

const props = defineProps<{ surface: NodeSurface; moduleId: string }>()

const hover = useSurfaceHover()
const hot = computed(() => (hover.value?.module === props.moduleId ? hover.value.element : null))

/** 提示框的各行：名字 · 种类；属于 <子模块>；扇入 N：使用者；收起说明 */
function tipLines(m: SurfaceMark): string[] {
  return [
    `${m.name}${m.kind ? ` · ${ELEMENT_KIND_LABEL[m.kind]}` : ''}`,
    ...(m.owner ? [`属于 ${m.owner}`] : []),
    ...(m.fanIn !== undefined ? [`扇入 ${m.fanIn}${m.users?.length ? `：${m.users.join('、')}` : ''}`] : []),
    ...(m.used ? [] : ['本层画出来的边没有接到它']),
  ]
}

/** 画布上悬停的点（只认指针在这个点上，面板行的悬停只让点同亮、不弹提示框）与它在屏幕上的位置 */
const tip = ref<{ m: SurfaceMark; x: number; y: number } | null>(null)
function enter(m: SurfaceMark, e: MouseEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  // 顶边的点：提示框放在点下方（压在节点上，不挡住落到点上的线与箭头）；左边的点：放在点右侧
  tip.value = top.value ? { m, x: r.left + r.width / 2, y: r.bottom + 6 } : { m, x: r.right + 6, y: r.top + r.height / 2 }
  hoverSurfaceElement({ module: props.moduleId, element: m.name })
}
function leave(m: SurfaceMark) {
  if (tip.value?.m.name === m.name) tip.value = null
  leaveSurfaceElement(props.moduleId, m.name)
}

const top = computed(() => props.surface.side === 'top')
const along = (m: SurfaceMark) => (top.value ? m.x : m.y)
/** 「+N」放在最后一个点之后 */
const moreAt = computed(() => {
  const list = props.surface.items
  return list.length ? Math.max(...list.map(along)) + 10 : 12
})
</script>

<template>
  <div class="surface-marks" :class="surface.side" data-testid="surface-marks">
    <span
      v-for="m in surface.items"
      :key="m.name"
      class="dot"
      :class="[m.kind ?? 'unknown', { unused: !m.used, hot: hot === m.name }]"
      :style="top ? { left: `${m.x}px` } : { top: `${m.y}px` }"
      :data-element="m.name"
      :data-kind="m.kind"
      :aria-label="tipLines(m).join(' · ')"
      @mouseenter="enter(m, $event)"
      @mouseleave="leave(m)"
      @click="focusSurfaceElement(moduleId, m.name)"
    />
    <span
      v-if="surface.more"
      class="more"
      :style="top ? { left: `${moreAt}px` } : { top: `${moreAt}px` }"
      data-testid="surface-more"
      :title="`另有 ${surface.more} 个元素没画成点（一个节点最多 16 个、入边一侧放得下的为限，本层用得最多的、交互接到的优先）；它们的边接到节点本体，清单在面板「表面」一节`"
      >+{{ surface.more }}</span
    >
    <Teleport to="body">
      <div v-if="tip" class="surface-tip" role="tooltip" data-testid="surface-tip" :class="surface.side" :style="{ left: `${tip.x}px`, top: `${tip.y}px` }">
        <div v-for="(line, i) in tipLines(tip.m)" :key="i" :class="{ head: i === 0 }">{{ line }}</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.surface-marks {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* 命中区 12px，中心即端口点；记号（8px）画在 ::before：缺省空心方块，端口 ◇、操作 ●、类型 ○、数据 ■ */
.dot {
  position: absolute;
  width: 12px;
  height: 12px;
  pointer-events: auto;
  cursor: pointer;
}

.top .dot {
  top: -6px;
  transform: translateX(-50%);
}

.left .dot {
  left: -6px;
  transform: translateY(-50%);
}

.dot::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 2px;
  width: 8px;
  height: 8px;
  box-sizing: border-box;
  border: 1.5px solid var(--text-2);
  background: var(--surface);
}

.dot.port::before {
  transform: rotate(45deg) scale(0.9);
}

.dot.operation::before {
  border-radius: 50%;
  background: var(--text-2);
}

.dot.type::before {
  border-radius: 50%;
}

.dot.data::before {
  background: var(--text-2);
}

.dot.unused {
  opacity: 0.45;
}

/* L20④：悬停（画布或面板）——强调色 */
.dot.hot,
.dot:hover {
  opacity: 1;
}

.dot.hot::before,
.dot:hover::before {
  border-color: var(--accent);
  outline: 2px solid var(--accent-soft);
}

.dot.operation.hot::before,
.dot.data.hot::before,
.dot.operation:hover::before,
.dot.data:hover::before {
  background: var(--accent);
}

.more {
  position: absolute;
  font-size: 9.5px;
  line-height: 11px;
  padding: 0 3px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-3);
  pointer-events: auto;
  cursor: pointer;
}

.top .more {
  top: -6px;
}

.left .more {
  left: -6px;
  transform: translateY(-50%);
}

/* 提示框：挂在 body 上、按屏幕坐标放在点的下方（左边的点放在右侧），不随画布缩放，不挡住到点的线 */
.surface-tip {
  position: fixed;
  z-index: 10000;
  transform: translateX(-50%);
  max-width: 320px;
  padding: 6px 9px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface);
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.14);
  color: var(--text-2);
  font-size: 12px;
  line-height: 17px;
  pointer-events: none;
}

.surface-tip.left {
  transform: translateY(-50%);
}

.surface-tip .head {
  color: var(--text);
  font-weight: 600;
}
</style>
