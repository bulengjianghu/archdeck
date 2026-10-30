<script setup lang="ts">
/**
 * 外部参与者面板（C-14；V15、PC-10，ADR-0053）：头部（名称、类别徽标）之下——理解：说明、入口关系；
 * 相关资料：由它触发的场景（A6）；出处 footer 在最底。运行视角下理解卡首节为运行信息（V6）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { ACTOR_KIND_LABELS } from '../shared/labels'
import Markdown from './Markdown.vue'
import Section from './Section.vue'
import RelationRow from './RelationRow.vue'
import DesignNote from './DesignNote.vue'
import PanelCard from './PanelCard.vue'
import RelatedCard from './RelatedCard.vue'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const idx = computed(() => desk.index.value!)
const a = computed(() => idx.value.actors.get(props.id))
const relations = computed(() => [...(idx.value.outRelations.get(props.id) ?? []), ...(idx.value.inRelations.get(props.id) ?? [])])
const scenarios = computed(() => idx.value.triggeredBy.get(props.id) ?? [])
</script>

<template>
  <div v-if="a" class="actor-panel">
    <header class="head" data-sec="head">
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
    <PanelCard kind="understand" title="理解" closed-summary>
      <Section title="说明" data-sec="purpose">
        <Markdown v-if="a.description" :text="a.description" />
        <p v-else class="muted">未填写</p>
      </Section>
      <Section title="入口关系" :count="relations.length" data-sec="boundary.relations">
        <ul v-if="relations.length" class="plain">
          <RelationRow v-for="r in relations" :key="r" :id="r" :perspective="a.id" />
        </ul>
        <p v-else class="muted">本参与者没有与系统的关系</p>
      </Section>
    </PanelCard>
    <RelatedCard :scenarios="scenarios" />
    <footer class="src muted">
      {{ a.src.file }}<template v-if="a.src.line">:{{ a.src.line }}</template>
    </footer>
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
