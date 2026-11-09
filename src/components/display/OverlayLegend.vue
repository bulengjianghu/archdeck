<script setup lang="ts">
/**
 * 图例 · 叠加（交互与结构视角；L45、ADR-0056、ADR-0058）：缺省不画、打开才叠到图上的四件事各一行开关——
 * 代码事实（K9，交互视角）、组装（O12，交互视角）、演化热度与时间耦合（J5，两个视角）。一行 = 勾选态 + 示意 + 名称，
 * 单击切换；说明与统计在悬停（TOGGLE_HINT），不占行；热度行后面带口径（修改 / 缺陷），口径在工具栏「显示 ▾」里选（L49）。
 * 开着时只解码画布上出现、且不是写字的记号（ADR-0058 准入三问）：红晕 = 违规、↻N = 本层的环（代码事实）；菱形虚线 = 组装；三档角标 = 热度。
 * 未证实 / 违规 / 未解释 / 组装根是写在线上、节点上的字（L26），不列——悬停有释义（L50）；缺段与波浪线是选中 / 悬停才出现的临时记号，归脚注。
 * 代码事实未就绪、没有演化事实时开关行置灰、写明原因（K8、J1）。开关都在视图状态里、不进 URL，按项目记在本机。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import LegendToggle from './LegendToggle.vue'
import LineSwatch from './LineSwatch.vue'
import { ASSEMBLY_LINE_TEXT, EVOLUTION_HINT, FACTS_HINT, HEAT_LABEL, SHARED_TEXT, TOGGLE_HINT, TOGGLE_LABEL } from './labels'
import { heatControls } from './useEvolutionPrefs'

const props = defineProps<{ structure: boolean; presence: Set<string> }>()
const desk = useDesk()
const heat = heatControls(desk.project ?? '', desk)
const NEUTRAL = 'var(--text-2)'

const factsReady = computed(() => desk.facts.status.value === 'ready')
const factsHint = computed(() => (factsReady.value ? '' : FACTS_HINT[desk.facts.status.value]))
const factsOn = computed(() => factsReady.value && !!desk.toggles.showFacts)
const asmOn = computed(() => factsReady.value && !!desk.toggles.assembly)

const evoReady = computed(() => desk.evolution.status.value === 'ready')
const evoHint = computed(() => {
  if (evoReady.value) return ''
  const st = desk.evolution.status.value
  return st === 'error' && desk.evolution.error.value ? `${EVOLUTION_HINT.error}：${desk.evolution.error.value}` : EVOLUTION_HINT[st]
})
const heatOn = computed(() => evoReady.value && desk.toggles.heat !== 'off')
const coupleOn = computed(() => evoReady.value && !!desk.toggles.coupling)
const coupleTitle = computed(() => {
  if (!evoReady.value) return evoHint.value
  const s = desk.evolution.stats.value
  return s ? `${TOGGLE_HINT.coupling}；近 ${s.days} 天 ${s.commits} 次提交` : TOGGLE_HINT.coupling
})
/** 代码事实开着时要解码的非文字记号：红晕（违规）、环编号——本层画面有才列 */
const factRows = computed(() => (factsOn.value ? ['facts:tag:违规', 'facts:cycle'].filter(k => props.presence.has(k)) : []))
</script>

<template>
  <section class="sec" aria-label="叠加">
    <div class="sec-title">叠加</div>
    <template v-if="!structure">
      <LegendToggle
        :on="factsOn"
        :label="TOGGLE_LABEL.facts"
        :title="factsHint || TOGGLE_HINT.facts"
        :disabled="!factsReady"
        data-testid="toggle-facts"
        @toggle="desk.setToggles({ showFacts: !desk.toggles.showFacts })"
      >
        <template #swatch><span class="tag-pill warn">?</span></template>
        <template v-if="!factsReady">（{{ factsHint }}）</template>
      </LegendToggle>
      <div v-if="factRows.includes('facts:tag:违规')" class="item sub" data-tag="违规">
        <span class="sw"><LineSwatch :color="NEUTRAL" halo /></span>
        <span>{{ SHARED_TEXT.violation }}</span>
      </div>
      <div v-if="factRows.includes('facts:cycle')" class="item sub" data-tag="环">
        <span class="sw"><span class="cycle">↻N</span></span>
        <span>{{ SHARED_TEXT.cycle }}</span>
      </div>

      <LegendToggle
        :on="asmOn"
        :label="TOGGLE_LABEL.assembly"
        :title="factsHint || TOGGLE_HINT.assembly"
        :disabled="!factsReady"
        data-testid="toggle-assembly"
        @toggle="desk.setToggles({ assembly: !desk.toggles.assembly })"
      >
        <template #swatch><LineSwatch :look="{ temp: 'assembly' }" arrow="open" /></template>
      </LegendToggle>
      <div v-if="asmOn && presence.has('asm:line')" class="item sub" data-testid="legend-assembly-line">
        <span class="sw"><LineSwatch :look="{ temp: 'assembly' }" arrow="open" /></span>
        <span>{{ ASSEMBLY_LINE_TEXT }}</span>
      </div>
    </template>

    <div v-if="!evoReady" class="item muted">{{ evoHint }}</div>
    <LegendToggle
      :on="heatOn"
      :label="TOGGLE_LABEL.heat"
      :title="evoHint || TOGGLE_HINT.heat"
      :disabled="!evoReady"
      data-testid="toggle-heat"
      @toggle="heat.toggle"
    >
      <template #swatch><span class="heat tier-3" /></template>
      · {{ HEAT_LABEL[heatOn ? desk.toggles.heat : heat.kind.value] }}
    </LegendToggle>
    <div v-if="heatOn && presence.has('evo:heat')" class="item inline sub" data-testid="legend-heat-tiers">
      <span><span class="heat tier-1" />低</span>
      <span><span class="heat tier-2" />中</span>
      <span><span class="heat tier-3" />高（本层分档）</span>
    </div>
    <LegendToggle
      :on="coupleOn"
      :label="TOGGLE_LABEL.coupling"
      :title="coupleTitle"
      :disabled="!evoReady"
      data-testid="toggle-coupling"
      @toggle="desk.setToggles({ coupling: !desk.toggles.coupling })"
    >
      <template #swatch><LineSwatch :look="{ temp: 'couple' }" /></template>
    </LegendToggle>
  </section>
</template>
