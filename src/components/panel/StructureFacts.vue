<script setup lang="ts">
/**
 * 子类与组装事实（K12、K13）：继承与组装不是关系，在面板「知识」行旁标「子类 N」「组装 N」，单击展开列表（两端、组装方式与文件证据）。
 * 关系面板、代码依赖面板（两端之间的）与模块面板（groups 分组给出）共用。
 */
import { ref } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName, type AssemblyFact, type SubclassFact } from '@/model'
import FileDepList from './FileDepList.vue'

export interface StructureGroup {
  key: string
  label: string
  title: string
  list: readonly (SubclassFact | AssemblyFact)[]
}
defineProps<{ groups: readonly StructureGroup[] }>()
const desk = useDesk()
const open = ref<string | null>(null)
const name = (id: string) => (desk.index.value ? moduleName(desk.index.value, id) : id)
const KIND: Record<string, string> = { new: 'new', factory: '工厂', register: '注册' }
const kinds = (f: SubclassFact | AssemblyFact) => ('kinds' in f ? f.kinds.map(k => KIND[k] ?? k).join(' · ') : 'extends')
</script>

<template>
  <span class="structure-facts">
    <template v-for="g in groups" :key="g.key">
      <button
        v-if="g.list.length"
        class="badge fact-badge"
        :class="{ on: open === g.key }"
        :title="g.title"
        :aria-expanded="open === g.key"
        @click="open = open === g.key ? null : g.key"
      >
        {{ g.label }} {{ g.list.length }}
      </button>
    </template>
    <template v-for="g in groups" :key="`l:${g.key}`">
      <ul v-if="open === g.key" class="plain fact-list" :aria-label="g.label">
        <li v-for="f in g.list" :key="f.key">
          <button class="link" @click="desk.revealModule(f.from)">{{ name(f.from) }}</button> →
          <button class="link" @click="desk.revealModule(f.to)">{{ name(f.to) }}</button>
          <span class="muted small">{{ kinds(f) }} · {{ f.files.length }} 处</span>
          <FileDepList :deps="f.files" :limit="3" />
        </li>
      </ul>
    </template>
  </span>
</template>

<style scoped>
.fact-badge {
  margin-left: 6px;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
}

.fact-badge.on {
  border-color: var(--accent);
  color: var(--accent);
}

.fact-list {
  display: block;
  margin: 4px 0 0;
}

.small {
  font-size: 11px;
}
</style>
