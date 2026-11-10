<script setup lang="ts">
/** 引用外部模块（F-28）：搜索当前版本的模块，点一项把它作为引用节点放上画布（待连端点；保存时没有关系的丢弃并提示） */
import { computed, nextTick, onMounted, ref } from 'vue'
import { useDesk } from '@/state/inject'

const emit = defineEmits<{ close: []; notice: [text: string] }>()
const desk = useDesk()
const q = ref('')
const input = ref<HTMLInputElement | null>(null)
onMounted(async () => {
  await nextTick()
  input.value?.focus()
})
const hits = computed(() => {
  const k = q.value.trim().toLowerCase()
  const all = desk.edit.referenceCandidates.value
  return (k ? all.filter(m => m.id.toLowerCase().includes(k) || m.name.toLowerCase().includes(k)) : all).slice(0, 30)
})
function pick(id: string) {
  const r = desk.edit.addReference(id)
  if (!r.ok) return emit('notice', r.reason)
  emit('notice', '已放上画布：从连线柄连一条关系，否则保存时丢弃')
  emit('close')
}
</script>

<template>
  <div class="sk-picker" role="dialog" aria-label="引用外部模块" @keydown.stop="e => e.key === 'Escape' && emit('close')">
    <input ref="input" v-model="q" name="ref-search" placeholder="搜索当前版本的模块（名称或 ID）" />
    <ul>
      <li v-for="m in hits" :key="m.id">
        <button @click="pick(m.id)">
          <strong>{{ m.name }}</strong>
          <code>{{ m.id }}</code>
          <span v-if="m.path.length" class="path">{{ m.path.join(' › ') }}</span>
        </button>
      </li>
      <li v-if="!hits.length" class="none">没有匹配的模块</li>
    </ul>
    <button class="close" @click="emit('close')">关闭</button>
  </div>
</template>

<style scoped>
.sk-picker {
  position: absolute;
  top: 44px;
  right: 12px;
  z-index: 20;
  width: 340px;
  max-height: 60%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgb(0 0 0 / 15%);
}

ul {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
}

li button {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  text-align: left;
  border: none;
  background: none;
  padding: 4px 6px;
  font-size: 12.5px;
  border-radius: 5px;
}

li button:hover {
  background: var(--accent-soft);
}

code {
  font-size: 11px;
  color: var(--text-3);
}

.path {
  width: 100%;
  font-size: 11px;
  color: var(--text-3);
}

.none {
  padding: 6px;
  color: var(--text-3);
  font-size: 12px;
}

.close {
  align-self: flex-end;
  font-size: 12px;
}
</style>
