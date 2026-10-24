<script setup lang="ts">
/**
 * 草图下的导航树（present.sketch，原型任务说明 3）：只列本张草图的模块与引用（根草图里层下列第二级）；
 * 单击选中、与画布同步；双击下钻；⇧ 单击多选（合并的输入）。顶部不再列「本张草图 · 路径」：面包屑只在信息条身份区（#15）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'

const desk = useDesk()
const e = desk.edit
const items = computed(() => {
  const s = e.scene.value
  if (!s) return []
  const layerOf = (id: string) => (s.nodes.find(n => n.id === id.split('.')[0])?.data.kind === 'layer' && id.includes('.') ? 1 : 0)
  return s.nodes.map(n => ({ id: n.id, name: n.data.name, kind: n.data.kind, depth: n.data.kind === 'reference' ? 0 : layerOf(n.id), deeper: !!n.data.deeper }))
})
const selectedId = computed(() => {
  const s = desk.selection.value
  return s?.kind === 'module' ? s.id : null
})
function click(id: string, ev: MouseEvent) {
  if (ev.shiftKey) {
    const set = new Set([...e.picked.value, ...(selectedId.value ? [selectedId.value] : [])])
    if (set.has(id)) set.delete(id)
    else set.add(id)
    e.pick([...set])
  } else e.pick([])
  desk.select({ kind: 'module', id })
}
function open(id: string, kind: string) {
  if (kind === 'module') e.openChild(id)
}
</script>

<template>
  <div class="sk-tree" data-testid="sketch-tree">
    <ul>
      <li
        v-for="it in items.filter(x => x.kind !== 'reference')"
        :key="it.id"
        :class="[it.kind, { on: selectedId === it.id || e.picked.value.includes(it.id) }]"
        :style="{ paddingLeft: `${12 + it.depth * 14}px` }"
        :title="it.id"
        @click="click(it.id, $event)"
        @dblclick="open(it.id, it.kind)"
      >
        {{ it.name }}<span v-if="it.deeper" class="deeper">›</span>
      </li>
    </ul>
    <template v-if="items.some(x => x.kind === 'reference')">
      <p class="head">引用（外部模块）</p>
      <ul>
        <li
          v-for="it in items.filter(x => x.kind === 'reference')"
          :key="it.id"
          class="reference"
          :class="{ on: selectedId === it.id }"
          :title="it.id"
          @click="click(it.id, $event)"
        >
          {{ it.name }}
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.head {
  margin: 8px 12px 4px;
  font-size: 11.5px;
  color: var(--text-3);
}

ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

li {
  padding: 3px 12px;
  cursor: pointer;
  user-select: none;
}

li:hover {
  background: var(--surface-2);
}

li.on {
  background: var(--accent-soft);
  color: var(--accent);
}

li.layer {
  font-weight: 600;
}

li.reference {
  color: var(--text-2);
  font-style: italic;
}

.deeper {
  margin-left: 4px;
  color: var(--text-3);
}
</style>
