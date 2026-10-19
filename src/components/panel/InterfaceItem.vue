<script setup lang="ts">
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import CodeBlock from './CodeBlock.vue'
import Markdown from './Markdown.vue'

const props = defineProps<{ id: string; open?: boolean }>()
const desk = useDesk()
const x = computed(() => desk.index.value?.interfaces.get(props.id))
const owner = computed(() => (x.value?.owner ? desk.index.value?.modules.get(x.value.owner) : undefined))
</script>

<template>
  <details v-if="x" class="item" :open="open">
    <summary>
      <span class="name">{{ x.name }}</span>
      <code class="id">{{ x.id }}</code>
    </summary>
    <div class="body">
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
