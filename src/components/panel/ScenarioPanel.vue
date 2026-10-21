<script setup lang="ts">
/**
 * 场景面板（选中场景时，即进度在开头且没有选中其他对象，V2、R12）：说明、触发者与原因、场景所在层次（可跳转）、参与模块、ref 的引用与被引用。
 * 步骤目录在导航树的步骤树里（T6）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { forEachStep, moduleName, triggerOf } from '@/model'
import Section from './Section.vue'
import Markdown from './Markdown.vue'
import DesignNote from './DesignNote.vue'

const desk = useDesk()
const idx = computed(() => desk.index.value!)
const sc = computed(() => desk.run.scenario.value!)
const trigger = computed(() => triggerOf(idx.value, sc.value.id))
const empty = computed(() => (desk.run.scenarioView.value?.messages.length ?? 0) === 0)

const participants = computed(() => {
  const plan = desk.run.plan.value
  return plan ? [...new Set([...plan.frames.values()].flatMap(f => [f.from, f.to]))] : []
})
const refs = computed(() => {
  const out = new Set<string>()
  forEachStep(sc.value.steps, s => s.kind === 'ref' && out.add(s.scenario))
  return [...out]
})
const referencedBy = computed(() =>
  [...idx.value.scenarios.values()].filter(o => {
    let hit = false
    forEachStep(o.steps, s => (hit ||= s.kind === 'ref' && s.scenario === sc.value.id))
    return hit
  }),
)
function pointAt(id: string) {
  if (idx.value.actors.has(id)) desk.select({ kind: 'actor', id })
  else desk.revealModule(id)
}
</script>

<template>
  <div v-if="sc" class="scenario-panel">
    <header class="head">
      <div class="title"><h2>{{ sc.name }}</h2></div>
      <div class="badges">
        <code>{{ sc.id }}</code>
        <span class="badge accent">场景</span>
      </div>
    </header>
    <DesignNote :text="sc.designNote" />
    <div v-if="empty" class="notice">
      本层看不到这个场景的任何一步。
      <button v-if="desk.run.home.value" class="link" @click="desk.goTo(desk.run.home.value)">跳到场景所在层次：{{ moduleName(idx, desk.run.home.value) }}</button>
    </div>
    <Section v-if="sc.description" title="说明"><Markdown :text="sc.description" /></Section>
    <Section title="触发">
      <div>
        <span class="muted">触发者</span>
        <button v-if="trigger" class="link" @click="pointAt(trigger)">{{ moduleName(idx, trigger) }}</button>
        <span v-else class="muted">—</span>
      </div>
      <div v-if="sc.cause"><span class="muted">原因</span> {{ sc.cause }}</div>
      <div v-if="desk.run.home.value">
        <span class="muted">所在层次</span>
        <button class="link" @click="desk.goTo(desk.run.home.value)">{{ moduleName(idx, desk.run.home.value) }}</button>
      </div>
    </Section>
    <Section title="参与的模块与参与者" :count="participants.length">
      <span v-for="(id, i) in participants" :key="id">
        <span v-if="i > 0" class="muted"> · </span><button class="link" @click="pointAt(id)">{{ moduleName(idx, id) }}</button>
      </span>
    </Section>
    <Section v-if="refs.length || referencedBy.length" title="引用">
      <div v-if="refs.length">
        <span class="muted">引用了</span>
        <button v-for="r in refs" :key="r" class="link ref" @click="desk.openScenario(r)">{{ idx.scenarios.get(r)?.name ?? r }}</button>
      </div>
      <div v-if="referencedBy.length">
        <span class="muted">被引用</span>
        <button v-for="o in referencedBy" :key="o.id" class="link ref" @click="desk.openScenario(o.id)">{{ o.name }}</button>
      </div>
    </Section>
    <footer class="src muted">出处：{{ desk.modelDir.value }}/{{ sc.src.file }}{{ sc.src.line ? `:${sc.src.line}` : '' }}</footer>
  </div>
</template>

<style scoped>
.notice {
  margin: 0 18px 8px;
  padding: 6px 10px;
  font-size: 12.5px;
  color: var(--warning);
  background: var(--warning-soft);
  border-radius: 6px;
}

.ref {
  margin-left: 8px;
}
</style>
