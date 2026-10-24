<script setup lang="ts">
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import CodeBlock from './CodeBlock.vue'
import Markdown from './Markdown.vue'
import ChangeBadge from './ChangeBadge.vue'
import DesignNote from './DesignNote.vue'

const props = defineProps<{ id: string; open?: boolean }>()
const desk = useDesk()
const x = computed(() => desk.index.value?.interfaces.get(props.id))
const owner = computed(() => (x.value?.owner ? desk.index.value?.modules.get(x.value.owner) : undefined))
/** K11、L13：算端口的接口可打开端口面板 */
const port = computed(() => desk.facts.portOf(props.id))
</script>

<template>
  <details v-if="x" class="item" :open="open">
    <summary>
      <span class="name">{{ x.name }}</span>
      <code class="id">{{ x.id }}</code>
      <ChangeBadge entity="interface" :id="x.id" detail />
      <button
        v-if="port?.isPort"
        class="badge port-link"
        title="打开端口面板：定义 · 实现者 · 使用者（K11）"
        @click.prevent.stop="desk.select({ kind: 'port', id: x.id })"
      >
        端口 · 实现者 {{ port.implementers.length }}
      </button>
    </summary>
    <div class="body">
      <DesignNote class="inline" :text="x.designNote" />
      <div v-if="owner" class="meta">
        提供方 <button class="link" @click="desk.revealModule(owner.id)">{{ owner.name }}</button>
      </div>
      <CodeBlock v-if="x.signature" :code="x.signature" />
      <Markdown :text="x.description" />
      <div v-if="x.semantics" class="sub">语义</div>
      <Markdown :text="x.semantics" />
    </div>
  </details>
</template>

<style scoped>
.port-link {
  white-space: nowrap;
  cursor: pointer;
}
</style>
