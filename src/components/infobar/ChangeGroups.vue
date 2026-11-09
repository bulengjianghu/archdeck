<script setup lang="ts">
/**
 * 全设计的变更清单（F-53）：按血缘分组——新增 / 修改 / 合并 / 拆分 / 移动 / 改 ID / 删除，待重连另列；各张草图的条目并在一起，
 * 设计有多张草图时每条标出所在的草图。数据来自 desk.edit 的对比结果（随对比口径）。
 */
import { computed } from 'vue'
import type { CompareView } from '@/state/desk/edit/derive'
import { CHANGE_GROUPS } from '../sketch/labels'

const props = defineProps<{ view: CompareView | null; nameOf: (id: string) => string | undefined }>()

const many = computed(() => (props.view?.sheets.length ?? 0) > 1)
const groups = computed(() => {
  const sheets = props.view?.sheets ?? []
  return CHANGE_GROUPS.map(g => ({
    ...g,
    items: sheets.flatMap(s => s.changes.filter(c => c.kind === g.kind).map(c => ({ text: c.message, mount: s.mount }))),
  })).filter(g => g.items.length)
})
const pending = computed(() => (props.view?.sheets ?? []).flatMap(s => s.pending.map(id => ({ id, mount: s.mount }))))
const sheetName = (m: string) => (m === 'root' ? '根' : (props.nameOf(m) ?? m))
</script>

<template>
  <div class="groups" data-testid="change-groups">
    <p v-if="!groups.length && !pending.length" class="muted">没有变更</p>
    <section v-for="g in groups" :key="g.kind" class="group" :data-kind="g.kind">
      <h4>
        {{ g.label }} <b>{{ g.items.length }}</b>
      </h4>
      <ul>
        <li v-for="(x, i) in g.items" :key="i">
          {{ x.text }}<span v-if="many" class="where">{{ sheetName(x.mount) }}</span>
        </li>
      </ul>
    </section>
    <section v-if="pending.length" class="group pending">
      <h4>
        待重连 <b>{{ pending.length }}</b>
      </h4>
      <ul>
        <li v-for="x in pending" :key="`${x.mount}:${x.id}`">
          {{ x.id }}<span v-if="many" class="where">{{ sheetName(x.mount) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.groups {
  max-height: 320px;
  overflow: auto;
}

.group + .group {
  margin-top: 6px;
}

h4 {
  margin: 0 0 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}

ul {
  margin: 0;
  padding-left: 16px;
}

li {
  font-size: 12px;
  line-height: 1.5;
}

.where {
  margin-left: 6px;
  font-size: 11px;
  color: var(--text-3);
}

.pending h4 {
  color: var(--danger);
}
</style>
