<script setup lang="ts">
/**
 * 核对卡（PC-2、PC-6–PC-8，V15b、V15c）：卡头给结论「⚠ N 项要看 · ✓ M 项正常」；里面一行一个分项（状态 + 一句结论），
 * ⚠ 行下平铺出问题的条目（至多 5 条，其余「+N」），单击条目跳到对应清单或选中那条关系；底部是折叠带计数的清单（slot）。
 * 有 ⚠ 行时缺省展开，全部正常时收起。某行的结论可由 `row-<key>` 插槽替换（如确认行放确认徽标）。
 */
import { computed, reactive } from 'vue'
import { useDesk } from '@/state/inject'
import PanelCard from './PanelCard.vue'
import { CHECK_ITEMS_CAP, checkSummary, isWarn, type CheckItem, type CheckRow } from './panelCheck'
import { jumpToSection } from './panelNotices'

const props = defineProps<{ rows: CheckRow[]; /** 没有分项时卡头的结论（如「证据 3 项」） */ empty?: string; /** 变化即展开（定位请求） */ force?: number }>()
const desk = useDesk()
const sum = computed(() => checkSummary(props.rows))
const more = reactive<Record<string, boolean>>({})
const shown = (r: CheckRow) => (more[r.key] ? r.items : r.items.slice(0, CHECK_ITEMS_CAP))
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
          <span class="txt"
            ><slot :name="`row-${r.key}`" :row="r">{{ r.text }}</slot></span
          >
        </div>
        <template v-if="isWarn(r.state)">
          <button v-for="(i, n) in shown(r)" :key="`${r.key}:${n}`" class="det" :class="{ hint: i.hint }" :data-check-item="r.key" @click="go(i)">
            {{ i.text }}
          </button>
          <button v-if="r.items.length > CHECK_ITEMS_CAP" class="det more link" @click="more[r.key] = !more[r.key]">
            {{ more[r.key] ? '收起' : `+${r.items.length - CHECK_ITEMS_CAP}` }}
          </button>
        </template>
      </template>
    </div>
    <div v-if="$slots.default" class="lists">
      <slot />
    </div>
  </PanelCard>
</template>

<style scoped>
.rows {
  display: grid;
  grid-template-columns: 14px auto 1fr;
  gap: 3px 6px;
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
  padding: 3px 8px;
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

.det.more {
  justify-self: start;
  background: none;
  padding: 0 8px;
}

.lists {
  margin-top: 8px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}
</style>
