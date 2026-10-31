<script setup lang="ts">
/**
 * 图例（第十七轮 R4，ADR-0056；取代第十五轮的「显示」面板，ADR-0017 部分取代）：画布右上角，收起时一枚「图例 ▾」、展开为一张卡（L48）。
 * - 图例行即开关（L45）：同时有开关和画布记号的项（关系类型、代码事实、组装、演化热度、时间耦合、结构视角的只引类型）只留一行，
 *   单击切换，关着的行淡色常列；没有记号的设置在工具栏「显示 ▾」（L49）。隐藏画布内容的开关在画布角留痕计数（GraphCanvas 的 corner，L45）。
 * - 图例按视角整体替换、不混列（L19、D-26）：交互视角为关系、节点、代码事实、组装、演化；结构视角为「依赖 · 形态与档」、节点、规则叠加、指标与演化；
 *   运行视角为关系（只读）、节点与回放。共享通道（选中、变淡、违规、环、演化、线宽、线型、标签位）三处同文（SharedLegend，L18）。
 * - 图例按上下文显示（L47）：每一组只列当前视角 + 当前层次静息态画面出现的记号（出现集合由 state/desk/legend 一处派生，这里算一次往下传）；
 *   临时记号归各组尾部「临时可见」小节常列。教学内容（三问、四修饰）在帮助，关系组标题旁「?」过去（L51）。
 * - 收放按项目记在本机，第一次进入项目时展开；各组折叠按视角记（useDisplayPrefs，L48）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { createLegendPresence } from '@/state/desk/legend'
import { useDisplayPrefs } from './useDisplayPrefs'
import DisplayGroup from './DisplayGroup.vue'
import RelationLegend from './RelationLegend.vue'
import FactsLegend from './FactsLegend.vue'
import AssemblyLegend from './AssemblyLegend.vue'
import EvolutionLegend from './EvolutionLegend.vue'
import ReplayLegend from './ReplayLegend.vue'
import StructureLegend from './StructureLegend.vue'
import RuleLegend from './RuleLegend.vue'
import MetricLegend from './MetricLegend.vue'
import SharedLegend from './SharedLegend.vue'
import './legend.css'

const desk = useDesk()
const run = computed(() => desk.perspective.value === 'run')
/** 结构视角（ADR-0031）：图例整组换成结构视图的 */
const structure = computed(() => desk.perspective.value === 'structure')
const { open, groups, toggleOpen, toggleGroup, prefs } = useDisplayPrefs(desk.perspective, desk.project)
/** L47：图例的出现集合——按当前视角 + 层次的静息态画面算一次，各图例组只显隐行 */
const presence = createLegendPresence({
  state: desk.state,
  index: desk.index,
  view: desk.view,
  facts: desk.facts,
  evolution: desk.evolution,
  filter: prefs,
})
</script>

<template>
  <div class="display legend" :class="{ open }" role="region" aria-label="图例">
    <button class="head-btn" :aria-expanded="open" title="图例：记号怎么读；有开关的行单击切换显示" @click="toggleOpen">
      图例 <span class="caret">{{ open ? '▴' : '▾' }}</span>
    </button>

    <div v-if="open" class="body">
      <StructureLegend v-if="structure" :open="groups.struct" :presence="presence" @toggle="toggleGroup('struct')" />
      <RelationLegend v-else :run="run" :open="groups.rel" :presence="presence" @toggle="toggleGroup('rel')" />
      <DisplayGroup v-if="presence.has('node:module')" title="节点" :open="groups.node" @toggle="toggleGroup('node')">
        <div class="item inline">
          <span><span class="box" />模块</span>
          <span v-if="presence.has('node:drill')"><span class="box stack" />可下钻</span>
          <span v-if="presence.has('node:outer')"><span class="box dashed" />目标态 / 外部</span>
        </div>
      </DisplayGroup>
      <template v-if="structure">
        <RuleLegend :open="groups.rule" :presence="presence" @toggle="toggleGroup('rule')" />
        <MetricLegend :open="groups.metric" :presence="presence" @toggle="toggleGroup('metric')" />
      </template>
      <template v-else-if="!run">
        <FactsLegend :open="groups.facts" :presence="presence" @toggle="toggleGroup('facts')" />
        <AssemblyLegend :open="groups.asm" :presence="presence" @toggle="toggleGroup('asm')" />
      </template>
      <EvolutionLegend v-if="!run" :open="groups.evo" :presence="presence" @toggle="toggleGroup('evo')" />
      <ReplayLegend v-else :open="groups.play" @toggle="toggleGroup('play')" />
      <SharedLegend :open="groups.shared" :presence="presence" :structure="structure" @toggle="toggleGroup('shared')" />
    </div>
  </div>
</template>

<style scoped>
/* L48：在画布右上角那一列的顶端（GraphCanvas 的 .top-right），留痕与提示排在它下面 */
.legend {
  flex: 0 1 auto;
  min-height: 0;
  max-height: 50%;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  max-width: min(300px, 100%);
  font-size: 12px;
  color: var(--text);
  pointer-events: auto;
}

/* CD-1：收起时是一枚胶囊，展开的内容是它下面的一张卡（同一套卡片样式） */
.head-btn {
  flex: none;
  padding: 3px 12px;
  font: inherit;
  font-weight: 600;
  color: var(--text-2);
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--pill-radius);
  box-shadow: var(--card-shadow);
}

.legend.open .head-btn {
  margin-bottom: 6px;
}

.caret {
  font-size: 10px;
  color: var(--text-3);
}

/* L48：卡的高度上限为画布高度的一半（外层列 .top-right 高度确定，本组件 max-height: 50%），超出在卡内滚动 */
.body {
  width: min(270px, 100%);
  min-height: 0;
  overflow-y: auto;
  padding: 6px 10px 8px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
}
</style>
