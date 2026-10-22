<script setup lang="ts">
/**
 * 「显示」面板 · 演化（结构视角，J5）：热度单选「关 / 修改 / 缺陷」与「时间耦合」开关在组内，缺省关闭、按项目记在本地；
 * 开启后说明三档角标与波浪线怎么读；没有演化事实时置灰并写明原因（J1）。热度只用角标、耦合只用波浪线（L10）。
 */
import { computed } from 'vue'
import { HEAT_KINDS, type HeatKind } from '@/model'
import { useDesk } from '@/state/inject'
import DisplayGroup from './DisplayGroup.vue'
import LineSwatch from './LineSwatch.vue'
import { EVOLUTION_HINT, HEAT_HINT, HEAT_LABEL } from './labels'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const desk = useDesk()

const ready = computed(() => desk.evolution.status.value === 'ready')
const hint = computed(() => {
  if (ready.value) return ''
  const st = desk.evolution.status.value
  return st === 'error' && desk.evolution.error.value ? `${EVOLUTION_HINT.error}：${desk.evolution.error.value}` : EVOLUTION_HINT[st]
})
const OPTIONS: readonly ('off' | HeatKind)[] = ['off', ...HEAT_KINDS]
const stats = computed(() => desk.evolution.stats.value)
const setHeat = (h: 'off' | HeatKind) => desk.setToggles({ heat: h })
</script>

<template>
  <DisplayGroup title="演化 · 角标与波浪线" :open="open" @toggle="emit('toggle')">
    <div v-if="!ready" class="item muted">{{ hint }}</div>
    <template v-else>
      <div class="setting" role="group" aria-label="热度">
        <span class="setting-label">热度</span>
        <span class="segmented">
          <button
            v-for="h in OPTIONS"
            :key="h"
            :class="{ on: desk.toggles.heat === h }"
            :aria-pressed="desk.toggles.heat === h"
            :title="HEAT_HINT[h]"
            @click="setHeat(h)"
          >
            {{ HEAT_LABEL[h] }}
          </button>
        </span>
      </div>
      <div class="setting">
        <label class="check"><input v-model="desk.toggles.coupling" type="checkbox" aria-label="时间耦合" /> 时间耦合</label>
        <span v-if="stats" class="muted window">近 {{ stats.days }} 天 · {{ stats.commits }} 次提交</span>
      </div>
      <div v-if="desk.toggles.heat === 'off' && !desk.toggles.coupling" class="item muted">
        已关闭：打开后节点右下角标热度角标、本层总是一起改的模块之间画波浪线
      </div>
      <template v-else>
        <div v-if="desk.toggles.heat !== 'off'" class="item inline">
          <span><span class="heat tier-1" />低</span>
          <span><span class="heat tier-2" />中</span>
          <span><span class="heat tier-3" />高（{{ HEAT_LABEL[desk.toggles.heat] }}热度，本层分档）</span>
        </div>
        <template v-if="desk.toggles.coupling">
          <div class="item">
            <span class="sw"><LineSwatch :look="{ temp: 'couple' }" pill /></span>
            <span>波浪线 ×N = 同一提交里一起改了 N 次</span>
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
.setting {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 24px;
}

.setting-label {
  color: var(--text-2);
  white-space: nowrap;
}

.check {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  color: var(--text-2);
}

.window {
  font-size: 11px;
}

.segmented {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.segmented button {
  border: none;
  border-radius: 0;
  background: none;
  padding: 1px 10px;
  font: inherit;
  color: var(--text-2);
  white-space: nowrap;
}

.segmented button + button {
  border-left: 1px solid var(--border);
}

.segmented button.on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

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
