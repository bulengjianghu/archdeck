<script setup lang="ts">
/** 文件依赖证据（K3、K10）：依赖方:行 → 目标（经由），单击文件即选中它 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import type { FileDep } from '@/model'

const props = withDefaults(defineProps<{ deps: readonly FileDep[]; limit?: number }>(), { limit: 6 })
const desk = useDesk()
const shown = computed(() => props.deps.slice(0, props.limit))
</script>

<template>
  <ul class="plain file-deps">
    <li v-for="(d, i) in shown" :key="`${d.from}:${d.line}:${d.to}:${i}`">
      <button class="link mono" @click="desk.selectFile(d.from)">{{ d.from }}:{{ d.line }}</button>
      <span class="muted">→</span>
      <button class="link mono" @click="desk.selectFile(d.to)">{{ d.to }}</button>
      <span v-if="d.via !== d.to" class="muted via">经由 {{ d.via }}</span>
      <span v-if="d.kind === 'type'" class="muted">类型</span>
    </li>
    <li v-if="deps.length > limit" class="muted">另 {{ deps.length - limit }} 处</li>
  </ul>
</template>

<style scoped>
.file-deps li {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 6px;
  padding: 2px 0;
  font-size: 12px;
}

.mono {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  word-break: break-all;
  text-align: left;
}

.via {
  font-size: 11px;
}
</style>
