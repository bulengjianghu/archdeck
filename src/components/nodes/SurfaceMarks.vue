<script setup lang="ts">
/**
 * 表面元素记号（C6、L20、L23）：展开表面的节点在入边一侧画元素——每个元素一个小记号（端口 ◇、操作 ●、类型 ○、数据 ■，与图例 ELEMENT_KIND_MARK 同一套）与名字，
 * 位置取布局排出的元素端口（自上而下时在顶边，名字横排、相邻两个上下错开一行，放不下时截断加「…」；自左向右时在左边、名字横排一列）。
 * 悬停写全名、种类与扇入；单击 = 选中其模块（节点单击照常），并请求属性面板「表面」一节定位到该元素（focusSurfaceElement，L20④，不进 URL）。
 * 结构视角被显示偏好收起的元素（本层没有画出来的边接到它）变淡。
 * L20b：元素按所属子模块分组时，组之间一道细分隔，组首标子模块短名（自上而下在端口行下方，自左向右在左列、骑在分隔上）；悬停加「属于 <子模块>」。
 */
import { computed } from 'vue'
import type { NodeSurface, SurfaceMark } from '@/layout/canvas'
import { ELEMENT_KIND_LABEL } from '../display/labels'
import { focusSurfaceElement } from '../panel/surfaceFocus'

const props = defineProps<{ surface: NodeSurface; moduleId: string }>()

/** 顶边按横坐标排，相邻两个上下错开（名字横排时一个元素可用两个端口间距的宽度） */
const items = computed(() => (props.surface.side === 'top' ? [...props.surface.items].sort((a, b) => a.x - b.x) : props.surface.items))
const title = (m: SurfaceMark) =>
  `${m.name}${m.kind ? `（${ELEMENT_KIND_LABEL[m.kind]}）` : ''}${m.fanIn !== undefined ? ` · 扇入 ${m.fanIn}` : ''}${m.owner ? ` · 属于 ${m.owner}` : ''}${m.used ? '' : ' · 本层画出来的边没有接到它'}`

/** L20b：组首的标签与组间分隔——分隔在前一组末元素与本组首元素的中点；标签贴在组首元素旁 */
const groups = computed(() => {
  const top = props.surface.side === 'top'
  const along = (m: SurfaceMark) => (top ? m.x : m.y)
  const list = [...props.surface.items].sort((a, b) => along(a) - along(b))
  return list.flatMap((m, i) => (m.group === undefined ? [] : [{ name: m.group, at: along(m), cut: i > 0 ? (along(list[i - 1]) + along(m)) / 2 : null }]))
})
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
    <template v-for="g in groups" :key="`${g.name}@${g.at}`">
      <span
        v-if="g.cut !== null"
        class="group-cut"
        :style="surface.side === 'top' ? { left: `${g.cut}px` } : { top: `${g.cut}px` }"
        data-testid="surface-group-cut"
      />
      <span
        class="group-label"
        :style="surface.side === 'top' ? { left: `${g.cut ?? g.at - 12}px` } : { top: `${g.cut ?? g.at - 14}px` }"
        :data-group="g.name"
        data-testid="surface-group"
        >{{ g.name }}</span
      >
    </template>
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

/* L20b：组间细分隔与组首标签（自上而下：竖线穿过两行名字，标签在端口行下方；自左向右：横线横过左列，标签骑在线上） */
.group-cut {
  position: absolute;
  background: var(--border-strong);
}

.top .group-cut {
  top: 0;
  width: 1px;
  height: 42px;
}

.left .group-cut {
  left: 0;
  width: 128px;
  height: 1px;
}

.group-label {
  position: absolute;
  font-size: 9.5px;
  line-height: 11px;
  color: var(--text-3);
  white-space: nowrap;
  pointer-events: none;
}

.top .group-label {
  top: 30px;
  padding-left: 3px;
}

.left .group-label {
  left: 4px;
  transform: translateY(-50%);
  padding: 0 3px;
  background: var(--surface);
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
