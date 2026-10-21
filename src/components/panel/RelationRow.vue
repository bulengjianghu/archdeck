<script setup lang="ts">
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'
import ChangeBadge from './ChangeBadge.vue'

/** 一行关系：点击跳到它真实所在的层次并选中；perspective 给出时只显示对端 */
const props = defineProps<{ id: string; perspective?: string }>()
const desk = useDesk()
const r = computed(() => desk.index.value?.relations.get(props.id))
const name = (id: string) => (desk.index.value ? moduleName(desk.index.value, id) : id)
const ifName = computed(() => (r.value?.interface ? desk.index.value?.interfaces.get(r.value.interface)?.name : undefined))
/** K5：有代码事实时标出证实 */
const fact = computed(() => desk.facts.report.value?.relations.get(props.id)?.status)
</script>

<template>
  <li v-if="r" class="rel-row">
    <button class="link" :title="r.description" @click="desk.revealRelation(r.id)">
      <template v-if="perspective === r.from">→ {{ name(r.to) }}</template>
      <template v-else-if="perspective === r.to">← {{ name(r.from) }}</template>
      <template v-else>{{ name(r.from) }} → {{ name(r.to) }}</template>
    </button>
    <ChangeBadge entity="relation" :id="r.id" />
    <span class="rel-chip" :class="`rel-${r.type}`">{{ r.type }}</span>
    <span v-if="r.mode === 'async'" class="muted">异步</span>
    <code v-if="ifName" class="if">{{ ifName }}</code>
    <span v-if="fact === 'confirmed'" class="fact ok" title="已被代码证实">✓</span>
    <span v-else-if="fact === 'unconfirmed'" class="fact" title="代码中没有对应的依赖">?</span>
  </li>
</template>

<style scoped>
.rel-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  padding: 3px 0;
}

.fact {
  font-size: 12px;
  color: var(--text-3);
}

.fact.ok {
  color: var(--success, var(--accent));
}

.if {
  font-size: 11.5px;
  color: var(--text-2);
}
</style>
