<script setup lang="ts">
/**
 * 「显示」面板 · 代码事实 · 标签（交互视角，K9、L26，ADR-0035）：组标题右侧是开关；开启后说明代码事实写在标签位的词（未证实、违规、未解释、缺段）、
 * 本层环与承载叠加（L22）。线型（实线 = 交互、虚线 = 依赖）是共享通道，在「共享」组讲，这里只讲字。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import DisplayGroup from './DisplayGroup.vue'
import LineSwatch from './LineSwatch.vue'
import { FACTS_HINT, FACT_TAG_HINT } from './labels'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const desk = useDesk()

const ready = computed(() => desk.facts.status.value === 'ready')
const hint = computed(() => (ready.value ? '' : FACTS_HINT[desk.facts.status.value]))
</script>

<template>
  <DisplayGroup title="代码事实 · 标签" :open="open" @toggle="emit('toggle')">
    <template #actions>
      <label class="switch facts" :class="{ off: !ready }" :title="hint || '在图上叠加代码事实：关系是否被代码证实、未解释的交互、违规与环'">
        <input v-model="desk.toggles.showFacts" type="checkbox" role="switch" :disabled="!ready" aria-label="代码事实" />
      </label>
    </template>
    <div v-if="!ready" class="item muted">{{ hint }}</div>
    <div v-else-if="!desk.toggles.showFacts" class="item muted">已关闭：不写代码事实标签；打开后标出未证实、未解释的交互、违规与环</div>
    <template v-else>
      <div class="item muted">只标异常，写在线中点的标签位；已证实的不标</div>
      <div v-for="t in FACT_TAG_HINT" :key="t.tag" class="item" :data-tag="t.tag" :data-testid="t.tag === '缺段' ? 'carrier-legend' : undefined">
        <span class="sw tag"
          ><span class="tag-pill warn">{{ t.tag }}</span></span
        >
        <span
          >{{ t.text }}<span v-if="t.tag === '未解释'" class="inline-sw"><LineSwatch :look="{ temp: 'code' }" arrow="open" /></span
          ><span v-else-if="t.tag === '违规'" class="inline-sw"><LineSwatch :look="{ temp: 'code', violated: true }" arrow="open" /></span
          ><span v-else-if="t.tag === '缺段'" class="inline-sw"><LineSwatch :look="{ temp: 'carrier-gap' }" arrow="open" /></span
          ><template v-if="t.tag === '缺段'">（承载叠加：关系面板「承载」一节列各段）</template></span
        >
      </div>
      <div class="item">
        <span class="sw"><span class="cycle">↻N</span></span
        ><span>本层的环</span>
      </div>
    </template>
  </DisplayGroup>
</template>

<style scoped>
.sw.tag {
  width: auto;
  min-width: 28px;
}

.inline-sw {
  display: inline-flex;
  margin-left: 4px;
  vertical-align: middle;
}

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
