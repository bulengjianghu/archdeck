<script setup lang="ts">
/**
 * 步骤面板（D-5，焦点跟随当前步骤时）：类型、序号、所在组合框与分支条件；真实端点与本层投影；
 * 本层一条可见消息覆盖多帧时列出这些帧；接口、数据结构；对应关系（推断时标「推断」）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'
import Section from './Section.vue'
import Markdown from './Markdown.vue'
import InterfaceItem from './InterfaceItem.vue'
import DataStructureItem from './DataStructureItem.vue'
import RelationRow from './RelationRow.vue'
import { KIND_LABEL, fragmentText, frameText, landingText } from './runText'

const desk = useDesk()
const idx = computed(() => desk.index.value!)
const f = computed(() => desk.frame.value!)
const msg = computed(() => {
  const ci = desk.currentIndex.value
  return ci === null ? null : (desk.scenarioView.value?.messages[ci] ?? null)
})
const total = computed(() => desk.scenarioView.value?.messages.length ?? 0)
const writtenIn = computed(() => (f.value.scenarioId !== desk.scenario.value?.id ? idx.value.scenarios.get(f.value.scenarioId)?.name : undefined))

function pointAt(id: string) {
  if (idx.value.actors.has(id)) desk.select({ kind: 'actor', id })
  else desk.revealModule(id)
}
</script>

<template>
  <div v-if="f" class="step-panel">
    <header class="head">
      <div class="badges top">
        <span class="badge accent">当前步骤</span>
        <span v-if="msg" class="muted">第 {{ msg.index + 1 }} / {{ total }} 步（本层）</span>
        <span v-else class="badge warn">本层不可见</span>
      </div>
      <h2>{{ f.label || frameText(idx, f) }}</h2>
      <div class="badges">
        <span class="badge">{{ KIND_LABEL[f.kind] }}</span>
        <span v-for="(t, i) in f.fragments" :key="i" class="badge">{{ fragmentText(t) }}</span>
      </div>
    </header>

    <Section title="真实端点">
      <div class="ends">
        <button class="link" @click="pointAt(f.from)">{{ moduleName(idx, f.from) }}</button>
        <span class="muted">→</span>
        <button class="link" @click="pointAt(f.to)">{{ moduleName(idx, f.to) }}</button>
      </div>
      <div v-if="msg" class="sub muted">在本层：{{ landingText(idx, msg.at) }}</div>
      <div v-else class="sub muted">
        两端都在本层之外。<button class="link" @click="desk.goTo(desk.frameLevel.value!)">到能看到它的层次</button>
      </div>
    </Section>

    <Section v-if="msg && msg.frameIds.length > 1" title="本层这一步覆盖的帧" :count="msg.frameIds.length">
      <ol class="frames">
        <li v-for="id in msg.frameIds" :key="id" :class="{ current: id === f.id }">
          <button class="link" @click="desk.seek(id)">{{ frameText(idx, desk.plan.value!.frames.get(id)!) }}</button>
        </li>
      </ol>
      <p class="muted hint">下钻可以看到更细的步骤。</p>
    </Section>

    <Section title="对应关系">
      <ul v-if="f.relation" class="plain">
        <RelationRow :id="f.relation" />
        <li v-if="f.relationInferred" class="muted inferred"><span class="badge warn">推断</span> 描述中没写 relation，两端之间恰好一条运行时关系，自动认定</li>
      </ul>
      <p v-else class="muted">结构中没有与这一步对应的关系</p>
    </Section>

    <Section v-if="f.interface" title="经由接口"><InterfaceItem :id="f.interface" open /></Section>
    <Section v-if="f.payload.length" title="携带的数据" :count="f.payload.length">
      <DataStructureItem v-for="d in f.payload" :key="d" :id="d" />
    </Section>
    <Section v-if="f.note" title="说明"><Markdown :text="f.note" /></Section>

    <footer class="src muted">
      <template v-if="writtenIn">写在场景「{{ writtenIn }}」中 · </template>
      出处：{{ desk.modelDir.value }}/{{ f.src.file }}{{ f.src.line ? `:${f.src.line}` : '' }} · <code>{{ f.id }}</code>
    </footer>
  </div>
</template>

<style scoped>
.top {
  margin: 0 0 6px;
}

.ends {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 14px;
}

.sub {
  font-size: 12.5px;
  margin-top: 4px;
}

.frames {
  margin: 0;
  padding-left: 1.4em;
  font-size: 13px;
}

.frames li.current {
  font-weight: 600;
}

.hint {
  margin: 4px 0 0;
  font-size: 12px;
}

.inferred {
  font-size: 12px;
  padding-top: 2px;
}
</style>
