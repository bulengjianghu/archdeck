<script setup lang="ts">
/** 模块面板 · 端口（K11，原端口三角）：模块声明的接口中算端口的（被 via: port: 引用或有实现者），逐个列出定义 · 实现者 · 使用者 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import Section from './Section.vue'
import PortEntry from './PortEntry.vue'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const ports = computed(() => desk.facts.portsOf(props.id))
</script>

<template>
  <Section v-if="ports.length" title="端口（定义 · 实现者 · 使用者）" :count="ports.length">
    <PortEntry v-for="p in ports" :key="p.port" :panel="p" titled class="entry" />
  </Section>
</template>

<style scoped>
.entry + .entry {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}
</style>
