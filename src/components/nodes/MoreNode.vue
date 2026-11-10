<script setup lang="ts">
/** O8「+N」占位；L39②、L40②：按依赖分层时写成员的层号跨度，跨 ≥ 3 层提示「该标核心或该拆」 */
import type { NodeData } from './types'

defineProps<{ data: NodeData }>()
</script>

<template>
  <div
    class="more"
    :class="{ dim: data.dim, expanded: !!data.expanded }"
    :title="data.expanded ? '收起临时展开的模块' : data.graphFold ? '单击临时展开（不改层次）' : '单击临时展开（不改层次），双击下钻到这一层'"
  >
    <span>{{ data.expanded ? `收起 ${data.expanded} 个` : `+${data.hiddenCount} 个其他模块` }}</span>
    <span v-if="data.foldTiers" class="fold-tiers" data-testid="fold-tiers">折叠 {{ data.hiddenCount }} · {{ data.foldTiers.tiers }}</span>
    <span
      v-if="data.foldTiers?.warn"
      class="fold-warn"
      data-testid="fold-warn"
      title="折叠的普通模块分布在多层：多半有该标核心的（role: core），或这一层该拆（L40②）"
      >{{ data.foldTiers.warn }}</span
    >
  </div>
</template>

<style scoped>
.more {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 12px;
  font-size: 12px;
  color: var(--text-3);
  border: 1px dashed var(--layer-border);
  border-radius: var(--radius);
}

.more {
  cursor: pointer;
}

.fold-tiers {
  font-size: 10.5px;
  color: var(--text-3);
}

.fold-warn {
  font-size: 10.5px;
  color: var(--warning);
}

.more.expanded {
  border-style: solid;
  color: var(--accent);
}

.more.dim {
  opacity: 0.3;
}
</style>
