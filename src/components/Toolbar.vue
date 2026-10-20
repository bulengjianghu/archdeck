<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import { RELATION_TYPES, type ModuleEntity, type RelationType } from '@/model'

const desk = useDesk()
const query = ref('')
const open = ref(false)
const active = ref(0)

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
  return hits.sort((a, b) => a.score - b.score || a.m.seq - b.m.seq).slice(0, 12).map(h => h.m)
})

function pathLabel(m: ModuleEntity): string {
  const idx = desk.index.value!
  return (idx.pathOf.get(m.parentId) ?? []).slice(1).map(id => idx.modules.get(id)?.name ?? id).join(' / ') || idx.model.system.name
}

function pick(m: ModuleEntity) {
  desk.revealModule(m.id)
  query.value = ''
  open.value = false
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') active.value = Math.min(active.value + 1, results.value.length - 1)
  else if (e.key === 'ArrowUp') active.value = Math.max(active.value - 1, 0)
  else if (e.key === 'Enter' && results.value[active.value]) pick(results.value[active.value])
  else if (e.key === 'Escape') {
    query.value = ''
    ;(e.target as HTMLInputElement).blur()
  } else return
  e.preventDefault()
}

function toggleType(t: RelationType) {
  const list = desk.toggles.relationTypes
  desk.setToggles({ relationTypes: list.includes(t) ? list.filter(x => x !== t) : [...list, t] })
}
</script>

<template>
  <div class="toolbar">
    <div class="search">
      <input
        v-model="query"
        placeholder="搜索模块名或 ID"
        aria-label="搜索模块"
        @focus="open = true"
        @blur="open = false"
        @input="active = 0"
        @keydown="onKey"
      />
      <ul v-if="open && results.length" class="results">
        <li v-for="(m, i) in results" :key="m.id" :class="{ active: i === active }" @mousedown.prevent="pick(m)">
          <span class="name">{{ m.name }}</span>
          <span class="where">{{ pathLabel(m) }}</span>
        </li>
      </ul>
      <ul v-else-if="open && query.trim()" class="results"><li class="none">没有匹配的模块</li></ul>
    </div>

    <label class="check"><input v-model="desk.toggles.showBoundaries" type="checkbox" /> 边界节点</label>
    <label class="check"><input v-model="desk.toggles.currentOnly" type="checkbox" /> 只看现状</label>
    <div class="types" role="group" aria-label="关系类型筛选">
      <button
        v-for="t in RELATION_TYPES"
        :key="t"
        class="type rel-chip"
        :class="[`rel-${t}`, { off: !desk.toggles.relationTypes.includes(t) }]"
        :aria-pressed="desk.toggles.relationTypes.includes(t)"
        @click="toggleType(t)"
      >
        {{ t }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  flex: 1 1 auto;
  justify-content: flex-end;
  flex-wrap: wrap;
}

.search {
  position: relative;
}

.search input {
  width: 220px;
}

.results {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 20;
  width: 340px;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 6px 20px rgb(0 0 0 / 12%);
}

.results li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 8px;
  border-radius: 5px;
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

.check {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
}

.types {
  display: flex;
  gap: 2px;
}

.type {
  border: 1px solid transparent;
  background: none;
  padding: 1px 6px;
}

.type:hover {
  border-color: var(--border);
}

.type.off {
  opacity: 0.35;
}
</style>
