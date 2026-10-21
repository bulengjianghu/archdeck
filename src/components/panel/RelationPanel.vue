<script setup lang="ts">
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'
import Markdown from './Markdown.vue'
import Section from './Section.vue'
import InterfaceItem from './InterfaceItem.vue'
import DataStructureItem from './DataStructureItem.vue'
import ChangeBadge from './ChangeBadge.vue'
import DesignNote from './DesignNote.vue'
import RelationFact from './RelationFact.vue'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const r = computed(() => desk.index.value!.relations.get(props.id)!)
const name = (id: string) => moduleName(desk.index.value!, id)
const point = (id: string) => (desk.index.value!.actors.has(id) ? desk.select({ kind: 'actor', id }) : desk.revealModule(id))
const TYPE: Record<string, string> = {
  depends: '依赖（编译期）',
  calls: '调用（控制权转移）',
  dataflow: '数据推送',
  event: '事件',
  implements: '实现端口 / 契约',
}
const visibleHere = computed(() => desk.view.value?.edges.some(e => e.relationIds.includes(props.id)) ?? false)
</script>

<template>
  <div v-if="r" class="relation-panel">
    <header class="head">
      <h2 class="endpoints">
        <button class="link" @click="point(r.from)">{{ name(r.from) }}</button>
        <span class="arrow">→</span>
        <button class="link" @click="point(r.to)">{{ name(r.to) }}</button>
      </h2>
      <div class="badges">
        <code>{{ r.id }}</code>
        <span class="rel-chip" :class="`rel-${r.type}`">{{ TYPE[r.type] }}</span>
        <span class="badge">{{ r.mode === 'async' ? '异步' : '同步' }}</span>
        <button v-if="!visibleHere" class="small" @click="desk.revealRelation(r.id)">定位到所在层次</button>
        <ChangeBadge entity="relation" :id="r.id" detail />
      </div>
    </header>
    <DesignNote :text="r.designNote" />

    <Section v-if="r.description" title="说明"><Markdown :text="r.description" /></Section>
    <Section title="经由接口">
      <InterfaceItem v-if="r.interface" :id="r.interface" open />
      <p v-else class="muted">未指定</p>
    </Section>
    <Section v-if="r.payload.length" title="交换的数据结构" :count="r.payload.length">
      <DataStructureItem v-for="id in r.payload" :key="id" :id="id" open />
    </Section>
    <RelationFact :id="r.id" />

    <footer class="src muted">出处：{{ desk.modelDir.value }}/{{ r.src.file }}{{ r.src.line ? `:${r.src.line}` : '' }}</footer>
  </div>
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

.arrow {
  color: var(--text-3);
}
</style>
