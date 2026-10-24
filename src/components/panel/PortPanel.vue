<script setup lang="ts">
/** 端口面板（K11、L13）：选中端口（sel=p:<接口 ID>）时的面板——接口的说明，加定义 · 实现者 · 使用者（PortEntry） */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import Section from './Section.vue'
import Markdown from './Markdown.vue'
import DesignNote from './DesignNote.vue'
import ChangeBadge from './ChangeBadge.vue'
import PortEntry from './PortEntry.vue'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const x = computed(() => desk.index.value?.interfaces.get(props.id))
const panel = computed(() => desk.facts.portOf(props.id))
</script>

<template>
  <div v-if="x && panel" class="port-panel">
    <header class="head">
      <h2>端口 {{ x.name }}</h2>
      <div class="badges">
        <code>{{ x.id }}</code>
        <span class="badge" :class="{ accent: panel.isPort }">{{ panel.isPort ? '端口' : '接口（不算端口）' }}</span>
        <span class="badge">实现者 {{ panel.implementers.length }}</span>
        <ChangeBadge entity="interface" :id="x.id" detail />
      </div>
    </header>
    <DesignNote :text="x.designNote" />
    <Section title="端口（定义 · 实现者 · 使用者）">
      <p v-if="!panel.isPort" class="muted">没有实现者，也没有经端口（via: port:）的使用者：只是对外能力，不算端口（T0 裁决 4）。</p>
      <PortEntry :panel="panel" />
    </Section>
    <Section v-if="x.description || x.semantics" title="说明">
      <Markdown :text="x.description" />
      <Markdown :text="x.semantics" />
    </Section>
    <footer class="src muted">出处：{{ desk.modelDir.value }}/{{ x.src.file }}{{ x.src.line ? `:${x.src.line}` : '' }}</footer>
  </div>
  <p v-else class="muted pad">端口「{{ id }}」在当前版本中已不存在。</p>
</template>

<style scoped>
.pad {
  padding: 16px 18px;
}
</style>
