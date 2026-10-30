<script setup lang="ts">
/**
 * 图例 · 代码事实（交互视角，K9、L26，ADR-0035）：第一行是开关行（L45，ADR-0056：图例行即开关），关闭时画布角留痕计数；
 * 开启后其余行说明代码事实写在标签位的词（未证实、违规、未解释、缺段）、本层环与承载叠加（L22）。
 * 线型（实线 = 交互、虚线 = 依赖）是共享通道，在「共享」组讲，这里只讲字。
 * - 图例按上下文显示（L47，G14）：只列本层静息态画面出现的异常词与环编号（出现集合由 state/desk/legend 一处派生）；
 *   缺段只在选中一条交互时出现（L22 承载叠加）——归尾部「临时可见」小节常列，不随出现显隐。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import DisplayGroup from './DisplayGroup.vue'
import LegendToggle from './LegendToggle.vue'
import LineSwatch from './LineSwatch.vue'
import { FACTS_HINT, FACT_TAG_HINT, TOGGLE_HINT, TOGGLE_LABEL } from './labels'

const props = defineProps<{ open: boolean; presence: Set<string> }>()
const emit = defineEmits<{ toggle: [] }>()
const desk = useDesk()

const ready = computed(() => desk.facts.status.value === 'ready')
const hint = computed(() => (ready.value ? '' : FACTS_HINT[desk.facts.status.value]))
/** L47：静息态画面出现的标签（缺段是选中交互才画的临时记号，在「临时可见」） */
const shown = computed(() => FACT_TAG_HINT.filter(t => t.tag !== '缺段' && props.presence.has(`facts:tag:${t.tag}`)))
const hasCycle = computed(() => props.presence.has('facts:cycle'))
const on = computed(() => ready.value && !!desk.toggles.showFacts)
const toggle = () => desk.setToggles({ showFacts: !desk.toggles.showFacts })
const nothing = computed(() => ready.value && !!desk.toggles.showFacts && !shown.value.length && !hasCycle.value)
</script>

<template>
  <DisplayGroup title="代码事实" :open="open" @toggle="emit('toggle')">
    <LegendToggle :on="on" :label="TOGGLE_LABEL.facts" :title="hint || TOGGLE_HINT.facts" :disabled="!ready" data-testid="toggle-facts" @toggle="toggle">
      <template #swatch><span class="tag-pill warn">?</span></template>
      {{ ready ? '只标异常，写在线中点的标签位' : `（${hint}）` }}
    </LegendToggle>
    <div v-if="on && nothing" class="item muted">本层没有要标的异常（已证实的不标）</div>
    <template v-else-if="on">
      <div v-for="t in shown" :key="t.tag" class="item" :data-tag="t.tag">
        <span class="sw tag"
          ><span class="tag-pill warn">{{ t.tag }}</span></span
        >
        <span
          >{{ t.text }}<span v-if="t.tag === '未解释'" class="inline-sw"><LineSwatch :look="{ temp: 'code' }" arrow="open" /></span
          ><span v-else-if="t.tag === '违规'" class="inline-sw"><LineSwatch :look="{ temp: 'code', violated: true }" arrow="open" /></span
        ></span>
      </div>
      <div v-if="hasCycle" class="item" data-tag="环">
        <span class="sw"><span class="cycle">↻N</span></span
        ><span>本层的环</span>
      </div>
      <!-- L47：临时可见——选中一条交互时承载叠加才画出的缺段（L22），常列、不随出现显隐 -->
      <div class="section-label">临时可见 · 选中交互时画出</div>
      <div class="item" data-testid="carrier-legend" data-tag="缺段">
        <span class="sw tag"><span class="tag-pill warn">缺段</span></span>
        <span
          >{{ FACT_TAG_HINT.find(t => t.tag === '缺段')!.text
          }}<span class="inline-sw"><LineSwatch :look="{ temp: 'carrier-gap' }" arrow="open" /></span>（承载叠加：关系面板「承载」一节列各段）</span
        >
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
</style>
