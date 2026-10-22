<script setup lang="ts">
/** 就地输入名称（C-1、C-4）：ID 显示为由名称生成的值、可改；回车提交，Esc 放弃 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { useDesk } from '@/state/inject'

const props = defineProps<{ parent?: string; placeholder: string }>()
const desk = useDesk()
const emit = defineEmits<{ submit: [name: string, id: string]; cancel: [] }>()
const name = ref('')
const id = ref('')
const idEdited = ref(false)
const auto = computed(() => (name.value.trim() ? desk.edit.lookup.previewId(props.parent, name.value) : ''))
const input = ref<HTMLInputElement | null>(null)
onMounted(async () => {
  await nextTick()
  input.value?.focus()
})
function onKey(e: KeyboardEvent) {
  e.stopPropagation()
  if (e.key === 'Escape') emit('cancel')
  if (e.key === 'Enter' && name.value.trim()) emit('submit', name.value.trim(), (idEdited.value ? id.value : auto.value).trim())
}
</script>

<template>
  <span class="inline-name nodrag nopan" @keydown="onKey" @click.stop @dblclick.stop>
    <input ref="input" v-model="name" class="name" :placeholder="placeholder" aria-label="名称" />
    <input
      :value="idEdited ? id : auto"
      class="id"
      placeholder="ID"
      aria-label="ID"
      @input="
        e => {
          idEdited = true
          id = (e.target as HTMLInputElement).value
        }
      "
    />
  </span>
</template>

<style scoped>
.inline-name {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: 6px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 12%);
}

.inline-name input {
  font-size: 12px;
  padding: 2px 4px;
}

.name {
  width: 120px;
}

.id {
  width: 150px;
  font-family: var(--mono);
  color: var(--text-2);
}
</style>
