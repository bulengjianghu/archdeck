<script setup lang="ts">
/**
 * 表单的一个文本字段（X7g）：从获得焦点到失焦或回车是一次提交（原生 change 事件），即撤销的一步；击键不提交，值未变不提交，Esc 还原。
 * lines：逐行的列表（包含 / 不包含、代码落点），提交为数组。
 */
import { computed } from 'vue'

const props = defineProps<{
  label: string
  value: string | string[] | undefined
  multiline?: boolean
  lines?: boolean
  readonly?: boolean
  mono?: boolean
  name?: string
}>()
const emit = defineEmits<{ commit: [value: string | string[]] }>()
const text = computed(() => (Array.isArray(props.value) ? props.value.join('\n') : (props.value ?? '')))

function onChange(e: Event) {
  const v = (e.target as HTMLInputElement | HTMLTextAreaElement).value
  emit(
    'commit',
    props.lines
      ? v
          .split('\n')
          .map(x => x.trim())
          .filter(Boolean)
      : v,
  )
}
function onKey(e: KeyboardEvent) {
  const el = e.target as HTMLInputElement | HTMLTextAreaElement
  if (e.key === 'Escape') {
    el.value = text.value
    el.blur()
    e.stopPropagation()
  }
}
</script>

<template>
  <label class="field">
    <span class="label">{{ label }}</span>
    <textarea
      v-if="multiline || lines"
      :name="name"
      :value="text"
      :readonly="readonly"
      :class="{ mono }"
      :rows="lines ? 3 : 3"
      @change="onChange"
      @keydown="onKey"
    />
    <input v-else :name="name" :value="text" :readonly="readonly" :class="{ mono }" @change="onChange" @keydown="onKey" />
  </label>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
  font-size: 12.5px;
}

.label {
  color: var(--text-3);
}

input,
textarea {
  font: inherit;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface);
  color: var(--text);
  resize: vertical;
}

.mono {
  font-family: var(--mono);
}

[readonly] {
  background: var(--surface-2);
  color: var(--text-2);
}
</style>
