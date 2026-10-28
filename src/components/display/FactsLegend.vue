<script setup lang="ts">
/**
 * 「显示」面板 · 代码事实 · 标签（交互视角，K9、L26，ADR-0035）：开启后说明代码事实写在标签位的词（未证实、违规、未解释、缺段）、
 * 本层环与承载叠加（L22）。开关在设置块的「代码事实与组装」组（L45，第十五轮 G13 迁出），关闭时画布角留痕计数；组标题旁互指。
 * 线型（实线 = 交互、虚线 = 依赖）是共享通道，在「共享」组讲，这里只讲字。
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
      <span class="aside-note">开关在设置 · 代码事实</span>
    </template>
    <div v-if="!ready" class="item muted">{{ hint }}</div>
    <div v-else-if="!desk.toggles.showFacts" class="item muted">已关闭（画布角留痕计数）：打开后标出未证实、未解释的交互、违规与环</div>
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

.aside-note {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-3);
}
</style>
