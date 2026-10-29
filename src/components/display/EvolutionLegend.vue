<script setup lang="ts">
/**
 * 「显示」面板 · 演化（结构 / 交互视角，J5）：说明热度三档角标与时间耦合波浪线怎么读（图例只读，L45）；
 * 「热度」单选与「时间耦合」开关在设置块的「演化」组（第十五轮 G13 迁出，缺省关闭、按项目记在本地），组标题旁互指；
 * 时间耦合的波浪线按需显示（F7、L44：不进布局，悬停或选中一端时画出），常显的只剩画布角计数与面板清单。
 * 没有演化事实时置灰并写明原因（J1）。热度只用角标、耦合只用波浪线（L10）。
 * - 图例按上下文显示（L47，G14）：本层有热度角标才列热度行（出现集合由 state/desk/legend 一处派生）；
 *   波浪线是聚焦 / 悬停才画出的临时记号（F7）——归尾部「临时可见」小节常列，不随出现显隐。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import DisplayGroup from './DisplayGroup.vue'
import LineSwatch from './LineSwatch.vue'
import { EVOLUTION_HINT, HEAT_LABEL } from './labels'

defineProps<{ open: boolean; presence: Set<string> }>()
const emit = defineEmits<{ toggle: [] }>()
const desk = useDesk()

const ready = computed(() => desk.evolution.status.value === 'ready')
const hint = computed(() => {
  if (ready.value) return ''
  const st = desk.evolution.status.value
  return st === 'error' && desk.evolution.error.value ? `${EVOLUTION_HINT.error}：${desk.evolution.error.value}` : EVOLUTION_HINT[st]
})
</script>

<template>
  <DisplayGroup title="演化 · 角标与波浪线" :open="open" @toggle="emit('toggle')">
    <template #actions>
      <span class="aside-note">开关在设置 · 演化</span>
    </template>
    <div v-if="!ready" class="item muted">{{ hint }}</div>
    <template v-else>
      <div v-if="desk.toggles.heat === 'off' && !desk.toggles.coupling" class="item muted">
        已关闭：在「设置 · 演化」打开后节点右下角标热度角标、本层总是一起改的模块之间画波浪线
      </div>
      <template v-else>
        <div v-if="desk.toggles.heat !== 'off'" class="item inline">
          <template v-if="presence.has('evo:heat')">
            <span><span class="heat tier-1" />低</span>
            <span><span class="heat tier-2" />中</span>
            <span><span class="heat tier-3" />高（{{ HEAT_LABEL[desk.toggles.heat] }}热度，本层分档）</span>
          </template>
          <span v-else class="muted">本层没有热度角标（{{ HEAT_LABEL[desk.toggles.heat] }}热度，本层分档）</span>
        </div>
        <!-- L47：临时可见——波浪线是聚焦 / 悬停才画出的临时记号（F7、L44），常列、不随出现显隐 -->
        <template v-if="desk.toggles.coupling">
          <div class="section-label">临时可见 · 悬停或选中一端时画出</div>
          <div class="item">
            <span class="sw"><LineSwatch :look="{ temp: 'couple' }" pill /></span>
            <span>波浪线 ×N = 同一提交里一起改了 N 次；不进布局，悬停或选中一端时画出（F7），清单在面板</span>
          </div>
          <div class="item">
            <span class="sw"><LineSwatch :look="{ temp: 'couple', isolated: true }" /></span>
            <span>深色 = 两端没有任何依赖与关系（代码事实看不见）</span>
          </div>
        </template>
      </template>
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

.aside-note {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-3);
}
</style>
