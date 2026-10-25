<script setup lang="ts">
/**
 * 表面元素记号（C6、L20、L23）：展开表面的节点在入边一侧画元素——每个元素一个小记号（端口 ◇、操作 ●、类型 ○、数据 ■，与图例 ELEMENT_KIND_MARK 同一套）与名字，
 * 位置取布局排出的元素端口（自上而下时在顶边，名字横排、相邻两个上下错开一行，放不下时截断加「…」；自左向右时在左边、名字横排一列）。
 * 悬停写全名、种类与扇入；单击 = 选中其模块（节点单击照常），并请求属性面板「表面」一节定位到该元素（focusSurfaceElement，L20④，不进 URL）。
 * 结构视角被显示偏好收起的元素（本层没有画出来的边接到它）变淡。
 */
import { computed } from 'vue'
import type { NodeSurface, SurfaceMark } from '@/layout/canvas'
import { ELEMENT_KIND_LABEL } from '../display/labels'
import { focusSurfaceElement } from '../panel/surfaceFocus'

const props = defineProps<{ surface: NodeSurface; moduleId: string }>()

/** 顶边按横坐标排，相邻两个上下错开（名字横排时一个元素可用两个端口间距的宽度） */
const items = computed(() => (props.surface.side === 'top' ? [...props.surface.items].sort((a, b) => a.x - b.x) : props.surface.items))
const title = (m: SurfaceMark) =>
  `${m.name}${m.kind ? `（${ELEMENT_KIND_LABEL[m.kind]}）` : ''}${m.fanIn !== undefined ? ` · 扇入 ${m.fanIn}` : ''}${m.used ? '' : ' · 本层画出来的边没有接到它'}`
</script>

<template>
  <div class="surface-marks" :class="surface.side" data-testid="surface-marks">
    <div
      v-for="(m, i) in items"
      :key="m.name"
      class="element"
      :class="[m.kind ?? 'unknown', { unused: !m.used, lower: surface.side === 'top' && i % 2 === 1 }]"
      :style="surface.side === 'top' ? { left: `${m.x}px` } : { top: `${m.y}px` }"
      :data-element="m.name"
      :data-kind="m.kind"
      :title="title(m)"
      @click="focusSurfaceElement(moduleId, m.name)"
    >
      <span class="dot" />
      <span class="label">{{ m.name }}</span>
    </div>
    <span
      v-if="surface.more"
      class="more"
      data-testid="surface-more"
      title="宽表面最多画 16 个元素（本层用得最多的、交互接到的优先）；其余元素的边接到节点本体，清单在面板「表面」一节"
      >+{{ surface.more }} 个元素</span
    >
  </div>
</template>

<style scoped>
.surface-marks {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.element {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10.5px;
  line-height: 12px;
  color: var(--text-2);
  /* 相邻元素的外框会重叠（名字错开两行），只让记号与名字接住指针 */
  pointer-events: none;
  cursor: pointer;
}

.element .dot,
.element .label {
  pointer-events: auto;
}

.element.unused {
  opacity: 0.45;
}

.element:hover .label {
  color: var(--accent);
}

/* 自上而下：记号骑在顶边，名字横排在记号下方；相邻两个错开一行，每个名字最多占两个端口间距 */
.top .element {
  top: -4px;
  flex-direction: column;
  transform: translateX(-50%);
}

.top .element.lower .label {
  margin-top: 13px;
}

.top .label {
  max-width: 52px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 自左向右：记号骑在左边、名字横排在左侧一列 */
.left .element {
  left: -4px;
  transform: translateY(-50%);
}

.left .label {
  max-width: 112px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.more {
  position: absolute;
  right: 8px;
  top: 34px;
  font-size: 10px;
  color: var(--text-3);
  pointer-events: auto;
}

.left .more {
  top: auto;
  bottom: 4px;
  left: 6px;
  right: auto;
}

/* 记号：缺省空心方块；端口 ◇、操作 ●、类型 ○、数据 ■ */
.dot {
  flex: none;
  width: 8px;
  height: 8px;
  box-sizing: border-box;
  border: 1.5px solid var(--text-2);
  background: var(--surface);
}

.port .dot {
  transform: rotate(45deg) scale(0.9);
}

.operation .dot {
  border-radius: 50%;
  background: var(--text-2);
}

.type .dot {
  border-radius: 50%;
}

.data .dot {
  background: var(--text-2);
}
</style>
