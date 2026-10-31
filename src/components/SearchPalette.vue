<script setup lang="ts">
/**
 * 搜索面板（TB-4、N4）：工具栏的 ⌕ 或 ⌘K（Ctrl+K）打开，在工具栏中央下拉；结果写法（名称 · 所在路径，最多 12 条）与键盘
 * （↑ ↓ 选择、Enter 跳转）沿用原搜索框。选中结果、Esc、单击面板外都关闭。开关由项目视图持有（v-model:open）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDesk } from '@/state/inject'
import type { ModuleEntity } from '@/model'

const open = defineModel<boolean>('open', { required: true })
const desk = useDesk()
const query = ref('')
const active = ref(0)
const root = ref<HTMLElement>()
const input = ref<HTMLInputElement>()

const results = computed<ModuleEntity[]>(() => {
  const q = query.value.trim().toLowerCase()
  const idx = desk.index.value
  if (!q || !idx) return []
  const hits: { m: ModuleEntity; score: number }[] = []
  for (const m of idx.modules.values()) {
    const name = m.name.toLowerCase()
    const id = m.id.toLowerCase()
    const score = name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : id.includes(q) ? 3 : -1
    if (score >= 0) hits.push({ m, score })
  }
  return hits
    .sort((a, b) => a.score - b.score || a.m.seq - b.m.seq)
    .slice(0, 12)
    .map(h => h.m)
})

function pathLabel(m: ModuleEntity): string {
  const idx = desk.index.value!
  return (
    (idx.pathOf.get(m.parentId) ?? [])
      .slice(1)
      .map(id => idx.modules.get(id)?.name ?? id)
      .join(' / ') || idx.model.system.name
  )
}

function close() {
  open.value = false
  query.value = ''
  active.value = 0
}

function pick(m: ModuleEntity) {
  desk.revealModule(m.id)
  close()
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') active.value = Math.min(active.value + 1, results.value.length - 1)
  else if (e.key === 'ArrowUp') active.value = Math.max(active.value - 1, 0)
  else if (e.key === 'Enter' && results.value[active.value]) pick(results.value[active.value])
  else if (e.key === 'Escape') close()
  else return
  e.preventDefault()
  e.stopPropagation()
}

watch(open, o => o && void nextTick(() => input.value?.focus()), { immediate: true })
const onDoc = (e: MouseEvent) => {
  if (open.value && root.value && !root.value.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-search-toggle]')) close()
}
onMounted(() => document.addEventListener('mousedown', onDoc))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDoc))
</script>

<template>
  <div v-if="open" ref="root" class="search-palette" role="dialog" aria-label="搜索模块">
    <input ref="input" v-model="query" placeholder="搜索模块名或 ID（⌘K）" aria-label="搜索模块" @input="active = 0" @keydown="onKey" />
    <ul v-if="results.length" class="results">
      <li v-for="(m, i) in results" :key="m.id" :class="{ active: i === active }" @mousedown.prevent="pick(m)">
        <span class="name">{{ m.name }}</span>
        <span class="where">{{ pathLabel(m) }}</span>
      </li>
    </ul>
    <ul v-else-if="query.trim()" class="results">
      <li class="none">没有匹配的模块</li>
    </ul>
  </div>
</template>

<style scoped>
.search-palette {
  position: absolute;
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  width: min(440px, calc(100% - 24px));
  padding: 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgb(0 0 0 / 14%);
}

input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
}

.results {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
  max-height: 60vh;
  overflow: auto;
}

.results li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
}

.results li.active,
.results li:hover {
  background: var(--accent-soft);
}

.results .where {
  color: var(--text-3);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.results .none {
  color: var(--text-3);
  cursor: default;
}
</style>
