<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { highlightTs } from './highlight'

const props = defineProps<{ code: string }>()
const html = ref<string>()

watchEffect(async () => {
  const code = props.code.trimEnd()
  html.value = undefined
  try {
    const out = await highlightTs(code)
    if (code === props.code.trimEnd()) html.value = out
  } catch {
    /* 高亮失败时保留纯文本 */
  }
})
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- shiki 输出，已转义源码 -->
  <div v-if="html" class="code" v-html="html" />
  <pre v-else class="code plain">{{ code.trimEnd() }}</pre>
</template>

<style>
.code pre,
.code.plain {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  overflow-x: auto;
  background: var(--surface-2) !important;
  border: 1px solid var(--border);
  font-size: 12.5px;
  line-height: 1.55;
}

@media (prefers-color-scheme: dark) {
  .code .shiki,
  .code .shiki span {
    color: var(--shiki-dark) !important;
  }
}
</style>
