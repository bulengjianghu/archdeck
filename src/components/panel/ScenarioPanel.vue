<script setup lang="ts">
/**
 * 场景面板（焦点跟随但尚未开始时）：说明、触发者与原因、场景所在层次（可跳转）、参与模块、
 * 步骤目录（按组合框缩进，单击指向该步）、ref 的引用与被引用。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { forEachStep, linearize, moduleName, triggerOf, type FragmentTag } from '@/model'
import Section from './Section.vue'
import Markdown from './Markdown.vue'
import DesignNote from './DesignNote.vue'
import { fragmentText, frameText } from './runText'

const desk = useDesk()
const idx = computed(() => desk.index.value!)
const sc = computed(() => desk.scenario.value!)
const trigger = computed(() => triggerOf(idx.value, sc.value.id))
const empty = computed(() => (desk.scenarioView.value?.messages.length ?? 0) === 0)

/** 步骤目录：计划全貌按书写顺序，组合框变化处插入标题 */
const toc = computed(() => {
  const plan = desk.plan.value
  if (!plan) return []
  const rows: ({ kind: 'head'; depth: number; text: string } | { kind: 'frame'; depth: number; id: string; text: string; status: string })[] = []
  let prev: FragmentTag[] = []
  for (const e of linearize(plan, desk.playback.value?.choices ?? new Map(), 'display')) {
    if (e.kind !== 'frame') continue
    const tags = e.frame.fragments
    let same = 0
    while (same < tags.length && same < prev.length && tags[same].id === prev[same].id && tags[same].branch === prev[same].branch) same++
    for (let d = same; d < tags.length; d++) rows.push({ kind: 'head', depth: d, text: fragmentText(tags[d]) })
    rows.push({ kind: 'frame', depth: tags.length, id: e.frame.id, text: frameText(idx.value, e.frame), status: e.status })
    prev = tags
  }
  return rows
})

const participants = computed(() => {
  const plan = desk.plan.value
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
      <button v-if="desk.home.value" class="link" @click="desk.goTo(desk.home.value)">跳到场景所在层次：{{ moduleName(idx, desk.home.value) }}</button>
    </div>
    <Section v-if="sc.description" title="说明"><Markdown :text="sc.description" /></Section>
    <Section title="触发">
      <div>
        <span class="muted">触发者</span>
        <button v-if="trigger" class="link" @click="pointAt(trigger)">{{ moduleName(idx, trigger) }}</button>
        <span v-else class="muted">—</span>
      </div>
      <div v-if="sc.cause"><span class="muted">原因</span> {{ sc.cause }}</div>
      <div v-if="desk.home.value">
        <span class="muted">所在层次</span>
        <button class="link" @click="desk.goTo(desk.home.value)">{{ moduleName(idx, desk.home.value) }}</button>
      </div>
    </Section>
    <Section title="步骤目录" :count="desk.plan.value?.frames.size">
      <ol class="toc">
        <li v-for="(r, i) in toc" :key="i" :style="{ paddingLeft: `${r.depth * 14}px` }" :class="[r.kind, r.kind === 'frame' ? r.status : '']">
          <span v-if="r.kind === 'head'" class="head-text">{{ r.text }}</span>
          <button v-else class="link" :class="{ current: r.id === desk.playback.value?.frameId }" @click="desk.seek(r.id)">{{ r.text }}</button>
        </li>
      </ol>
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

.toc {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 12.5px;
}

.toc li {
  padding: 1px 0;
}

.toc .head-text {
  color: var(--text-3);
  font-size: 11.5px;
}

.toc .unchosen,
.toc .unreached {
  opacity: 0.45;
}

.toc .current {
  font-weight: 700;
}

.ref {
  margin-left: 8px;
}
</style>
