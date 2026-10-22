<script setup lang="ts">
/** 编辑态的二次确认对话框（useEditDialog）：标题、影响清单、确认 / 取消；Esc 取消、回车确认 */
import { nextTick, ref, watch } from 'vue'
import { answer, editDialog } from './useEditDialog'

const okBtn = ref<HTMLButtonElement | null>(null)
watch(editDialog, async d => {
  if (!d) return
  await nextTick()
  okBtn.value?.focus()
})
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') answer(false)
  e.stopPropagation()
}
</script>

<template>
  <div v-if="editDialog" class="mask" role="dialog" aria-modal="true" :aria-label="editDialog.title" @keydown="onKey" @click.self="answer(false)">
    <div class="box">
      <h3>{{ editDialog.title }}</h3>
      <ul v-if="editDialog.lines.length">
        <li v-for="(l, i) in editDialog.lines" :key="i">{{ l }}</li>
      </ul>
      <div class="actions">
        <button @click="answer(false)">取消</button>
        <button ref="okBtn" class="ok" :class="{ danger: editDialog.danger }" @click="answer(true)">{{ editDialog.ok }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: rgb(20 26 36 / 28%);
}

.box {
  min-width: 320px;
  max-width: 520px;
  padding: 16px 18px;
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: 0 8px 28px rgb(0 0 0 / 18%);
}

h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

ul {
  margin: 0 0 12px;
  padding-left: 18px;
  font-size: 12.5px;
  color: var(--text-2);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.ok {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}

.ok.danger {
  border-color: var(--danger);
  background: var(--danger);
}
</style>
