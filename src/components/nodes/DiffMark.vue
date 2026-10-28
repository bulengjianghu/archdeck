<script setup lang="ts">
/**
 * 节点注记的位置表（L37，ADR-0043）中写在边框上的两槽：上边左 = 状态（设计版本的「新增 / 修改」「△N」、组装根 O12）；
 * 下边右 = 没画出来的线（「共用 ×N」O10、O13，「另直连 N」L38）。热度色块固定在右下角内（J5）。环编号在名称行（CycleMark）。
 * 静息态超出上限时按 restHidden 收起（悬停或选中节点时全部出现）。
 */
import { computed } from 'vue'
import type { NodeData } from './types'

const props = defineProps<{ data: NodeData }>()
const showState = computed(() => !props.data.restHidden?.includes('state'))
const showUnseen = computed(() => !props.data.restHidden?.includes('unseen') && (!!props.data.sharedCount || !!props.data.direct))
</script>

<template>
  <div v-if="showState && (data.change || data.touched || data.assemblyRoot)" class="diff-mark">
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
  <span v-if="showUnseen" class="unseen-marks" data-testid="unseen-marks">
    <span
      v-if="data.sharedCount"
      class="shared-mark"
      :title="
        data.sharedByDeps
          ? `依赖 ×${data.sharedCount}（含只引类型）：依赖本层共用件架上的 ${data.sharedCount} 个共用件，悬停或选中时画线（O13）`
          : `用到本层共用件架上的 ${data.sharedCount} 个共用件：悬停或选中时画线（O10）`
      "
      >共用 ×{{ data.sharedCount }}</span
    ><span v-if="data.sharedCount && data.direct" class="sep"> · </span
    ><span v-if="data.direct" class="direct-mark" data-testid="direct-mark" :data-count="data.direct.count" :title="data.direct.title"
      >另直连 {{ data.direct.count }}</span
    >
  </span>
  <span
    v-if="data.heat"
    class="heat-badge"
    :class="[`tier-${data.heat.tier}`]"
    :data-tier="data.heat.tier"
    :title="`${data.heat.kind === 'fixes' ? '缺陷' : '修改'}热度 ${['低', '中', '高'][data.heat.tier - 1]}：${data.heat.kind === 'fixes' ? '缺陷修复' : '修改'} ${data.heat.count} 次，热度 ${Math.round(data.heat.value)}`"
  />
</template>

<style scoped>
.heat-badge {
  position: absolute;
  right: 5px;
  bottom: 11px;
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

.unseen-marks {
  position: absolute;
  bottom: -9px;
  right: 10px;
  z-index: 1;
  padding: 0 6px;
  font-size: 11px;
  line-height: 16px;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  white-space: nowrap;
  pointer-events: auto;
}

.unseen-marks .sep {
  color: var(--text-3);
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
