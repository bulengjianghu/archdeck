<script setup lang="ts">
/**
 * 场景面板（选中场景时，即进度在开头且没有选中其他对象，V2、R12）：说明、触发者与原因、场景所在层次（可跳转）、参与模块、ref 的引用与被引用、
 * 证据：先证据文件（S15、D-20：在源码清单里的可在副栏预览，不在的标出），后各步的证据等级计数（S16，有代码事实时）。步骤目录在导航树的步骤树里（T6）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'
import { useOpenPreview } from '../shared/preview'
import { EVIDENCE_LEVEL_LABELS } from '../shared/labels'
import Section from './Section.vue'
import Markdown from './Markdown.vue'
import DesignNote from './DesignNote.vue'

const desk = useDesk()
const openPreview = useOpenPreview()
/** 源码清单在本地时才能判断证据文件存不存在 */
const local = computed(() => desk.files.payload.value?.status === 'local')
const hasFile = (f: string) => {
  const p = desk.files.payload.value
  return p?.status === 'local' && p.files.includes(f)
}
const idx = computed(() => desk.index.value!)
const sc = computed(() => desk.run.scenario.value!)
const trigger = desk.run.trigger
const empty = computed(() => (desk.run.scenarioView.value?.messages.length ?? 0) === 0)

const participants = computed(() => {
  const plan = desk.run.plan.value
  return plan ? [...new Set([...plan.frames.values()].flatMap(f => [f.from, f.to]))] : []
})
const refs = desk.run.refs
const referencedBy = desk.run.referencedBy
/** S16：本场景各步的证据等级计数；没有代码事实时为 null */
const evCounts = computed(() => desk.evidence.scenario.value?.counts ?? null)
const EV_SHORT = { name: '按名字', module: '按依赖', none: '无证据', skipped: '不判定' } as const

function pointAt(id: string) {
  if (idx.value.actors.has(id)) desk.select({ kind: 'actor', id })
  else desk.revealModule(id)
}
</script>

<template>
  <div v-if="sc" class="scenario-panel">
    <header class="head">
      <div class="title">
        <h2>{{ sc.name }}</h2>
      </div>
      <div class="badges">
        <code>{{ sc.id }}</code>
        <span class="badge accent">场景</span>
      </div>
    </header>
    <DesignNote :text="sc.designNote" />
    <div v-if="empty" class="notice">
      本层看不到这个场景的任何一步。
      <button v-if="desk.run.home.value" class="link" @click="desk.goTo(desk.run.home.value)">
        跳到场景所在层次：{{ moduleName(idx, desk.run.home.value) }}
      </button>
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
    <Section v-if="sc.evidence?.length || evCounts" title="证据" :count="sc.evidence?.length">
      <ul v-if="sc.evidence?.length" class="plain evidence">
        <li v-for="f in sc.evidence" :key="f">
          <button v-if="hasFile(f)" class="link" :title="`在副栏预览 ${f}`" @click="openPreview(f)">{{ f }}</button>
          <template v-else>
            <code>{{ f }}</code>
            <span v-if="local" class="missing">不在源码清单中</span>
          </template>
        </li>
      </ul>
      <div v-if="evCounts" class="ev-counts">
        <span class="muted">各步</span>
        <span
          v-for="(l, i) in ['name', 'module', 'none', 'skipped'] as const"
          :key="l"
          :class="{ warn: l === 'none' && evCounts[l] > 0 }"
          :title="EVIDENCE_LEVEL_LABELS[l]"
          ><template v-if="i > 0"> · </template>{{ EV_SHORT[l] }} {{ evCounts[l] }}</span
        >
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

.ev-counts {
  margin-top: 4px;
  font-size: 12.5px;
}

.ev-counts .warn {
  color: var(--warning);
}

.evidence li {
  word-break: break-all;
}

.evidence code {
  font-size: 12px;
}

.missing {
  margin-left: 6px;
  font-size: 12px;
  color: var(--warning);
}
</style>
