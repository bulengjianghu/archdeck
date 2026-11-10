<script setup lang="ts">
/**
 * 写入人拥有的文件的小表单（B1–B5，ADR-0019）：先收起为一个按钮，展开后填一段文字提交；
 * 成功后显示写进了哪个文件（页面随文件变化自动刷新，N5），失败显示原因。
 */
import { ref } from 'vue'
import type { WriteOutcome } from '@/state/useDeskState'

const props = defineProps<{
  /** 收起时按钮上的字，如「加例外」 */
  label: string
  placeholder?: string
  /** 展开时的初值 */
  initial?: string
  multiline?: boolean
  /** 一键填入的候选（如忽略整个目录） */
  presets?: { label: string; value: string }[]
  submit: (text: string) => Promise<WriteOutcome>
}>()

const open = ref(false)
const text = ref(props.initial ?? '')
const busy = ref(false)
const result = ref<WriteOutcome | null>(null)

async function onSubmit() {
  if (!text.value.trim() || busy.value) return
  busy.value = true
  result.value = await props.submit(text.value)
  busy.value = false
  if (result.value.ok) {
    open.value = false
    text.value = props.initial ?? ''
  }
}
</script>

<template>
  <div class="write-form">
    <button v-if="!open" class="link" @click="open = true">{{ label }}</button>
    <form v-else @submit.prevent="onSubmit">
      <textarea v-if="multiline" v-model="text" :placeholder="placeholder" rows="3" :aria-label="label" />
      <input v-else v-model="text" :placeholder="placeholder" :aria-label="label" />
      <div class="row">
        <button v-for="p in presets ?? []" :key="p.value" type="button" class="preset" @click="text = p.value">{{ p.label }}</button>
        <span class="spacer" />
        <button type="button" @click="open = false">取消</button>
        <button type="submit" class="primary" :disabled="busy || !text.trim()">{{ busy ? '写入中…' : '写入' }}</button>
      </div>
    </form>
    <p v-if="result?.ok" class="ok">
      已写入 <code>{{ result.file }}</code
      >，页面随之刷新。
    </p>
    <p v-else-if="result" class="err">{{ result.error }}</p>
  </div>
</template>

<style scoped>
.write-form {
  margin-top: 4px;
  font-size: 12px;
}

form {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

textarea,
input {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.row button {
  font-size: 11.5px;
  padding: 1px 8px;
}

.spacer {
  flex: 1;
}

.primary {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.ok {
  margin: 4px 0 0;
  color: var(--diff-added);
}

.err {
  margin: 4px 0 0;
  color: var(--danger);
}

code {
  word-break: break-all;
}
</style>
