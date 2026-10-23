<script setup lang="ts">
/**
 * 草图画布的节点（present.sketch，F-20–F-28）：本层模块、根草图里的层、由关系派生的引用节点（灰色虚线、只读；
 * 按挂载点深度折叠，标折叠进来的关系条数，05 裁决 4）。
 * 句柄：中心的两个隐藏句柄给直线边定位；模块与引用节点右侧的蓝色小圆点拖出连线（F-21）。
 * 拖到别的节点上时目标高亮「放下 = 降级为其子模块」（层为「放下 = 移入这一层」，F-26）；图上标出变更时右上角角标（新 / 改 / 合 / 拆 / 移）。
 */
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import type { SketchNodeData } from '@/layout/layout'
import { CHANGE_BADGES } from './labels'

const props = defineProps<{ data: SketchNodeData & { drop?: boolean } }>()
const badge = computed(() => (props.data.change ? CHANGE_BADGES[props.data.change] : null))
</script>

<template>
  <div class="sk-node" :class="[data.kind, { selected: data.selected, drop: data.drop, core: data.core }]" :title="`${data.name}（${data.id}）`">
    <Handle id="t" type="target" :position="Position.Top" class="sk-center" :connectable="true" />
    <Handle id="c" type="source" :position="Position.Bottom" class="sk-center" :connectable="false" />
    <span v-if="data.kind === 'layer'" class="tag">层</span>
    <span v-else-if="data.kind === 'reference'" class="tag" :title="data.members ? `折叠显示：${data.members.join('、')}` : undefined"
      >引用<template v-if="(data.relations ?? 0) > 1"> · {{ data.relations }} 条</template></span
    >
    <strong class="name">{{ data.name }}<span v-if="data.core" class="star" title="核心">★</span></strong>
    <code class="id">{{ data.id }}</code>
    <span v-if="data.deeper" class="deeper" title="有下一层：双击进入">›</span>
    <span v-if="badge" class="badge" :class="data.change" :title="badge.title">{{ badge.text }}</span>
    <span v-if="data.drop" class="drop-hint">{{ data.kind === 'layer' ? '放下 = 移入这一层' : '放下 = 降级为其子模块' }}</span>
    <Handle
      v-if="data.kind !== 'layer'"
      id="out"
      type="source"
      :position="Position.Right"
      class="sk-out nodrag"
      :connectable="true"
      title="拖到另一个节点上建关系"
    />
  </div>
</template>

<style scoped>
.sk-node {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 6px 12px;
  border: 1.5px solid var(--border-strong, var(--border));
  border-radius: 8px;
  background: var(--surface);
  font-size: 12.5px;
  cursor: grab;
}

.sk-node.layer {
  background: var(--surface-2);
  border-style: solid;
  border-color: var(--text-3);
}

.sk-node.reference {
  border-style: dashed;
  border-color: var(--text-3);
  background: var(--surface-2);
  color: var(--text-2);
}

.sk-node.core {
  border-color: var(--accent);
}

.sk-node.selected {
  box-shadow: 0 0 0 3px var(--accent-soft);
  border-color: var(--accent);
}

.sk-node.drop {
  outline: 2px dashed var(--warning);
  outline-offset: 4px;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.star {
  margin-left: 4px;
  color: var(--accent);
}

.id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  color: var(--text-3);
}

.tag {
  position: absolute;
  top: -9px;
  left: 8px;
  padding: 0 5px;
  font-size: 10px;
  border-radius: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-3);
}

.deeper {
  position: absolute;
  right: 18px;
  bottom: 4px;
  color: var(--text-3);
  font-weight: 700;
}

.badge {
  position: absolute;
  top: -9px;
  right: -9px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: var(--diff-changed);
}

.badge.added {
  background: var(--diff-added);
}

.badge.merged,
.badge.split {
  background: var(--accent);
}

.badge.moved {
  background: var(--warning);
}

.drop-hint {
  position: absolute;
  bottom: -22px;
  left: 0;
  white-space: nowrap;
  font-size: 11px;
  color: var(--warning);
}

.sk-center {
  top: 50% !important;
  left: 50% !important;
  opacity: 0;
  pointer-events: none;
  width: 1px !important;
  height: 1px !important;
  min-width: 0 !important;
  min-height: 0 !important;
  border: none !important;
}

.sk-out {
  width: 10px !important;
  height: 10px !important;
  border: 2px solid var(--surface) !important;
  background: var(--accent) !important;
  cursor: crosshair;
}
</style>
