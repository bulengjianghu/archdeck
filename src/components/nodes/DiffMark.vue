<script setup lang="ts">
/**
 * 节点角标的统一布局（T3 裁决 7）：上边框左侧——设计版本的「新增 / 修改」「△N」与「组装根」角标（O12）；上边框右半——端口记号（L13，PortMarks）；
 * 环的编号（Y4）与「共用 ×N」（O10）在没有顶边端口记号时骑在上边框右侧，有时移到下边框右侧（lowered）；热度色块在右下角内（J5），角标下移时让到左下角。
 */
import { computed } from 'vue'
import type { NodeData } from './types'

const props = defineProps<{ data: NodeData }>()
/** 顶边有端口记号时，环与共用角标移到下边框 */
const lowered = computed(() => props.data.ports?.side === 'top')
</script>

<template>
  <div v-if="data.change || data.touched || data.assemblyRoot" class="diff-mark">
    <span v-if="data.change === 'added'" class="diff-tag added">新增</span>
    <span v-else-if="data.change === 'changed'" class="diff-tag changed">修改</span>
    <span v-if="data.touched" class="diff-tag touched">△ {{ data.touched }}</span>
    <span
      v-if="data.assemblyRoot"
      class="assembly-root"
      :title="`组装根：组装了别的模块、自身不被任何模块组装${data.assemblyRoot > 1 ? `（含 ${data.assemblyRoot} 个组装根）` : ''}（O12、K13）`"
      >组装根{{ data.assemblyRoot > 1 ? ` ×${data.assemblyRoot}` : '' }}</span
    >
  </div>
  <span
    v-if="data.sharedCount"
    class="shared-mark"
    :class="{ shifted: !!data.cycle, lowered }"
    :title="
      data.sharedByDeps
        ? `依赖 ×${data.sharedCount}（含只引类型）：依赖本层共用件架上的 ${data.sharedCount} 个共用件，悬停或选中时画线（O13）`
        : `用到本层共用件架上的 ${data.sharedCount} 个共用件：悬停或选中时画线（O10）`
    "
    >共用 ×{{ data.sharedCount }}</span
  >
  <span v-if="data.cycle" class="cycle-mark" :class="{ lowered }" :title="`本层的环 ${data.cycle}：与同编号的节点互相依赖`">↻ {{ data.cycle }}</span>
  <span
    v-if="data.heat"
    class="heat-badge"
    :class="[`tier-${data.heat.tier}`, { left: lowered && (!!data.cycle || !!data.sharedCount) }]"
    :data-tier="data.heat.tier"
    :title="`${data.heat.kind === 'fixes' ? '缺陷' : '修改'}热度 ${['低', '中', '高'][data.heat.tier - 1]}：${data.heat.kind === 'fixes' ? '缺陷修复' : '修改'} ${data.heat.count} 次，热度 ${Math.round(data.heat.value)}`"
  />
</template>

<style scoped>
.heat-badge {
  position: absolute;
  right: 5px;
  bottom: 5px;
  z-index: 1;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  border: 1px solid var(--surface);
  box-shadow: 0 0 0 1px var(--border-strong);
  pointer-events: none;
}

.heat-badge.tier-1 {
  background: var(--heat-1);
}

.heat-badge.tier-2 {
  background: var(--heat-2);
}

.heat-badge.tier-3 {
  background: var(--heat-3);
}

.cycle-mark {
  position: absolute;
  top: -9px;
  right: 10px;
  z-index: 1;
  padding: 0 6px;
  font-size: 11px;
  line-height: 16px;
  color: var(--danger);
  background: var(--surface);
  border: 1px solid var(--danger);
  border-radius: 8px;
  pointer-events: none;
}

.shared-mark {
  position: absolute;
  top: -9px;
  right: 10px;
  z-index: 1;
  padding: 0 6px;
  font-size: 11px;
  line-height: 16px;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  pointer-events: none;
}

.shared-mark.shifted {
  right: 52px;
}

.cycle-mark.lowered,
.shared-mark.lowered {
  top: auto;
  bottom: -9px;
}

.heat-badge.left {
  right: auto;
  left: 5px;
}

.assembly-root {
  padding: 0 6px;
  font-size: 11px;
  line-height: 16px;
  color: var(--assembly);
  background: var(--surface);
  border: 1px dashed var(--assembly);
  border-radius: 8px;
}

.diff-mark {
  position: absolute;
  top: -9px;
  left: 10px;
  display: flex;
  gap: 4px;
  z-index: 1;
  pointer-events: none;
}
</style>
