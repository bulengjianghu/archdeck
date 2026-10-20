<script setup lang="ts">
/** 分支选择（F6）：停在分支点时展开全部选项（条件 + 首条消息），选一个后路径延长，由用户单步继续 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'

const desk = useDesk()
const point = computed(() => desk.branchPoint.value)
function firstLabel(k: number): string {
  const f = point.value?.options[k].first
  const idx = desk.index.value
  if (!f || !idx) return '（无步骤）'
  return `${moduleName(idx, f.from)} → ${moduleName(idx, f.to)}${f.label ? `：${f.label}` : ''}`
}
</script>

<template>
  <div v-if="point" class="branches" role="group" aria-label="选择分支">
    <span class="title">分支</span>
    <button v-for="(o, k) in point.options" :key="k" class="opt" :title="firstLabel(k)" @click="desk.chooseBranch(point.id, k)">
      <span class="no">{{ k + 1 }}</span>
      <span class="when">{{ o.when }}</span>
      <span class="first muted">{{ firstLabel(k) }}</span>
    </button>
  </div>
</template>

<style scoped>
.branches {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.title {
  font-size: 12px;
  color: var(--warning);
  font-weight: 600;
}

.opt {
  display: flex;
  align-items: baseline;
  gap: 6px;
  max-width: 360px;
  border-color: var(--warning);
  background: var(--warning-soft);
}

.no {
  font-weight: 700;
  color: var(--warning);
}

.when {
  font-weight: 600;
}

.first {
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
