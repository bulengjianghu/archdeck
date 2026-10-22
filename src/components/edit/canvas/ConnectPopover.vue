<script setup lang="ts">
/** 连线（C-8）：从节点拖出到另一节点，松手后选类型与一句说明（附 ADR-0022 的读法），确定后发 connect；被拒绝时就地提示原因 */
import { ref } from 'vue'
import { RELATION_TYPES, type RelationType } from '@/model'
import { RELATION_TYPE_HINTS, RELATION_TYPE_LABELS } from '../../shared/labels'
import { useDesk } from '@/state/inject'

const props = defineProps<{ from: string; to: string }>()
const emit = defineEmits<{ close: [] }>()
const desk = useDesk()
const type = ref<RelationType>('calls')
const description = ref('')
const error = ref('')
const name = (id: string) => desk.index.value?.modules.get(id)?.name ?? id

function ok() {
  const r = desk.edit.edit({
    op: 'connect',
    from: props.from,
    to: props.to,
    type: type.value,
    ...(description.value.trim() ? { description: description.value.trim() } : {}),
  })
  if (r.ok) emit('close')
  else error.value = r.reason
}
</script>

<template>
  <form class="connect" role="dialog" aria-label="新建关系" @submit.prevent="ok" @keydown.esc.stop="emit('close')" @keydown.stop>
    <strong>{{ name(from) }} → {{ name(to) }}</strong>
    <label v-for="t in RELATION_TYPES" :key="t" class="type" :title="RELATION_TYPE_HINTS[t]">
      <input v-model="type" type="radio" name="rel-type" :value="t" /> {{ RELATION_TYPE_LABELS[t] }} <small>{{ RELATION_TYPE_HINTS[t] }}</small>
    </label>
    <input v-model="description" name="rel-description" placeholder="一句说明（可选）" aria-label="说明" />
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="actions">
      <button type="button" @click="emit('close')">取消</button>
      <button type="submit" class="ok">连上</button>
    </div>
  </form>
</template>

<style scoped>
.connect {
  position: absolute;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 340px;
  padding: 12px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 6px 20px rgb(0 0 0 / 14%);
  font-size: 12.5px;
}

.type small {
  color: var(--text-3);
}

.error {
  margin: 0;
  color: var(--danger);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.ok {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
</style>
