<script setup lang="ts">
/**
 * 导航树「改动」页签（CI-4，DL-5）：与「问题」页签同级同形，只在草图画布下出现。
 * 顶部六类计数、筛选（全部 / 本轮 / 某张草图）、撤回本轮；每行 #n · 类别 · 一句话 · 第几轮 · 谁 · 撤回。
 * 单击行：画布切到那张草图并居中；单击画布上的徽标：清单滚到那一行；悬停：两边一起高亮，删除项在原位置显示虚框（CI-3）。
 * 撤回一项 = 恢复到基线（有级联时先确认）；撤回本轮 = 最近一轮（撤销）。只读编辑分组的改动项、只发意图（desk.edit.changes）。
 * 任务模式（DL-38，TK-2–TK-4）：设计已认可时号不变，每行多一列状态（✓ / 待做 / 不核验，由核验推出、不能勾），撤回变灰，
 * 顶部多「复制给 agent」（Markdown）与「导出 JSON」，对不上号的偏差列在最后；当前版本重新生成后随描述重新加载自动重算。
 * 认可已撤回时顶部标「认可已撤回」。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useDesk } from '@/state/inject'
import { CHANGE_BADGES, sixCounts } from '../sketch/labels'

const desk = useDesk()
const changes = desk.edit.changes
const approval = desk.edit.approval
const taskMode = computed(() => approval.taskMode.value)
const tasks = computed(() => approval.tasks.value)
const rowOf = computed(() => new Map((tasks.value?.rows ?? []).filter(r => r.n !== null).map(r => [r.n!, r])))
const withdrawn = computed(() => tasks.value?.state === 'withdrawn')
const gates = computed(() => approval.preview.value?.gates ?? null)
const STATE = { done: '✓', todo: '待做', unchecked: '不核验' } as const
const copied = ref(false)
async function copyTasks() {
  try {
    await navigator.clipboard.writeText(approval.markdown())
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    note.value = '复制到剪贴板失败'
  }
}
function exportJson() {
  const url = URL.createObjectURL(new Blob([approval.json()], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `tasks-${tasks.value?.design ?? 'design'}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const items = computed(() => changes.items.value)
const filter = ref<'all' | 'round' | string>('all')
const sheets = computed(() => [...new Set(items.value.map(i => i.mount))].sort())
const latest = computed(() => changes.latest.value)
const shown = computed(() => {
  const list = items.value.filter(i =>
    filter.value === 'all' ? true : filter.value === 'round' ? latest.value !== null && i.round === latest.value && i.by === 'ai' : i.mount === filter.value,
  )
  // DL-46：任务模式下待做在前、不核验其次、✓ 留在最后（同态按号）
  if (!taskMode.value) return list
  return [...list].sort((a, b) => approval.taskRank(a.n) - approval.taskRank(b.n) || a.n - b.n)
})
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
  <div class="changes-tab" :class="{ tasks: taskMode }" data-testid="changes-tab">
    <header class="head">
      <div v-if="taskMode && tasks" class="task-head" data-testid="task-head">
        <span class="task-note">任务单 · {{ tasks.note }}</span>
        <span class="task-counts" data-testid="task-counts"
          >✓ {{ tasks.counts.done }} · 待做 {{ tasks.counts.todo
          }}<template v-if="tasks.counts.unchecked"> · 不核验 {{ tasks.counts.unchecked }}</template></span
        >
        <div class="task-out">
          <button data-testid="copy-tasks" title="把任务单（Markdown）复制给写代码的 agent；与 npm run arch -- tasks 同一份" @click="copyTasks">
            {{ copied ? '已复制' : '复制给 agent' }}
          </button>
          <button data-testid="export-tasks" title="导出 JSON 给外部系统；与 npm run arch -- tasks --json 同一份" @click="exportJson">导出 JSON</button>
        </div>
      </div>
      <!-- DL-50：三关（归档条件），随描述与文件变化重算 -->
      <p v-if="taskMode && gates" class="gates" data-testid="task-gates">
        <span v-for="g in gates.gates" :key="g.key" :class="g.ok ? 'ok' : 'bad'" :data-gate="g.key" :title="g.detail"
          >{{ g.ok ? '✓' : '✗' }} {{ g.label }}</span
        >
        <span v-if="gates.first" class="why" data-testid="task-gate-why">{{ gates.first.detail }}</span>
        <span v-else class="why ok">三关全绿，可以归档</span>
      </p>
      <p v-else-if="withdrawn" class="withdrawn" data-testid="task-withdrawn">{{ tasks?.note }}</p>
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
        <span
          v-if="taskMode"
          class="state"
          :class="rowOf.get(i.n)?.state"
          data-testid="task-state"
          :title="
            rowOf
              .get(i.n)
              ?.criteria.map(c => `怎样算做到：${c.text}`)
              .join('\n')
          "
          >{{ STATE[rowOf.get(i.n)?.state ?? 'todo'] }}</span
        >
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
    <section v-if="taskMode && tasks?.unmatched.length" class="unmatched" data-testid="task-unmatched">
      <p class="cap">对不上号 {{ tasks.unmatched.length }}</p>
      <p v-for="d in tasks.unmatched" :key="d.key" class="muted pad" :title="d.reason">{{ d.message }}</p>
    </section>
  </div>
</template>

<style scoped>
.gates {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  margin: 2px 12px 4px;
  font-size: 11.5px;
}

.gates .ok {
  color: var(--ok, #2e8b57);
}

.gates .bad {
  color: var(--danger);
}

.gates .why {
  flex-basis: 100%;
  color: var(--text-2);
}

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
/* DL-34：锁定时撤回变灰 */
.danger-link:disabled,
.withdraw:disabled {
  color: var(--text-3);
  opacity: 0.55;
  cursor: not-allowed;
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
.task-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  font-size: 12px;
}
.task-note {
  color: var(--diff-added);
}
.task-counts {
  color: var(--text-2);
}
.task-out {
  display: flex;
  gap: 4px;
  margin-left: auto;
}
.task-out button {
  padding: 1px 8px;
  font-size: 12px;
}
.withdrawn {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}
.state {
  flex: none;
  margin-top: 6px;
  padding: 0 6px;
  border-radius: 8px;
  font-size: 11.5px;
  white-space: nowrap;
}
.state.done {
  color: var(--diff-added);
  background: var(--diff-added-soft);
}
.state.todo {
  color: var(--diff-changed);
  background: var(--diff-changed-soft);
}
.state.unchecked {
  color: var(--text-3);
}
.unmatched {
  padding: 6px 4px;
}
.cap {
  margin: 0 8px;
  font-size: 12px;
  color: var(--text-2);
}
.withdraw {
  flex: none;
  margin-top: 4px;
  padding: 1px 6px;
  font-size: 11.5px;
}
</style>
