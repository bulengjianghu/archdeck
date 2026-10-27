<script setup lang="ts">
/**
 * 表面端口点（C6、L20②④、L20b、L23；ADR-0036 定尺寸点阵）：展开表面的节点在入边一侧画一排点——不写名字，形状按种类（端口 ◇、操作 ●、类型 ○、数据 ■，
 * 与图例 ELEMENT_KIND_MARK 同一套），位置取布局在收起态节点上排出的点（自上而下骑在顶边，自左向右骑在左边）；节点尺寸不变。
 * 悬停提示「名字 · 种类 · 所属子模块 · 扇入 N（使用它的模块）」，并经 hoverSurfaceElement 让画布高亮落在点上的边与发起方、面板「表面」一节同一行同亮；
 * 单击 = 选中其模块（节点单击照常），并请求属性面板「表面」一节定位到该元素（focusSurfaceElement，L20④，不进 URL）。
 * 结构视角被显示偏好收起的元素（本层没有画出来的边接到它）变淡。
 * L20b：按子模块分组时组首在点下方写子模块短名（本体一组在最后、不写组名），宽度以到下一组首为限，放不下截短、悬停写全名。
 * 封顶外与放不下的元素收进行尾的「+N」，悬停说明清单在面板。
 */
import { computed } from 'vue'
import type { NodeSurface, SurfaceMark } from '@/layout/canvas'
import { ELEMENT_KIND_LABEL } from '../display/labels'
import { focusSurfaceElement, hoverSurfaceElement, leaveSurfaceElement, useSurfaceHover } from '../panel/surfaceFocus'

const props = defineProps<{ surface: NodeSurface; moduleId: string }>()

const hover = useSurfaceHover()
const hot = computed(() => (hover.value?.module === props.moduleId ? hover.value.element : null))

const title = (m: SurfaceMark) =>
  [
    m.name,
    m.kind ? ELEMENT_KIND_LABEL[m.kind] : null,
    m.owner ? `属于 ${m.owner}` : null,
    m.fanIn !== undefined ? `扇入 ${m.fanIn}${m.users?.length ? `（${m.users.join('、')}）` : ''}` : null,
    m.used ? null : '本层画出来的边没有接到它',
  ]
    .filter(Boolean)
    .join(' · ')

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
      :title="title(m)"
      @mouseenter="hoverSurfaceElement({ module: moduleId, element: m.name })"
      @mouseleave="leaveSurfaceElement(moduleId, m.name)"
      @click="focusSurfaceElement(moduleId, m.name)"
    />
    <template v-for="m in surface.items" :key="`g:${m.name}`">
      <span
        v-if="m.group"
        class="group-label"
        :style="top ? { left: `${m.x - 4}px`, maxWidth: `${m.groupRoom ?? 60}px` } : { top: `${m.y}px`, maxWidth: `${m.groupRoom ?? 60}px` }"
        :data-group="m.group"
        :title="m.owner"
        data-testid="surface-group"
        >{{ m.group }}</span
      >
    </template>
    <span
      v-if="surface.more"
      class="more"
      :style="top ? { left: `${moreAt}px` } : { top: `${moreAt}px` }"
      data-testid="surface-more"
      :title="`另有 ${surface.more} 个元素没画成点（一个节点最多 16 个、入边一侧放得下的为限，本层用得最多的、交互接到的优先）；它们的边接到节点本体，清单在面板「表面」一节`"
      >+{{ surface.more }}</span
    >
  </div>
</template>

<style scoped>
.surface-marks {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* 记号：缺省空心方块；端口 ◇、操作 ●、类型 ○、数据 ■。骑在入边一侧的边框上，中心即端口点 */
.dot {
  position: absolute;
  width: 8px;
  height: 8px;
  box-sizing: border-box;
  border: 1.5px solid var(--text-2);
  background: var(--surface);
  pointer-events: auto;
  cursor: pointer;
}

.top .dot {
  top: -4px;
  transform: translateX(-50%);
}

.left .dot {
  left: -4px;
  transform: translateY(-50%);
}

.dot.port {
  transform: translateX(-50%) rotate(45deg) scale(0.9);
}

.left .dot.port {
  transform: translateY(-50%) rotate(45deg) scale(0.9);
}

.dot.operation {
  border-radius: 50%;
  background: var(--text-2);
}

.dot.type {
  border-radius: 50%;
}

.dot.data {
  background: var(--text-2);
}

.dot.unused {
  opacity: 0.45;
}

/* L20④：悬停（画布或面板）——强调色、略放大 */
.dot.hot,
.dot:hover {
  border-color: var(--accent);
  outline: 2px solid var(--accent-soft);
  opacity: 1;
}

.dot.operation.hot,
.dot.data.hot,
.dot.operation:hover,
.dot.data:hover {
  background: var(--accent);
}

/* L20b：组首短名——自上而下在点下方一行小字，自左向右在点右侧 */
.group-label {
  position: absolute;
  font-size: 9.5px;
  line-height: 11px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: auto;
}

.top .group-label {
  top: 5px;
}

.left .group-label {
  left: 7px;
  transform: translateY(-50%);
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
</style>
