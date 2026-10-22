<script setup lang="ts">
/** 节点角标，骑在节点上边框：设计版本的「新增 / 修改」与「涉及 N 处变更」（左）；代码事实开启时本层环的编号（右，Y4）；热度开启时右下角的三档色块（J5） */
import type { NodeData } from './types'

defineProps<{ data: NodeData }>()
</script>

<template>
  <div v-if="data.change || data.touched" class="diff-mark">
    <span v-if="data.change === 'added'" class="diff-tag added">新增</span>
    <span v-else-if="data.change === 'changed'" class="diff-tag changed">修改</span>
    <span v-if="data.touched" class="diff-tag touched">△ {{ data.touched }}</span>
  </div>
  <span v-if="data.cycle" class="cycle-mark" :title="`本层的环 ${data.cycle}：与同编号的节点互相依赖`">↻ {{ data.cycle }}</span>
  <span
    v-if="data.heat"
    class="heat-badge"
    :class="`tier-${data.heat.tier}`"
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
