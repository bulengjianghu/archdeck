<script setup lang="ts">
/** 设计说明（designNote）：为什么这样设计 / 调整，只出现在设计版本里 */
import Markdown from './Markdown.vue'

defineProps<{ text?: string }>()
</script>

<template>
  <div v-if="text" class="design-note">
    <div class="label">设计说明</div>
    <Markdown :text="text" />
  </div>
</template>

<style scoped>
.design-note {
  margin: 10px 18px 2px;
  padding: 8px 12px;
  border-left: 3px solid var(--diff-changed);
  background: var(--diff-changed-soft);
  border-radius: 0 6px 6px 0;
  font-size: 13px;
}

.design-note.inline {
  margin: 0;
}

.label {
  font-size: 11px;
  font-weight: 600;
  color: var(--diff-changed);
  margin-bottom: 2px;
}
</style>
