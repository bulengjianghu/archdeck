<script setup lang="ts">
/** 设计版本的根层面板：设计目标、本轮说明、待确认问题、历轮评审意见、变更清单（ADR-0002；变更清单与提交版本共用 ChangeList） */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDesk } from '@/state/inject'
import { DESIGN_STATUS_LABELS } from '../shared/labels'
import Markdown from './Markdown.vue'
import Section from './Section.vue'
import ChangeList from './ChangeList.vue'

const desk = useDesk()
const route = useRoute()
const router = useRouter()
const d = computed(() => desk.versions.design.value!)
const r = computed(() => desk.versions.revision.value!)

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

    <ChangeList />

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

.sub {
  font-size: 12px;
  color: var(--text-3);
  margin-bottom: 2px;
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
