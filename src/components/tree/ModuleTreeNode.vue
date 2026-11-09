<script setup lang="ts">
/** 模块树的一行及其子树（递归）；只画，不改状态，意图交给 ModuleTree */
import { computed } from 'vue'
import { moduleName, stratumKey } from '@/model'
import type { ModuleTreeContext } from './types'

defineOptions({ name: 'ModuleTreeNode' })
const props = defineProps<{ id: string; depth: number; ctx: ModuleTreeContext }>()
const emit = defineEmits<{
  pick: [id: string]
  drill: [id: string]
  toggle: [id: string]
  hover: [id: string | null]
  menu: [id: string, ev: MouseEvent]
  stratum: [key: string]
}>()

const kids = computed(() => props.ctx.childrenOf(props.id))
const open = computed(() => props.ctx.expanded.has(props.id))
const mod = computed(() => props.ctx.index.modules.get(props.id))
/** ADR-0052：单成员层的成员就是层，标「层」；多成员层在父模块下作分组标题（ModuleTree） */
const stratum = computed(() => props.ctx.index.stratumOf.get(props.id))
const isRoot = computed(() => props.id === props.ctx.index.rootId)
/** ADR-0052：多成员层在它第一个可见成员之前起一行分组标题（不可下钻，单击选中层）；单成员层不另起标题 */
const heads = computed(() => {
  const out = new Map<string, { key: string; name: string; asks?: string }>()
  const seen = new Set<string>()
  for (const k of kids.value) {
    const s = props.ctx.index.stratumOf.get(k)
    if (!s || s.members.length < 2 || seen.has(s.id)) continue
    seen.add(s.id)
    out.set(k, { key: stratumKey(props.ctx.index, s), name: s.name, ...(s.asks ? { asks: s.asks } : {}) })
  }
  return out
})
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
        owner: ctx.fileOwners.has(id),
        part: ctx.participants.has(id),
        active: ctx.active.has(id),
        target: mod?.status === 'target',
        dimmed: ctx.participants.size > 0 && !isRoot && !ctx.participants.has(id),
      }"
      :title="`${name}（${id}）${kids.length ? '：双击下钻' : ''}`"
      @click="emit('pick', id)"
      @dblclick="emit('drill', id)"
      @mouseenter="emit('hover', id)"
      @contextmenu.prevent="emit('menu', id, $event)"
    >
      <button v-if="kids.length" class="caret" :aria-label="open ? '折叠' : '展开'" @click.stop="emit('toggle', id)" @dblclick.stop>
        {{ open ? '▾' : '▸' }}
      </button>
      <span v-else class="caret" />
      <span class="name">{{ name }}</span>
      <span v-if="stratum && stratum.members.length === 1" class="tag">层</span>
      <span v-if="ctx.levelId === id" class="tag here">当前层次</span>
      <span v-if="ctx.stale.has(id)" class="tag stale" title="确认过的内容变了（Z3）">需复核</span>
      <span v-else-if="ctx.reviewed.has(id)" class="tag reviewed" title="架构师已确认">✓</span>
      <span v-if="ctx.heatCount && !isRoot" class="heat muted">{{ ctx.heatCount(id) }}</span>
    </div>
    <ul v-if="kids.length && open" role="group">
      <template v-for="k in kids" :key="k">
        <li v-if="heads.get(k)" class="stratum-head" role="presentation" :title="heads.get(k)!.asks" @click="emit('stratum', heads.get(k)!.key)">
          <span class="name" :style="{ paddingLeft: `${(depth + 1) * 14 + 8}px` }">{{ heads.get(k)!.name }}</span>
        </li>
        <ModuleTreeNode
          :id="k"
          :depth="depth + 1"
          :ctx="ctx"
          @pick="i => emit('pick', i)"
          @drill="i => emit('drill', i)"
          @toggle="i => emit('toggle', i)"
          @hover="i => emit('hover', i)"
          @menu="(i, ev) => emit('menu', i, ev)"
          @stratum="x => emit('stratum', x)"
        />
      </template>
    </ul>
  </li>
</template>

<style scoped>
.stratum-head {
  font-size: 11px;
  color: var(--text-3);
  padding: 4px 8px 0 0;
  cursor: pointer;
  letter-spacing: 0.04em;
}
.stratum-head:hover {
  color: var(--text-2);
}
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

.heat {
  flex: none;
  margin-left: auto;
  font-size: 10.5px;
}

.tag.here {
  color: var(--accent);
  border-color: var(--accent);
}

.tag.stale {
  color: var(--warning);
  border-color: var(--warning);
}

.tag.reviewed {
  color: var(--diff-added);
  border-color: transparent;
  padding: 0 2px;
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

.owner {
  background: var(--accent-soft);
  border-left-color: var(--accent);
  border-left-style: dashed;
}

.owner > .name::after {
  content: ' · 文件归属';
  font-size: 10.5px;
  color: var(--accent);
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
