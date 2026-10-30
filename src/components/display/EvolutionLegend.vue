<script setup lang="ts">
/**
 * 图例 · 演化（结构 / 交互视角，J5）：「演化热度」「时间耦合」两行是开关行（L45，ADR-0056：图例行即开关；缺省关闭、按项目记在本地），
 * 热度的口径（修改 / 缺陷）在工具栏「显示 ▾」（L49），热度行打开时用记住的口径；开着时各自下面解码记号——热度三档角标、波浪线。
 * 时间耦合的波浪线按需显示（F7、L44：不进布局，悬停或选中一端时画出），归「临时可见」小节常列。
 * 没有演化事实时开关行置灰并写明原因（J1）。热度只用角标、耦合只用波浪线（L10）。
 * - 图例按上下文显示（L47，G14）：本层有热度角标才列三档（出现集合由 state/desk/legend 一处派生）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import DisplayGroup from './DisplayGroup.vue'
import LegendToggle from './LegendToggle.vue'
import LineSwatch from './LineSwatch.vue'
import { COUPLE_ISOLATED_TEXT, COUPLE_TEXT, EVOLUTION_HINT, HEAT_LABEL, TOGGLE_HINT, TOGGLE_LABEL } from './labels'
import { heatControls } from './useEvolutionPrefs'

defineProps<{ open: boolean; presence: Set<string> }>()
const emit = defineEmits<{ toggle: [] }>()
const desk = useDesk()
const heat = heatControls(desk.project ?? '', desk)

const ready = computed(() => desk.evolution.status.value === 'ready')
const hint = computed(() => {
  if (ready.value) return ''
  const st = desk.evolution.status.value
  return st === 'error' && desk.evolution.error.value ? `${EVOLUTION_HINT.error}：${desk.evolution.error.value}` : EVOLUTION_HINT[st]
})
const heatOn = computed(() => ready.value && desk.toggles.heat !== 'off')
const coupleOn = computed(() => ready.value && !!desk.toggles.coupling)
const stats = computed(() => desk.evolution.stats.value)
</script>

<template>
  <DisplayGroup title="演化" :open="open" @toggle="emit('toggle')">
    <div v-if="!ready" class="item muted">{{ hint }}</div>
    <LegendToggle :on="heatOn" :label="TOGGLE_LABEL.heat" :title="hint || TOGGLE_HINT.heat" :disabled="!ready" data-testid="toggle-heat" @toggle="heat.toggle">
      <template #swatch><span class="heat tier-3" /></template>
      · {{ HEAT_LABEL[heatOn ? desk.toggles.heat : heat.kind.value] }}
    </LegendToggle>
    <div v-if="heatOn" class="item inline">
      <template v-if="presence.has('evo:heat')">
        <span><span class="heat tier-1" />低</span>
        <span><span class="heat tier-2" />中</span>
        <span><span class="heat tier-3" />高（本层分档）</span>
      </template>
      <span v-else class="muted">本层没有热度角标</span>
    </div>
    <LegendToggle
      :on="coupleOn"
      :label="TOGGLE_LABEL.coupling"
      :title="hint || TOGGLE_HINT.coupling"
      :disabled="!ready"
      data-testid="toggle-coupling"
      @toggle="desk.setToggles({ coupling: !desk.toggles.coupling })"
    >
      <template #swatch><LineSwatch :look="{ temp: 'couple' }" /></template>
      <template v-if="stats">· 近 {{ stats.days }} 天 {{ stats.commits }} 次提交</template>
    </LegendToggle>
    <!-- L47：临时可见——波浪线是聚焦 / 悬停才画出的临时记号（F7、L44），常列、不随出现显隐 -->
    <template v-if="coupleOn">
      <div class="section-label">临时可见 · 悬停或选中一端时画出</div>
      <div class="item">
        <span class="sw"><LineSwatch :look="{ temp: 'couple' }" pill /></span>
        <span>{{ COUPLE_TEXT }}</span>
      </div>
      <div class="item">
        <span class="sw"><LineSwatch :look="{ temp: 'couple', isolated: true }" /></span>
        <span>{{ COUPLE_ISOLATED_TEXT }}</span>
      </div>
    </template>
  </DisplayGroup>
</template>

<style scoped>
.heat {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  box-shadow: 0 0 0 1px var(--border-strong);
}

.heat.tier-1 {
  background: var(--heat-1);
}

.heat.tier-2 {
  background: var(--heat-2);
}

.heat.tier-3 {
  background: var(--heat-3);
}
</style>
