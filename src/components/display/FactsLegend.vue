<script setup lang="ts">
/** 「显示」面板 · 代码事实（线型通道，结构视角，K9）：组标题右侧是开关；开启后说明证实、未证实、未解释的交互、违规与本层环怎么画。线型只在这一组讲（ADR-0017 第三轮） */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import DisplayGroup from './DisplayGroup.vue'
import LineSwatch from './LineSwatch.vue'
import { FACTS_HINT } from './labels'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const desk = useDesk()

const NEUTRAL = 'var(--text-2)'
const ready = computed(() => desk.facts.status.value === 'ready')
const hint = computed(() => (ready.value ? '' : FACTS_HINT[desk.facts.status.value]))
</script>

<template>
  <DisplayGroup title="代码事实 · 线型" :open="open" @toggle="emit('toggle')">
    <template #actions>
      <label class="switch facts" :class="{ off: !ready }" :title="hint || '在图上叠加代码事实：关系是否被代码证实、未解释的交互、违规与环'">
        <input v-model="desk.toggles.showFacts" type="checkbox" role="switch" :disabled="!ready" aria-label="代码事实" />
      </label>
    </template>
    <div v-if="!ready" class="item muted">{{ hint }}</div>
    <div v-else-if="!desk.toggles.showFacts" class="item muted">已关闭：所有关系为实线；打开后叠加代码证实、未解释的交互、违规与环</div>
    <template v-else>
      <div class="item">
        <span class="sw"><LineSwatch :color="NEUTRAL" /></span>
        <span>实线 = 已证实（不加标记）</span>
      </div>
      <div class="item">
        <span class="sw"><LineSwatch :color="NEUTRAL" :look="{ factState: 'unconfirmed' }" mark="?" /></span>
        <span>虚线 + ? = 未证实（含部分证实）</span>
      </div>
      <div class="item">
        <span class="sw"><LineSwatch :look="{ temp: 'code' }" /></span>
        <span>点线 = 代码有、描述无（未解释的交互）</span>
      </div>
      <div class="item">
        <span class="sw"><LineSwatch :look="{ temp: 'code', violated: true }" halo /></span>
        <span>违规（红色点线；关系边加红晕）</span>
      </div>
      <div class="item">
        <span class="sw"><span class="cycle">↻N</span></span
        ><span>本层的环</span>
      </div>
    </template>
  </DisplayGroup>
</template>

<style scoped>
.cycle {
  padding: 0 4px;
  font-size: 10px;
  line-height: 14px;
  color: var(--danger);
  border: 1px solid var(--danger);
  border-radius: 7px;
  white-space: nowrap;
}

.switch {
  display: inline-flex;
}

.switch input {
  appearance: none;
  position: relative;
  width: 26px;
  height: 14px;
  margin: 0;
  border-radius: 7px;
  background: var(--border-strong);
  cursor: pointer;
  transition: background 0.15s;
}

.switch input::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--surface);
  transition: transform 0.15s;
}

.switch input:checked {
  background: var(--accent);
}

.switch input:checked::after {
  transform: translateX(12px);
}

.switch.off {
  opacity: 0.5;
}

.switch input:disabled {
  cursor: not-allowed;
}
</style>
