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
/* CD-6：属性列里的设计说明自成一张卡（左边一道变更色）；嵌在条目里的（inline）仍是一段带色块 */
.design-note {
  padding: 10px 14px;
  border: 1px solid var(--card-border);
  border-left: 3px solid var(--diff-changed);
  background: var(--diff-changed-soft);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  font-size: 13px;
}

.design-note.inline {
  margin: 0;
  padding: 8px 12px;
  border: 0;
  border-left: 3px solid var(--diff-changed);
  border-radius: 0 6px 6px 0;
  box-shadow: none;
}

.label {
  font-size: 11px;
  font-weight: 600;
  color: var(--diff-changed);
  margin-bottom: 2px;
}
</style>
