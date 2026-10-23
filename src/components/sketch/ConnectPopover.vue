<script setup lang="ts">
/** 连线（F-21）：从连线柄拖到另一节点松手后弹出——类型（附一句读法）+ 一句说明；被拒绝（同对同类型、连自己、两端都是引用）时就地显示原因 */
import { nextTick, onMounted, ref } from 'vue'
import { RELATION_TYPES, type RelationType } from '@/model'
import { useDesk } from '@/state/inject'
import { RELATION_TYPE_HINTS, RELATION_TYPE_LABELS } from '../shared/labels'

const props = defineProps<{ from: string; to: string }>()
const emit = defineEmits<{ close: []; done: [] }>()
const desk = useDesk()
const type = ref<RelationType>('calls')
const description = ref('')
const error = ref('')
const desc = ref<HTMLInputElement | null>(null)
const name = (id: string) => desk.edit.nameOf(id) ?? id
onMounted(async () => {
  await nextTick()
  desc.value?.focus()
})

function submit() {
  const r = desk.edit.connect(props.from, props.to, type.value, description.value)
  if (!r.ok) return void (error.value = r.reason)
  emit('done')
}
</script>

<template>
  <div class="sk-dialog-mask" @click.self="emit('close')">
    <form class="sk-dialog" role="dialog" aria-label="新建关系" @submit.prevent="submit" @keydown.stop="e => e.key === 'Escape' && emit('close')">
      <h3>{{ name(from) }} → {{ name(to) }}</h3>
      <label>
        类型
        <select v-model="type" name="rel-type">
          <option v-for="t in RELATION_TYPES" :key="t" :value="t">{{ RELATION_TYPE_LABELS[t] }}（{{ t }}）</option>
        </select>
      </label>
      <p class="hint">{{ RELATION_TYPE_HINTS[type] }}</p>
      <label>说明（一句话） <input ref="desc" v-model="description" name="rel-description" /></label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" @click="emit('close')">取消</button>
        <button type="submit" class="ok">连上</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.sk-dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 45;
  display: grid;
  place-items: center;
  background: rgb(20 26 36 / 20%);
}

.sk-dialog {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 380px;
  padding: 12px 14px;
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: 0 8px 28px rgb(0 0 0 / 18%);
  font-size: 13px;
}

h3 {
  margin: 0;
  font-size: 13.5px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.hint,
.error {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
}

.error {
  color: var(--danger);
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
</style>
