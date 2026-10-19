<script setup lang="ts">
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import Section from './Section.vue'
import RelationRow from './RelationRow.vue'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const edge = computed(() => {
  const v = desk.view.value
  return [...(v?.edges ?? []), ...(v?.coreEdges ?? [])].find(e => e.id === props.id)
})
function endName(nodeId: string): string {
  const boundary = nodeId.startsWith('boundary:')
  const id = boundary ? nodeId.slice('boundary:'.length) : nodeId
  const n = desk.index.value?.modules.get(id)?.name ?? id
  return boundary ? `${n}（外部）` : n
}
const endId = (nodeId: string) => (nodeId.startsWith('boundary:') ? nodeId.slice('boundary:'.length) : nodeId)
</script>

<template>
  <div v-if="edge" class="edge-panel">
    <header class="head">
      <h2 class="endpoints">
        <button class="link" @click="desk.select({ kind: 'module', id: endId(edge.from) })">{{ endName(edge.from) }}</button>
        <span class="muted">→</span>
        <button class="link" @click="desk.select({ kind: 'module', id: endId(edge.to) })">{{ endName(edge.to) }}</button>
      </h2>
      <div class="badges">
        <span class="rel-chip" :class="`rel-${edge.type}`">{{ edge.type }}</span>
        <span class="badge">{{ edge.kind === 'aggregate' ? '聚合边' : '直接边' }}</span>
        <span v-if="edge.mode !== 'sync'" class="badge">{{ edge.mode === 'async' ? '异步' : '同步 + 异步' }}</span>
      </div>
      <p class="hint muted">
        由更深层次的 {{ edge.relationIds.length }} 条关系汇总而成。点击任意一条，跳到它真实所在的层次。
      </p>
    </header>
    <Section title="原始关系" :count="edge.relationIds.length">
      <ul class="plain"><RelationRow v-for="r in edge.relationIds" :key="r" :id="r" /></ul>
    </Section>
  </div>
  <div v-else class="head muted">这条边在当前视图中已不存在（可能被筛选隐藏，或描述已更新）。</div>
</template>

<style scoped>
.endpoints {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}

.endpoints .link {
  font-size: inherit;
  font-weight: inherit;
}

.hint {
  margin: 6px 0 0;
  font-size: 12px;
}
</style>
