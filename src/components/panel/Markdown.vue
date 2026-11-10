<script setup lang="ts">
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'

// html: false —— 描述来自 AI 生成的 YAML，不允许内嵌 HTML
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
const props = defineProps<{ text?: string }>()
const html = computed(() => (props.text ? md.render(props.text) : ''))
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- markdown-it 已禁用原始 HTML -->
  <div v-if="text" class="md" v-html="html" />
</template>

<style>
.md > :first-child {
  margin-top: 0;
}

.md > :last-child {
  margin-bottom: 0;
}

.md p,
.md ul,
.md ol {
  margin: 0.4em 0;
}

.md ul,
.md ol {
  padding-left: 1.4em;
}

.md code {
  background: var(--surface-2);
  padding: 0 4px;
  border-radius: 4px;
}

.md pre {
  background: var(--surface-2);
  padding: 8px 10px;
  border-radius: 6px;
  overflow-x: auto;
}

.md pre code {
  background: none;
  padding: 0;
}
</style>
