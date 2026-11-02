<script setup lang="ts">
/**
 * 核对卡（PC-2、PC-6–PC-8，V15b、V15c）：卡头给结论「⚠ N 项要看 · ✓ M 项正常」；里面一行一个分项（状态 + 一句结论），
 * ⚠ 行下平铺出问题的条目（每行至多 5 条、全卡缺省至多 8 条，其余一键「+N 全部条目」，PC-7），单击条目跳到对应清单或选中那条关系；
 * 底部「证据与清单 · N」整块缺省折叠（ADR-0060），里面是折叠带计数的清单（slot）。
 * 有 ⚠ 行时缺省展开，全部正常时收起。某行的结论可由 `row-<key>` 插槽替换（如确认行放确认徽标）。
 */
import { computed, onMounted, onUpdated, ref } from 'vue'
import { useDesk } from '@/state/inject'
import PanelCard from './PanelCard.vue'
import { CHECK_ITEMS_CAP, checkSummary, isWarn, type CheckItem, type CheckRow } from './panelCheck'
import { jumpToSection } from './panelNotices'

const props = defineProps<{ rows: CheckRow[]; /** 没有分项时卡头的结论（如「证据 3 项」） */ empty?: string; /** 变化即展开（定位请求） */ force?: number }>()
const desk = useDesk()
const sum = computed(() => checkSummary(props.rows))
/** PC-7（ADR-0060）：条目的全卡预算——多个 ⚠ 行的条目按行序合计缺省至多 ITEM_BUDGET 条，其余一键展开（清单里本就逐条可查） */
const ITEM_BUDGET = 8
const expandAll = ref(false)
const allocation = computed(() => {
  const out = new Map<string, CheckItem[]>()
  let budget = ITEM_BUDGET
  for (const r of props.rows) {
    if (!isWarn(r.state)) continue
    const take = expandAll.value ? r.items.length : Math.max(0, Math.min(r.items.length, CHECK_ITEMS_CAP, budget))
    budget -= take
    out.set(r.key, r.items.slice(0, take))
  }
  return out
})
const shown = (r: CheckRow) => allocation.value.get(r.key) ?? []
const totalItems = computed(() => props.rows.reduce((n, r) => n + (isWarn(r.state) ? r.items.length : 0), 0))
const clipped = computed(() => !expandAll.value && totalItems.value > ITEM_BUDGET)
/** ADR-0060：证据与清单整块缺省折叠（结论 → 条目 → 证据的第三步），条目跳转时由 usePanelJump 打开祖先 */
const listsEl = ref<HTMLElement | null>(null)
const listCount = ref(0)
const countLists = () => {
  listCount.value = listsEl.value ? listsEl.value.children.length : 0
}
onMounted(countLists)
onUpdated(countLists)
const go = (i: CheckItem) => (i.relation ? desk.revealRelation(i.relation) : i.target ? jumpToSection(i.target) : undefined)
const MARK = { bad: '⚠', hint: '⚠', ok: '✓', none: '—' } as const
</script>

<template>
  <PanelCard kind="check" title="核对" :summary="rows.length ? sum.text : empty" :warn="sum.warn > 0" :open="sum.warn > 0" :force="force">
    <div v-if="rows.length" class="rows">
      <template v-for="r in rows" :key="r.key">
        <div class="row" :class="r.state" :data-check="r.key">
          <span class="st">{{ MARK[r.state] }}</span>
          <span class="dim">{{ r.label }}</span>
          <span class="txt" :title="r.title"
            ><slot :name="`row-${r.key}`" :row="r">{{ r.text }}</slot></span
          >
        </div>
        <template v-if="isWarn(r.state)">
          <button
            v-for="(i, n) in shown(r)"
            :key="`${r.key}:${n}`"
            class="det"
            :class="{ hint: i.hint, plain: !i.target && !i.relation }"
            :data-check-item="r.key"
            :data-target="i.target"
            :title="i.title"
            @click="go(i)"
          >
            {{ i.text }}
          </button>
        </template>
      </template>
      <button v-if="clipped" class="det more link" data-testid="check-expand-all" @click="expandAll = true">
        +{{ props.rows.reduce((n, r) => n + (isWarn(r.state) ? r.items.length : 0), 0) - ITEM_BUDGET }} 全部条目
      </button>
    </div>
    <details v-if="$slots.default" class="lists-fold">
      <summary data-testid="check-lists-fold">
        证据与清单<span v-if="listCount" class="count"> · {{ listCount }}</span>
      </summary>
      <div ref="listsEl" class="lists">
        <slot />
      </div>
    </details>
  </PanelCard>
</template>

<style scoped>
.rows {
  display: grid;
  grid-template-columns: 14px auto 1fr;
  gap: 2px 6px;
  align-items: baseline;
  font-size: 12.5px;
}

.row {
  display: contents;
}

.st {
  font-size: 12px;
  color: var(--text-3);
}

.ok .st {
  color: var(--rel-streams, #2e8b57);
}

.bad .st {
  color: var(--danger);
}

.hint .st {
  color: var(--warning);
}

.dim {
  color: var(--text-2);
  white-space: nowrap;
}

.txt {
  min-width: 0;
}

.none .txt {
  color: var(--text-3);
}

.det {
  grid-column: 2 / 4;
  margin-bottom: 1px;
  padding: 2px 8px;
  font: inherit;
  font-size: 12px;
  text-align: left;
  color: var(--danger);
  background: var(--warning-soft);
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}

.det.hint {
  color: var(--warning);
}

.det:hover {
  text-decoration: underline;
}

/* 没有清单可跳的条目只陈述（如「核心之间未分类 N」）：不像链接 */
.det.plain {
  cursor: default;
}

.det.plain:hover {
  text-decoration: none;
}

.det.more {
  justify-self: start;
  background: none;
  padding: 0 8px;
}

/* ADR-0060：证据与清单的整块折叠——结论与条目在一屏内，证据要点开才看 */
.lists-fold {
  margin-top: 6px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}

.lists-fold summary {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  cursor: pointer;
  list-style: none;
}

.lists-fold summary::before {
  content: '▸ ';
  color: var(--text-3);
}

.lists-fold[open] summary::before {
  content: '▾ ';
}

.lists-fold .count {
  font-weight: 500;
  color: var(--text-3);
}

.lists {
  margin-top: 6px;
}
</style>
