<script setup lang="ts">
/**
 * 「显示」面板 · 组装（O12，结构视角）：组标题右侧是「组装」开关（缺省关，按项目记在本地，不进 URL）；
 * 开启后把组装事实（K13）投影到本层画点划叠加线（不参与布局，单击落到代码依赖），组装根所在的节点标「组装根」角标。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import DisplayGroup from './DisplayGroup.vue'
import LineSwatch from './LineSwatch.vue'
import { FACTS_HINT } from './labels'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const desk = useDesk()

const ready = computed(() => desk.facts.status.value === 'ready')
const hint = computed(() => (ready.value ? '' : FACTS_HINT[desk.facts.status.value]))
const count = computed(() => desk.facts.assembly.value?.overlays.length ?? 0)
</script>

<template>
  <DisplayGroup title="组装" :open="open" @toggle="emit('toggle')">
    <template #actions>
      <label class="switch" :class="{ off: !ready }" :title="hint || '叠加组装事实：谁 new / 工厂创建 / 注册了谁（K13），并标出组装根'">
        <input v-model="desk.toggles.assembly" type="checkbox" role="switch" :disabled="!ready" aria-label="组装" />
      </label>
    </template>
    <div v-if="!ready" class="item muted">{{ hint }}</div>
    <div v-else-if="!desk.toggles.assembly" class="item muted">已关闭：打开后叠加组装事实（谁把谁装起来），标出组装根</div>
    <template v-else>
      <div class="item">
        <span class="sw"><LineSwatch :look="{ temp: 'assembly' }" arrow="closed" /></span>
        <span>点划线 = 组装（new / 工厂 / 注册，不参与布局）{{ count ? '' : '；本层没有' }}</span>
      </div>
      <div class="item">
        <span class="sw"><span class="root">组装根</span></span
        ><span>组装了别的模块、自身不被组装</span>
      </div>
    </template>
  </DisplayGroup>
</template>

<style scoped>
.root {
  padding: 0 4px;
  font-size: 10px;
  line-height: 14px;
  color: var(--assembly);
  border: 1px dashed var(--assembly);
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
