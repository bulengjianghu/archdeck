<script setup lang="ts">
/**
 * 导航树「改动」页签（CI-4，DL-5）：与「问题」页签同级同形，只在草图画布下出现。
 * 顶部六类计数、筛选（全部 / 本轮 / 某张草图）、撤回本轮；每行 #n · 类别 · 一句话 · 第几轮 · 谁 · 撤回。
 * 单击行：画布切到那张草图并居中；单击画布上的徽标：清单滚到那一行；悬停：两边一起高亮，删除项在原位置显示虚框（CI-3）。
 * 撤回一项 = 恢复到基线（有级联时先确认）；撤回本轮 = 最近一轮（撤销）。只读编辑分组的改动项、只发意图（desk.edit.changes）。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useDesk } from '@/state/inject'
import { CHANGE_BADGES, sixCounts } from '../sketch/labels'

const desk = useDesk()
const changes = desk.edit.changes
const items = computed(() => changes.items.value)
const filter = ref<'all' | 'round' | string>('all')
const sheets = computed(() => [...new Set(items.value.map(i => i.mount))].sort())
const latest = computed(() => changes.latest.value)
const shown = computed(() =>
  items.value.filter(i =>
    filter.value === 'all' ? true : filter.value === 'round' ? latest.value !== null && i.round === latest.value && i.by === 'ai' : i.mount === filter.value,
  ),
)
const six = computed(() => sixCounts(changes.counts.value as Parameters<typeof sixCounts>[0]))
const sheetName = (m: string) => (m === 'root' ? '根' : (desk.edit.nameOf(m) ?? m))
const note = ref('')
function say(r: { ok: boolean; reason?: string }) {
  note.value = !r.ok && r.reason && !changes.pending.value ? r.reason : ''
}
const withdraw = (n: number) => say(changes.withdrawItem(n))
const withdrawRound = () => latest.value !== null && say(changes.withdrawRound(latest.value))

// 单击画布徽标：滚到那一行并闪一下
const list = ref<HTMLElement | null>(null)
const flash = ref<number | null>(null)
watch(
  () => changes.reveal.value,
  r => {
    if (!r) return
    filter.value = 'all'
    flash.value = r.n
    void nextTick(() => list.value?.querySelector(`[data-n="${r.n}"]`)?.scrollIntoView({ block: 'nearest' }))
    setTimeout(() => flash.value === r.n && (flash.value = null), 1200)
  },
  { immediate: true },
)
</script>

<template>
  <div class="changes-tab" data-testid="changes-tab">
    <header class="head">
      <div class="six" data-testid="changes-six">
        <span v-for="c in six" :key="c.key" class="six-n" :class="[c.key, { zero: !c.n }]" :title="c.label">{{ c.mark }} {{ c.n }}</span>
      </div>
      <div class="filters" role="group" aria-label="筛选改动">
        <button :class="{ on: filter === 'all' }" @click="filter = 'all'">全部 {{ items.length }}</button>
        <button :class="{ on: filter === 'round' }" :disabled="latest === null" data-testid="filter-round" @click="filter = 'round'">本轮</button>
        <select
          v-if="sheets.length > 1"
          :value="sheets.includes(filter) ? filter : ''"
          aria-label="按草图筛选"
          @change="filter = ($event.target as HTMLSelectElement).value || 'all'"
        >
          <option value="">某张草图…</option>
          <option v-for="m in sheets" :key="m" :value="m">{{ sheetName(m) }}</option>
        </select>
        <span class="sp" />
        <button
          class="danger-link"
          :disabled="latest === null || desk.edit.locked.value"
          data-testid="tab-withdraw-round"
          title="撤回最近一轮（一步撤销，可重做）"
          @click="withdrawRound"
        >
          撤回本轮
        </button>
      </div>
    </header>
    <p v-if="note" class="muted pad">{{ note }}</p>
    <p v-if="!shown.length" class="muted pad">{{ items.length ? '没有符合筛选条件的改动。' : '还没有改动：说一句想法，或直接在画布上改。' }}</p>
    <ul ref="list" class="items">
      <li
        v-for="i in shown"
        :key="i.n"
        class="item"
        :class="[i.kind, { flash: flash === i.n, hot: changes.hover.value === i.n }]"
        :data-n="i.n"
        data-testid="change-row"
        @mouseenter="changes.setHover(i.n)"
        @mouseleave="changes.setHover(null)"
      >
        <button class="row" :title="`${i.summary}（单击：画布居中）`" @click="changes.focusItem(i.n)">
          <span class="n">#{{ i.n }}</span>
          <span class="kind" :class="i.kind">{{ CHANGE_BADGES[i.kind].title }}</span>
          <span class="title">{{ i.summary }}</span>
          <span class="meta"
            >{{ i.round ? `第 ${i.round} 轮` : '起始' }} · {{ i.by === 'ai' ? 'AI' : '人'
            }}<template v-if="sheets.length > 1"> · {{ sheetName(i.mount) }}</template></span
          >
        </button>
        <button
          class="withdraw"
          :disabled="desk.edit.locked.value"
          data-testid="withdraw-item"
          :title="`撤回 #${i.n}：恢复成基线的样子（一步，可反悔）`"
          @click="withdraw(i.n)"
        >
          撤回
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.pad {
  padding: 4px 12px;
  margin: 0;
}
.muted {
  color: var(--text-3);
  font-size: 12px;
}
.head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 10px 8px;
  border-bottom: 1px solid var(--border);
}
.six {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
}
.six-n.zero {
  color: var(--text-3);
}
.filters {
  display: flex;
  gap: 4px;
  align-items: center;
}
.filters button {
  padding: 1px 8px;
  font-size: 12px;
}
.filters button.on {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
}
.filters select {
  font-size: 12px;
}
.sp {
  flex: 1;
}
.danger-link {
  color: var(--danger);
}
.items {
  list-style: none;
  margin: 0;
  padding: 0;
}
.item {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 2px 8px 2px 4px;
  border-bottom: 1px solid var(--border-soft, var(--border));
}
.item.hot,
.item.flash {
  background: var(--accent-soft);
}
.row {
  flex: 1;
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: 2px 6px;
  text-align: left;
  border: none;
  background: none;
  padding: 4px;
  font-size: 12.5px;
}
.row .n {
  font-weight: 600;
  color: var(--accent);
}
.row .kind {
  align-self: start;
  white-space: nowrap;
  padding: 0 5px;
  border-radius: 8px;
  font-size: 11px;
  background: var(--surface-2);
}
.row .meta {
  grid-column: 1 / -1;
  color: var(--text-3);
  font-size: 11.5px;
}
.withdraw {
  flex: none;
  margin-top: 4px;
  padding: 1px 6px;
  font-size: 11.5px;
}
</style>
