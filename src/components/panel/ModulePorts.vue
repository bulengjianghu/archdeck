<script setup lang="ts">
/**
 * 模块面板 · 端口（K11，原端口三角）：模块声明的接口中算端口的（被 via: port: 引用或有实现者），逐个列出定义 · 实现者 · 使用者；
 * 结构视角下端口类表面元素与「表面」一节互相定位（C7、L20③）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import Section from './Section.vue'
import PortEntry from './PortEntry.vue'
import { focusSurfaceElement } from './surfaceFocus'

const props = defineProps<{ id: string; /** PC-8：核对卡的清单缺省折叠 */ fold?: boolean }>()
const desk = useDesk()
const ports = computed(() => desk.facts.portsOf(props.id))
/** 端口 → 表面上对应的端口元素（只在结构视角） */
const elementOf = computed(() => {
  const out = new Map<string, string>()
  if (desk.viewpoint.value !== 'structure') return out
  for (const e of desk.facts.surfaceOf(props.id)?.elements ?? []) if (e.kind === 'port' && e.interfaceId) out.set(e.interfaceId, e.name)
  return out
})
</script>

<template>
  <Section v-if="ports.length" title="端口（定义 · 实现者 · 使用者）" :count="ports.length" :fold="fold">
    <div v-for="p in ports" :key="p.port" class="entry">
      <button
        v-if="elementOf.get(p.port)"
        class="link to-surface"
        title="定位到「表面」一节的这个元素"
        @click="focusSurfaceElement(id, elementOf.get(p.port)!)"
      >
        表面元素 ↑
      </button>
      <PortEntry :panel="p" titled />
    </div>
  </Section>
</template>

<style scoped>
.entry + .entry {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}

.to-surface {
  float: right;
  font-size: 12px;
}

.entry :deep(.port-entry.flash) {
  animation: flash 1.2s ease-out;
}

@keyframes flash {
  from {
    background: var(--accent-soft);
  }
}
</style>
