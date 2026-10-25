<script setup lang="ts">
/**
 * 表面元素记号（C6、L20、L23）：展开表面的节点在入边一侧画元素——每个元素一个小记号（端口 ◇、操作 ●、类型 ○、数据 ■）与名字，
 * 位置取布局排出的元素端口（自上而下时在顶边、名字竖排；自左向右时在左边、名字横排）。
 * 悬停写名字、种类与扇入；单击 = 选中其模块（节点单击照常），并发出 `arch-desk:surface-element` 事件供属性面板「表面」一节定位（L20④，URL 不变）。
 * 结构视角被显示偏好收起的元素（本层没有画出来的边接到它）变淡。
 */
import { computed } from 'vue'
import { ELEMENT_KIND_LABELS, type NodeSurface, type SurfaceMark } from '@/layout/canvas'

const props = defineProps<{ surface: NodeSurface; moduleId: string }>()

/** 属性面板定位用的事件名（detail：{ module, element }） */
const EVENT = 'arch-desk:surface-element'

const items = computed(() => props.surface.items)
const title = (m: SurfaceMark) =>
  `${m.name}${m.kind ? `（${ELEMENT_KIND_LABELS[m.kind]}）` : ''}${m.fanIn !== undefined ? ` · 扇入 ${m.fanIn}` : ''}${m.used ? '' : ' · 本层画出来的边没有接到它'}`

function locate(m: SurfaceMark) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { module: props.moduleId, element: m.name } }))
}
</script>

<template>
  <div class="surface-marks" :class="surface.side" data-testid="surface-marks">
    <div
      v-for="m in items"
      :key="m.name"
      class="element"
      :class="[m.kind ?? 'unknown', { unused: !m.used }]"
      :style="surface.side === 'top' ? { left: `${m.x}px` } : { top: `${m.y}px` }"
      :data-element="m.name"
      :data-kind="m.kind"
      :title="title(m)"
      @click="locate(m)"
    >
      <span class="dot" />
      <span class="label">{{ m.name }}</span>
    </div>
    <span v-if="surface.more" class="more" data-testid="surface-more" title="宽表面只画本层用得最多的元素；其余元素的边接到节点本体，清单在面板「表面」一节"
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
  pointer-events: auto;
  cursor: pointer;
}

.element.unused {
  opacity: 0.45;
}

.element:hover .label {
  color: var(--accent);
}

/* 自上而下：记号骑在顶边、名字竖排在节点上部 */
.top .element {
  top: -4px;
  flex-direction: column;
  transform: translateX(-50%);
}

.top .label {
  writing-mode: vertical-rl;
  max-height: 74px;
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
  top: 14px;
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

.dot {
  flex: none;
  width: 8px;
  height: 8px;
  box-sizing: border-box;
  border: 1.5px solid var(--text-2);
  background: var(--surface);
}

.operation .more {
  position: absolute;
  right: 8px;
  top: 14px;
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

.dot {
  border-radius: 50%;
  background: var(--text-2);
}

.type .more {
  position: absolute;
  right: 8px;
  top: 14px;
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

.dot {
  border-radius: 50%;
}

.port .more {
  position: absolute;
  right: 8px;
  top: 14px;
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

.dot {
  transform: rotate(45deg) scale(0.9);
}

.data .more {
  position: absolute;
  right: 8px;
  top: 14px;
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

.dot {
  background: var(--text-2);
}
</style>
