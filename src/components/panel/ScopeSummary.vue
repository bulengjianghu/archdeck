<script setup lang="ts">
/**
 * 核对标签的范围汇总（LY-13，第二十二轮波 3）：主语是系统或层时，核对标签的第一张卡——这棵子树里的违规、环、未证实、未归属、需复核各几项，
 * 卡头给结论，全部为 0 时写「都正常」，单击「在问题里看 ›」打开问题资料标签（LY-4a）。口径同返工清单（reworkScope）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { REWORK_CATEGORY_LABELS, SCOPE_CATEGORIES } from '@/model'
import PanelCard from './PanelCard.vue'
import { scopeTotalOf } from './checkRows'

const props = defineProps<{ roots: readonly string[] }>()
const desk = useDesk()
const scope = computed(() => desk.reworkScope(props.roots))
const total = computed(() => scopeTotalOf(desk, props.roots) ?? 0)
const facts = computed(() => !!desk.rework.value?.facts)
const LABEL: Record<(typeof SCOPE_CATEGORIES)[number], string> = {
  violation: REWORK_CATEGORY_LABELS.violation,
  cycle: '环',
  unconfirmed: '未证实',
  ownership: '未归属',
  review: REWORK_CATEGORY_LABELS.review,
}
</script>

<template>
  <PanelCard kind="summary" title="汇总" :summary="scope ? (total ? `⚠ ${total} 项要看` : '都正常') : '读取中'" :warn="total > 0" data-testid="scope-summary">
    <div v-if="scope" class="rows">
      <div v-for="c in SCOPE_CATEGORIES" :key="c" class="row" :class="{ warn: scope.counts[c] > 0 }" :data-scope="c">
        <span class="st">{{ scope.counts[c] ? '⚠' : '✓' }}</span>
        <span class="lbl">{{ LABEL[c] }}</span>
        <span class="n">{{ scope.counts[c] }}</span>
      </div>
      <p v-if="!facts" class="muted note">没有代码事实：违规、环、未证实要等代码事实读到才算（K8）</p>
      <button class="link" @click="desk.workspace.open({ kind: 'issues' }, true)">在「问题」里看全部 ›</button>
    </div>
  </PanelCard>
</template>

<style scoped>
.rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 13px 10px;
  font-size: 12.5px;
}

.row {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  align-items: center;
}

.row .st {
  color: var(--success, #2f7d4f);
}

.row.warn .st,
.row.warn .n {
  color: var(--warning);
}

.n {
  font-variant-numeric: tabular-nums;
}

.note {
  margin: 4px 0 0;
  font-size: 12px;
}

.link {
  align-self: flex-start;
  margin-top: 6px;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  font-size: 12.5px;
}
</style>
