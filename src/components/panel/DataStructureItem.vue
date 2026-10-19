<script setup lang="ts">
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import CodeBlock from './CodeBlock.vue'
import Markdown from './Markdown.vue'

const props = defineProps<{ id: string; open?: boolean }>()
const desk = useDesk()
const x = computed(() => desk.index.value?.dataStructures.get(props.id))
</script>

<template>
  <details v-if="x" class="item" :open="open">
    <summary>
      <span class="name">{{ x.name }}</span>
      <code class="id">{{ x.id }}</code>
    </summary>
    <div class="body">
      <Markdown :text="x.description" />
      <CodeBlock v-if="x.definition" :code="x.definition" />
      <div v-if="x.invariants" class="sub">不变量</div>
      <Markdown :text="x.invariants" />
    </div>
  </details>
</template>
