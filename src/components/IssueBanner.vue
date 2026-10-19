<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'

const desk = useDesk()
const open = ref(false)
const errors = computed(() => desk.issues.value.filter(i => i.severity === 'error'))
const warnings = computed(() => desk.issues.value.filter(i => i.severity === 'warning'))
const sorted = computed(() => [...errors.value, ...warnings.value])
</script>

<template>
  <div v-if="sorted.length" class="issues" :class="{ hasError: errors.length > 0 }">
    <button class="summary" @click="open = !open">
      <span v-if="errors.length" class="err">{{ errors.length }} 个错误</span>
      <span v-if="warnings.length" class="warn">{{ warnings.length }} 个提醒</span>
      <span class="muted">架构描述有问题 {{ open ? '▾' : '▸' }}</span>
    </button>
    <ul v-if="open" class="list">
      <li v-for="(i, k) in sorted" :key="k" :class="i.severity">
        <span class="sev">{{ i.severity === 'error' ? '错误' : '提醒' }}</span>
        <span class="msg">{{ i.message }}</span>
        <code v-if="i.file" class="where">{{ desk.modelDir.value }}/{{ i.file }}{{ i.line ? `:${i.line}` : '' }}</code>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.issues {
  position: absolute;
  top: 10px;
  left: 12px;
  z-index: 6;
  max-width: min(760px, calc(100% - 24px));
  background: var(--warning-soft);
  border: 1px solid var(--warning);
  border-radius: var(--radius);
  font-size: 12px;
}

.issues.hasError {
  background: var(--danger-soft);
  border-color: var(--danger);
}

.summary {
  display: flex;
  gap: 10px;
  border: none;
  background: none;
  padding: 5px 10px;
}

.err {
  color: var(--danger);
  font-weight: 600;
}

.warn {
  color: var(--warning);
  font-weight: 600;
}

.list {
  margin: 0;
  padding: 0 10px 8px;
  list-style: none;
  max-height: 40vh;
  overflow: auto;
}

.list li {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 8px;
  padding: 4px 0;
  border-top: 1px solid rgb(0 0 0 / 6%);
}

.sev {
  font-weight: 600;
}

.error .sev {
  color: var(--danger);
}

.warning .sev {
  color: var(--warning);
}

.where {
  grid-column: 2;
  color: var(--text-3);
  font-size: 11px;
}
</style>
