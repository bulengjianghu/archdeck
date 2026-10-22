<script setup lang="ts">
/** 设计版本的根层面板：设计目标、本轮说明、待确认问题、历轮评审意见、变更清单（ADR-0002） */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDesk } from '@/state/inject'
import type { Change, EntityKind } from '@/model'
import { DESIGN_STATUS_LABELS } from '../shared/labels'
import Markdown from './Markdown.vue'
import Section from './Section.vue'
import ChangeBadge from './ChangeBadge.vue'

const desk = useDesk()
const route = useRoute()
const router = useRouter()
const d = computed(() => desk.versions.design.value!)
const r = computed(() => desk.versions.revision.value!)
const diff = computed(() => desk.versions.diff.value)

const ENTITY_LABEL: Record<EntityKind, string> = { module: '模块', relation: '关系', interface: '接口', dataStructure: '数据结构' }
const groups = computed(() => {
  const changes = diff.value?.changes ?? []
  return (Object.keys(ENTITY_LABEL) as EntityKind[])
    .map(entity => ({ entity, label: ENTITY_LABEL[entity], items: changes.filter(c => c.entity === entity) }))
    .filter(g => g.items.length)
})

function reveal(c: Change) {
  if (c.kind === 'removed') return
  if (c.entity === 'module') desk.revealModule(c.id)
  else if (c.entity === 'relation') desk.revealRelation(c.id)
  else {
    // 接口 / 数据结构：跳到提供或持有它的模块
    const idx = desk.index.value!
    const owner =
      (c.entity === 'interface' ? idx.interfaces.get(c.id)?.owner : undefined) ??
      [...idx.modules.values()].find(m => (c.entity === 'interface' ? m.provides : m.dataStructures)?.includes(c.id))?.id
    if (owner) desk.revealModule(owner)
  }
}

function openRevision(id: string) {
  void router.push({ name: 'design', params: { project: desk.project!, design: d.value.id, revision: id }, query: route.query })
}
</script>

<template>
  <div class="design-section">
    <header class="head">
      <h2>{{ d.name }}</h2>
      <div class="badges">
        <code>{{ d.id }} / {{ r.id }}</code>
        <span class="badge warn">设计版本</span>
        <span class="badge">{{ DESIGN_STATUS_LABELS[d.status] }}</span>
        <span v-if="d.base?.commit" class="badge" :title="d.base.commit">基于 {{ d.base.commit.slice(0, 8) }}</span>
      </div>
    </header>

    <Section v-if="d.problems.length" title="design.yaml 问题" :count="d.problems.length">
      <ul class="problems">
        <li v-for="p in d.problems" :key="p">{{ p }}</li>
      </ul>
    </Section>
    <Section v-if="d.goal" title="设计目标与范围"><Markdown :text="d.goal" /></Section>
    <Section v-if="r.summary" :title="`本轮（${r.id}）做了什么`"><Markdown :text="r.summary" /></Section>
    <Section v-if="r.questions?.length" title="待评审确认" :count="r.questions.length">
      <ol class="questions">
        <li v-for="q in r.questions" :key="q"><Markdown :text="q" /></li>
      </ol>
    </Section>

    <Section :title="`变更清单（相对${desk.versions.baseline.value?.label ?? '基线'}）`" :count="diff?.changes.length ?? 0">
      <p v-if="!diff?.changes.length" class="muted">没有变更</p>
      <div v-for="g in groups" :key="g.entity" class="group">
        <div class="sub">{{ g.label }} · {{ g.items.length }}</div>
        <ul class="plain">
          <li v-for="c in g.items" :key="c.id" class="change">
            <span v-if="c.kind === 'removed'" class="diff-tag removed">删除</span>
            <ChangeBadge v-else :entity="c.entity" :id="c.id" />
            <button v-if="c.kind !== 'removed'" class="link" @click="reveal(c)">{{ c.name }}</button>
            <span v-else class="removed-name">{{ c.name }}</span>
            <code class="id">{{ c.id }}</code>
          </li>
        </ul>
      </div>
    </Section>

    <Section title="评审轮次" :count="d.revisions.length">
      <ol class="revisions">
        <li v-for="x in d.revisions" :key="x.id" :class="{ current: x.id === r.id }">
          <div class="rev-head">
            <button class="link" :disabled="x.id === r.id" @click="openRevision(x.id)">{{ x.id }}</button>
            <span v-if="x.date" class="muted">{{ x.date }}</span>
            <span v-if="x.id === r.id" class="badge accent">正在查看</span>
          </div>
          <div v-if="x.feedback" class="feedback">
            <div class="sub">评审意见</div>
            <Markdown :text="x.feedback" />
          </div>
          <div v-else-if="x.id === d.revisions[d.revisions.length - 1]?.id" class="muted small-note">等待评审意见</div>
        </li>
      </ol>
    </Section>
  </div>
</template>

<style scoped>
.problems {
  margin: 0;
  padding-left: 1.2em;
  color: var(--danger);
  font-size: 12.5px;
}

.questions {
  margin: 0;
  padding-left: 1.4em;
}

.questions li + li {
  margin-top: 4px;
}

.group + .group {
  margin-top: 8px;
}

.sub {
  font-size: 12px;
  color: var(--text-3);
  margin-bottom: 2px;
}

.change {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 0;
}

.change .id {
  font-size: 11px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.removed-name {
  text-decoration: line-through;
  color: var(--text-3);
}

.revisions {
  margin: 0;
  padding-left: 1.2em;
}

.revisions li {
  padding: 4px 0;
}

.rev-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.feedback {
  margin-top: 4px;
  padding: 6px 10px;
  background: var(--surface-2);
  border-radius: 6px;
  font-size: 12.5px;
}

.small-note {
  font-size: 12px;
}
</style>
