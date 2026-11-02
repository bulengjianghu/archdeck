<script setup lang="ts">
/**
 * 图例 · 指标（结构视角，K16、L17；ADR-0058）：只解码节点上的两个记号——角标「入 Ca · 出 Ce」与左缘色条（不稳定度三档）。
 * 口径（扇入扇出的定义、I 的公式与阈值）在悬停，不占行。共用件折叠的「共用 ×N」是写字的角标、线悬停才画出（O13），归脚注。
 * 图例按上下文显示（L47，G14）：本层没有带角标的节点时整节不出现；没有代码事实时也不出现（原因在「线」一节写明）。
 */
import { computed } from 'vue'
import { STABILITY_BANDS } from '@/model'
import { useDesk } from '@/state/inject'
import { STABILITY_LABEL } from './labels'

const props = defineProps<{ presence: Set<string> }>()
const desk = useDesk()
const ready = computed(() => desk.facts.status.value === 'ready')
const show = computed(() => ready.value && (props.presence.has('metric:fan') || props.presence.has('metric:bands')))
const pct = (x: number) => x.toFixed(2)
const bandsTitle = `不稳定度 I = 出 ÷（入 + 出）：${STABILITY_LABEL.stable} I < ${pct(STABILITY_BANDS[0])}，${STABILITY_LABEL.unstable} I > ${pct(STABILITY_BANDS[1])}；I 高不等于坏`
</script>

<template>
  <section v-if="show" class="sec" aria-label="指标">
    <div class="sec-title">指标</div>
    <div v-if="presence.has('metric:fan')" class="item" title="扇入 / 扇出：依赖它的、它依赖的不同模块数（与层次无关）">
      <span class="sw kind"><span class="chip">入 3 · 出 5</span></span>
      <span>扇入 · 扇出</span>
    </div>
    <div v-if="presence.has('metric:bands')" class="item bands" aria-label="不稳定度三档" :title="bandsTitle">
      <span class="sw kind"><span class="bar stable" /><span class="bar balanced" /><span class="bar unstable" /></span>
      <span
        >不稳定度：<b class="t-stable">{{ STABILITY_LABEL.stable }}</b> · <b class="t-balanced">{{ STABILITY_LABEL.balanced }}</b> ·
        <b class="t-unstable">{{ STABILITY_LABEL.unstable }}</b></span
      >
    </div>
  </section>
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

.stable {
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
