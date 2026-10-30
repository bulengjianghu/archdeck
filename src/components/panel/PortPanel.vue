<script setup lang="ts">
/**
 * 端口面板（K11、L13；V15、PC-10，ADR-0053）：头部（名称、ID、端口徽标与实现者数）之下——
 * 理解：一句用途（说明首句，粗体）→ 说明与语义 → 端口三方（定义 · 实现者 · 使用者，PortEntry）；
 * 核对：实现者一行（描述写了、代码里未证实的实现者，K5c）。运行视角下理解卡首节为运行信息（V6）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import Section from './Section.vue'
import Markdown from './Markdown.vue'
import DesignNote from './DesignNote.vue'
import ChangeBadge from './ChangeBadge.vue'
import PortEntry from './PortEntry.vue'
import PanelCard from './PanelCard.vue'
import CheckCard from './CheckCard.vue'
import { firstSentence, moduleName } from '@/model'
import type { CheckRow } from './panelCheck'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const x = computed(() => desk.index.value?.interfaces.get(props.id))
const panel = computed(() => desk.facts.portOf(props.id))
const use = computed(() => (x.value?.description ? firstSentence(x.value.description) : ''))
const rows = computed<CheckRow[]>(() => {
  const p = panel.value
  if (!p || !p.implementers.length) return []
  if (!desk.facts.report.value) return [{ key: 'implementers', label: '实现者', state: 'none', text: '没有代码事实', items: [] }]
  const bad = p.implementers.filter(i => i.described && i.status === 'unconfirmed')
  return [
    {
      key: 'implementers',
      label: '实现者',
      state: bad.length ? 'bad' : 'ok',
      text: bad.length ? `${p.implementers.length} 个中 ${bad.length} 个未证实` : `${p.implementers.length} 个都有代码证据`,
      items: bad.map(i => ({ text: `${moduleName(desk.index.value!, i.module)}：描述写了实现，代码里没找到证据`, target: 'boundary.port' })),
    },
  ]
})
</script>

<template>
  <div v-if="x && panel" class="port-panel">
    <header class="head" data-sec="head">
      <h2>端口 {{ x.name }}</h2>
      <div class="badges">
        <code>{{ x.id }}</code>
        <span class="badge" :class="{ accent: panel.isPort }">{{ panel.isPort ? '端口' : '接口（不算端口）' }}</span>
        <span class="badge">实现者 {{ panel.implementers.length }}</span>
        <ChangeBadge entity="interface" :id="x.id" detail />
      </div>
    </header>
    <DesignNote :text="x.designNote" />
    <PanelCard kind="understand" title="理解" closed-summary :summary="use">
      <p v-if="use" class="use">{{ use }}</p>
      <!-- 先答做什么：说明在端口结构详情之前 -->
      <Section v-if="x.description || x.semantics" title="说明" data-sec="purpose">
        <Markdown :text="x.description" />
        <Markdown :text="x.semantics" />
      </Section>
      <Section title="端口（定义 · 实现者 · 使用者）" data-sec="boundary.port">
        <p v-if="!panel.isPort" class="muted">没有实现者，也没有经端口（via: port:）的使用者：只是对外能力，不算端口（T0 裁决 4）。</p>
        <PortEntry :panel="panel" />
      </Section>
    </PanelCard>
    <CheckCard v-if="rows.length" :rows="rows" />
    <footer class="src muted">出处：{{ desk.modelDir.value }}/{{ x.src.file }}{{ x.src.line ? `:${x.src.line}` : '' }}</footer>
  </div>
  <p v-else class="muted pad">端口「{{ id }}」在当前版本中已不存在。</p>
</template>

<style scoped>
.use {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
}

.pad {
  padding: 16px 18px;
}
</style>
