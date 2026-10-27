<script setup lang="ts">
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'
import Section from './Section.vue'
import RelationRow from './RelationRow.vue'
import { RELATION_TYPE_LABELS } from '../shared/labels'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const edge = computed(() => {
  const v = desk.view.value
  return [...(v?.edges ?? []), ...(v?.coreEdges ?? []), ...(v?.shelfEdges ?? [])].find(e => e.id === props.id)
})
function endName(nodeId: string): string {
  const boundary = nodeId.startsWith('boundary:')
  const id = boundary ? nodeId.slice('boundary:'.length) : nodeId
  const n = desk.index.value ? moduleName(desk.index.value, id) : id
  return boundary ? `${n}（外部）` : n
}
const endId = (nodeId: string) => (nodeId.startsWith('boundary:') ? nodeId.slice('boundary:'.length) : nodeId)
/** J7：两端模块有时间耦合时标「同提交 ×N」 */
const couple = computed(() => {
  const e = edge.value
  if (!e || !desk.index.value) return undefined
  const a = endId(e.from)
  const b = endId(e.to)
  return desk.index.value.modules.has(a) && desk.index.value.modules.has(b) ? desk.evolution.between(a, b) : undefined
})
const endSelection = (nodeId: string) =>
  desk.index.value?.actors.has(nodeId) ? ({ kind: 'actor', id: nodeId } as const) : ({ kind: 'module', id: endId(nodeId) } as const)
</script>

<template>
  <div v-if="edge" class="edge-panel">
    <header class="head">
      <h2 class="endpoints">
        <button class="link" @click="desk.select(endSelection(edge.from))">{{ endName(edge.from) }}</button>
        <span class="muted">→</span>
        <button class="link" @click="desk.select(endSelection(edge.to))">{{ endName(edge.to) }}</button>
      </h2>
      <div class="badges">
        <span class="rel-chip" :class="`rel-${edge.type}`" :title="edge.type">{{ RELATION_TYPE_LABELS[edge.type] }} ×{{ edge.relationIds.length }}</span>
        <span class="badge">{{ edge.kind === 'aggregate' ? '聚合边' : '直接边' }}</span>
        <span v-if="edge.mode !== 'sync'" class="badge">{{ edge.mode === 'async' ? '异步' : '同步 + 异步' }}</span>
        <button v-if="couple" class="badge couple" title="两端是时间耦合：单击看共同的提交（J7）" @click="desk.select({ kind: 'couple', id: couple.id })">
          同提交 ×{{ couple.shared }}
        </button>
      </div>
      <p class="hint muted">由更深层次的 {{ edge.relationIds.length }} 条关系汇总而成。点击任意一条，跳到它真实所在的层次。</p>
    </header>
    <Section title="原始关系" :count="edge.relationIds.length">
      <ul class="plain">
        <RelationRow v-for="r in edge.relationIds" :key="r" :id="r" summary />
      </ul>
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
