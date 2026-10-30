<script setup lang="ts">
/**
 * 图例 · 指标与共用件（结构视角，K16、L17、O13）：节点角标「入 Ca · 出 Ce」、左缘色条按不稳定度三档；
 * 共用件折叠（方案丙）：架上的共用件与使用者之间的依赖边默认不画，「共用 ×N」计依赖，悬停或选中画出，反向、违规、在环的照画。
 * 图例按上下文显示（L47，G14）：本层没有共用件折叠时「共用 ×N」行不列；没有代码事实时一行说明（出现集合由 state/desk/legend 一处派生）。
 */
import { computed } from 'vue'
import { STABILITY_BANDS } from '@/model'
import { useDesk } from '@/state/inject'
import DisplayGroup from './DisplayGroup.vue'
import { FACTS_HINT, STABILITY_LABEL } from './labels'

defineProps<{ open: boolean; presence: Set<string> }>()
const emit = defineEmits<{ toggle: [] }>()
const desk = useDesk()
const ready = computed(() => desk.facts.status.value === 'ready')
const pct = (x: number) => x.toFixed(2)
</script>

<template>
  <DisplayGroup title="指标 · 不稳定度与共用件" :open="open" @toggle="emit('toggle')">
    <div v-if="!ready" class="item muted">{{ FACTS_HINT[desk.facts.status.value] }}，没有指标</div>
    <template v-else>
      <div v-if="presence.has('metric:fan')" class="item">
        <span class="sw kind"><span class="chip">入 3 · 出 5</span></span>
        <span>扇入 / 扇出：依赖它的、它依赖的不同模块数（与层次无关）</span>
      </div>
      <div v-if="presence.has('metric:bands')" class="item bands" aria-label="不稳定度三档">
        <span class="sw kind"><span class="bar stable" /><span class="bar balanced" /><span class="bar unstable" /></span>
        <span
          >色条 = 不稳定度 I = 出 ÷（入 + 出）：<b class="t-stable">{{ STABILITY_LABEL.stable }}</b> I &lt; {{ pct(STABILITY_BANDS[0]) }} ·
          <b class="t-balanced">{{ STABILITY_LABEL.balanced }}</b> · <b class="t-unstable">{{ STABILITY_LABEL.unstable }}</b> I &gt;
          {{ pct(STABILITY_BANDS[1]) }}；I 高不等于坏</span
        >
      </div>
      <div v-if="presence.has('metric:shared')" class="item">
        <span class="sw kind"><span class="chip">共用 ×N</span></span>
        <span>共用件折叠：与架上共用件之间的依赖默认不画、角标计数，悬停或选中画出；反向、违规、在环的照画</span>
      </div>
      <div v-else-if="!presence.has('metric:fan') && !presence.has('metric:bands')" class="item muted">本层没有指标记号</div>
    </template>
  </DisplayGroup>
</template>

<style scoped>
.sw.kind {
  width: 54px;
  justify-content: flex-start;
  gap: 2px;
}

.bar {
  display: inline-block;
  width: 4px;
  height: 12px;
  border-radius: 1px;
}

.stable,
.t-stable {
  background: var(--stability-stable);
}

.balanced {
  background: var(--stability-mid);
}

.unstable {
  background: var(--stability-unstable);
}

.t-stable,
.t-balanced,
.t-unstable {
  background: none;
  font-weight: 600;
}

.t-stable {
  color: var(--stability-stable);
}

.t-balanced {
  color: var(--text-2);
}

.t-unstable {
  color: var(--stability-unstable);
}
</style>
