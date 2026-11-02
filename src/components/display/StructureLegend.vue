<script setup lang="ts">
/**
 * 图例 · 线（结构视角，L16、L19、L21，ADR-0031 修订，ADR-0058 按视觉通道组织）：只解码画布上有、且不是写字的记号——
 * - 形态 = 端点记号（子类、组装、端口实现、使用；全部虚线，ADR-0035）；
 * - 醒目度 = 明度与线宽（L43：例外深色加宽、骨架安静中灰）；
 * - 档：只有「只引类型」在画布上另有记号（浅色点线，L43），那一行就是开关（L45，ADR-0056：关着淡色常列、带收起条数，画布角留痕计数）；
 *   交互使用与值使用在画布上同画、靠悬停与面板区分，没有记号可解码，不列（ADR-0058 准入第一问）；
 * - 粗细（共享通道 L18，WidthRow）。
 * 束的概念（L21）、收起与例外的计数（B2、L42、L38）、表面 W 与越过入口（L20、C3）、表面元素四类与「+N」（ADR-0036）：
 * 前者是讲解进帮助（L51），其余是写字的角标或悬停 / 选中才画出的线，归脚注（TempLegend）。
 * 只看交互使用 / 只看未解释 / 总是展开表面没有自己的记号，在工具栏「显示 ▾」（L49）。没有代码事实时（U16）只说明允许边。
 * 图例按上下文显示（L47，G14）：只列本层静息态画出来的形态与醒目度（出现集合由 state/desk/legend 一处派生，与画布同一份 structureDisplay 过滤）。
 */
import { computed } from 'vue'
import { DEP_FORMS } from '@/model'
import { useDesk } from '@/state/inject'
import LegendToggle from './LegendToggle.vue'
import StructureSwatch from './StructureSwatch.vue'
import WidthRow from './WidthRow.vue'
import { useStructurePrefs } from './useDisplayPrefs'
import { ALLOWED_TEXT, DEP_FORM_HINT, DEP_FORM_LABEL, DEP_TIER_HINT, DEP_TIER_LABEL, FACTS_HINT } from './labels'

defineProps<{ presence: Set<string> }>()
const desk = useDesk()
const sp = useStructurePrefs(desk.project)

const facts = computed(() => desk.facts.status.value === 'ready' && !!desk.facts.structure.value?.facts)
const hint = computed(() => (desk.facts.status.value === 'ready' ? '' : FACTS_HINT[desk.facts.status.value]))

/** L45：只引类型的档行即开关；关着（缺省）时常列淡色，带收起的条数 */
const typeOnly = computed(() => sp.prefs.value.typeOnly)
const typeCount = computed(
  () =>
    desk.facts.structureDisplay({ typeOnly: false, invokesOnly: sp.prefs.value.invokesOnly, uncoveredOnly: sp.prefs.value.uncoveredOnly })?.hidden.type ?? 0,
)
const typeTitle = `${DEP_TIER_LABEL.type} = ${DEP_TIER_HINT.type}；单击画出（浅色点线），再单击收起，收起时画布角留痕计数`
</script>

<template>
  <section class="sec" aria-label="线">
    <div class="sec-title">线</div>
    <template v-if="facts">
      <div v-for="f in DEP_FORMS" v-show="presence.has(`struct:form:${f}`)" :key="f" class="item" :data-form="f">
        <span class="sw kind"><StructureSwatch :kind="f" /></span>
        <span
          >{{ DEP_FORM_LABEL[f] }}<span class="hint"> = {{ DEP_FORM_HINT[f] }}</span></span
        >
      </div>
      <div
        v-if="presence.has('struct:salience:exception')"
        class="item"
        data-testid="legend-salience-exception"
        title="例外 = 违规、向上、逆稳定、未解释的依赖：深色、加宽，最先看到（L43）"
      >
        <span class="sw kind"><StructureSwatch exception /></span>
        <span>深色加宽 = 例外</span>
      </div>
      <div
        v-if="presence.has('struct:salience:skeleton')"
        class="item"
        data-testid="legend-salience-skeleton"
        title="骨架 = 其余画出来的依赖：安静的中灰，线宽 = 条数；聚焦时其余变淡（L43）"
      >
        <span class="sw kind"><StructureSwatch /></span>
        <span>中灰 = 骨架</span>
      </div>
      <LegendToggle
        v-show="!typeOnly || presence.has('struct:tier:type')"
        :on="typeOnly"
        :label="DEP_TIER_LABEL.type"
        :title="typeTitle"
        data-tier="type"
        data-testid="type-only-count"
        @toggle="sp.setTypeOnly(!typeOnly)"
      >
        <template #swatch><StructureSwatch tier="type" /></template>
        · {{ typeCount }} 条{{ typeOnly ? '已显示' : '已收起' }}
      </LegendToggle>
      <WidthRow v-if="presence.has('shared:width')" />
    </template>
    <template v-else>
      <div class="item muted">{{ hint || '没有代码事实' }}</div>
      <div class="item">
        <span class="sw kind"><StructureSwatch kind="allowed" /></span>
        <span>{{ ALLOWED_TEXT }}；没有代码事实，只画允许依赖</span>
      </div>
    </template>
  </section>
</template>

<style scoped>
.sw.kind,
:deep(.toggle .sw) {
  width: 54px;
  justify-content: flex-start;
}

.hint {
  color: var(--text-3);
}
</style>
