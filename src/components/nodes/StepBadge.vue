<script setup lang="ts">
/** 结构图上的步骤序号：单击即指向该步（R13）；当前步骤高亮 */
import { useDesk } from '@/state/inject'
import type { NodeData } from './types'

defineProps<{ data: NodeData }>()
const desk = useDesk()
</script>

<template>
  <div class="step-badge">
    <button
      v-for="s in data.steps ?? []"
      :key="s.n"
      class="n"
      :class="{ current: s.current, muted: s.muted }"
      @click.stop="desk.seek(s.frameId)"
    >
      {{ s.n }}
    </button>
  </div>
</template>

<style scoped>
.step-badge {
  display: flex;
  gap: 2px;
  transform: translate(-50%, -50%);
  width: max-content;
}

.n {
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  border: 1px solid var(--accent);
  background: var(--surface);
  color: var(--accent);
  font-size: 10.5px;
  line-height: 16px;
  font-weight: 700;
}

.n.muted {
  border-color: var(--border-strong);
  color: var(--text-3);
}

.n.current {
  background: var(--accent);
  color: #fff;
}
</style>
