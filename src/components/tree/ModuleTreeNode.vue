<script setup lang="ts">
/** 模块树的一行及其子树（递归）；只画，不改状态，意图交给 ModuleTree */
import { computed } from 'vue'
import { moduleName } from '@/model'
import type { ModuleTreeContext } from './types'

defineOptions({ name: 'ModuleTreeNode' })
const props = defineProps<{ id: string; depth: number; ctx: ModuleTreeContext }>()
const emit = defineEmits<{ pick: [id: string]; drill: [id: string]; toggle: [id: string]; hover: [id: string | null] }>()

const kids = computed(() => props.ctx.childrenOf(props.id))
const open = computed(() => props.ctx.expanded.has(props.id))
const mod = computed(() => props.ctx.index.modules.get(props.id))
const isRoot = computed(() => props.id === props.ctx.index.rootId)
const name = computed(() => (isRoot.value ? props.ctx.index.model.system.name : moduleName(props.ctx.index, props.id)))
</script>

<template>
  <li role="treeitem" :aria-expanded="kids.length ? open : undefined" :aria-selected="ctx.selectedId === id">
    <div
      class="row"
      :data-id="id"
      :style="{ paddingLeft: `${8 + depth * 14}px` }"
      :class="{
        level: ctx.levelId === id,
        selected: ctx.selectedId === id,
        part: ctx.participants.has(id),
        active: ctx.active.has(id),
        target: mod?.status === 'target',
        dimmed: ctx.participants.size > 0 && !isRoot && !ctx.participants.has(id),
      }"
      :title="`${name}（${id}）${kids.length ? '：双击下钻' : ''}`"
      @click="emit('pick', id)"
      @dblclick="emit('drill', id)"
      @mouseenter="emit('hover', id)"
    >
      <button v-if="kids.length" class="caret" :aria-label="open ? '折叠' : '展开'" @click.stop="emit('toggle', id)" @dblclick.stop>
        {{ open ? '▾' : '▸' }}
      </button>
      <span v-else class="caret" />
      <span class="name">{{ name }}</span>
      <span v-if="mod?.kind === 'layer'" class="tag">层</span>
      <span v-if="ctx.levelId === id" class="tag here">当前层次</span>
    </div>
    <ul v-if="kids.length && open" role="group">
      <ModuleTreeNode
        v-for="k in kids"
        :id="k"
        :key="k"
        :depth="depth + 1"
        :ctx="ctx"
        @pick="i => emit('pick', i)"
        @drill="i => emit('drill', i)"
        @toggle="i => emit('toggle', i)"
        @hover="i => emit('hover', i)"
      />
    </ul>
  </li>
</template>

<style scoped>
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px 2px 8px;
  cursor: pointer;
  white-space: nowrap;
  border-left: 2px solid transparent;
}

.row:hover {
  background: var(--surface-2);
}

.caret {
  flex: none;
  width: 16px;
  padding: 0;
  border: none;
  background: none;
  color: var(--text-3);
  font-size: 11px;
  text-align: center;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.tag {
  flex: none;
  font-size: 10.5px;
  color: var(--text-3);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0 4px;
}

.tag.here {
  color: var(--accent);
  border-color: var(--accent);
}

.level > .name {
  font-weight: 600;
}

.selected {
  background: var(--accent-soft);
  border-left-color: var(--accent);
}

.target > .name {
  font-style: italic;
  color: var(--text-2);
  text-decoration: underline dashed var(--border-strong);
}

.dimmed {
  opacity: 0.5;
}

.part > .name::before {
  content: '●';
  margin-right: 4px;
  font-size: 8px;
  vertical-align: middle;
  color: var(--accent);
  opacity: 0.55;
}

.active > .name::before {
  opacity: 1;
}

.active > .name {
  color: var(--accent);
}
</style>
