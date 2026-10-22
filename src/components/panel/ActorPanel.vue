<script setup lang="ts">
/** 外部参与者面板（C-14）：名称、类别、说明、入口关系、由它触发的场景 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { ACTOR_KIND_LABELS } from '../shared/labels'
import Markdown from './Markdown.vue'
import Section from './Section.vue'
import RelationRow from './RelationRow.vue'
import DesignNote from './DesignNote.vue'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const idx = computed(() => desk.index.value!)
const a = computed(() => idx.value.actors.get(props.id))
const relations = computed(() => [...(idx.value.outRelations.get(props.id) ?? []), ...(idx.value.inRelations.get(props.id) ?? [])])
const scenarios = computed(() => (idx.value.triggeredBy.get(props.id) ?? []).map(id => idx.value.scenarios.get(id)!))
</script>

<template>
  <div v-if="a" class="actor-panel">
    <header class="head">
      <div class="title">
        <h2>{{ a.name }}</h2>
      </div>
      <div class="badges">
        <code>{{ a.id }}</code>
        <span class="badge accent">外部参与者</span>
        <span class="badge">{{ ACTOR_KIND_LABELS[a.kind] }}</span>
      </div>
    </header>
    <DesignNote :text="a.designNote" />
    <Section title="说明">
      <Markdown v-if="a.description" :text="a.description" />
      <p v-else class="muted">未填写</p>
    </Section>
    <Section title="入口关系" :count="relations.length">
      <ul v-if="relations.length" class="plain">
        <RelationRow v-for="r in relations" :key="r" :id="r" :perspective="a.id" />
      </ul>
      <p v-else class="muted">没有与系统的关系</p>
    </Section>
    <Section title="由它触发的场景" :count="scenarios.length">
      <ul v-if="scenarios.length" class="plain">
        <li v-for="s in scenarios" :key="s.id" class="scenario-row">
          <button class="link" @click="desk.openScenario(s.id)">▶ {{ s.name }}</button>
          <span v-if="s.cause" class="muted">{{ s.cause }}</span>
        </li>
      </ul>
      <p v-else class="muted">没有以它为第一条消息发送方的场景</p>
    </Section>
    <div class="src muted">
      {{ a.src.file }}<template v-if="a.src.line">:{{ a.src.line }}</template>
    </div>
  </div>
  <div v-else class="head muted">参与者「{{ id }}」在当前描述中不存在。</div>
</template>

<style scoped>
.scenario-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  padding: 3px 0;
}
</style>
