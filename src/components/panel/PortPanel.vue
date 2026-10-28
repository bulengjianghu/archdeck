<script setup lang="ts">
/**
 * 端口面板（K11、L13；G11 五段骨架，ADR-0050、V15）：① 头部（名称、ID、端口徽标与实现者数）
 * ② 作用：说明（接口的 description 与 semantics）④ 边界：端口（定义 · 实现者 · 使用者，PortEntry）⑤ 出处 footer 常显在最底。
 * 「先答做什么」：说明在端口结构详情之前（G11 铺开修正——原先后说明于结构后）。
 */
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
    <!-- ② 作用：先答做什么——说明在端口结构详情之前（V15 铺开） -->
    <Section v-if="x.description || x.semantics" title="说明" data-sec="purpose">
      <Markdown :text="x.description" />
      <Markdown :text="x.semantics" />
    </Section>
    <!-- ④ 边界 -->
    <Section title="端口（定义 · 实现者 · 使用者）" data-sec="boundary.port">
      <p v-if="!panel.isPort" class="muted">没有实现者，也没有经端口（via: port:）的使用者：只是对外能力，不算端口（T0 裁决 4）。</p>
      <PortEntry :panel="panel" />
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
