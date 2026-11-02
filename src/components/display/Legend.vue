<script setup lang="ts">
/**
 * 图例（第十七轮 R4，ADR-0056；第十八轮走查修订，ADR-0058）：画布右上角，收起时一枚「图例 ▾」、展开为一张卡（L48）。
 * - 正文按读者眼睛看到的视觉通道分节、不按工具内部的模块分组（ADR-0058）：线（颜色 = 类型 / 形态、粗细、箭头、线型）、节点、
 *   规则与指标（结构视角）、叠加（开关行，L45）、脚注「临时可见」（缺省折叠）。节只是一行标题、不再各自折叠；整卡的收放按项目记在本机（L48）。
 * - 每一行过准入三问才进正文（ADR-0058）：画布上写了字的记号不列（pill、角标里的词自己会说话，悬停有释义 L50）；此刻不在画面上的
 *   （悬停 / 选中 / 回放才出现）归脚注；讲解（定义、格式、行为、去哪看）进帮助（L51）与悬停。一行 = 一个记号 + 一个短语。
 * - 图例按视角整体替换、不混列（L19、D-26）：交互视角为线、节点、叠加、脚注；结构视角为线（形态与醒目度）、节点、规则、指标、叠加（演化）、脚注；
 *   运行视角为线（只读）、节点、脚注（回放的记号）。共享通道（L18）的行三处同位同文，不再单列一组。
 * - 图例按上下文显示（L47）：每节只列当前视角 + 当前层次静息态画面出现的记号（出现集合由 state/desk/legend 一处派生，这里算一次往下传）。
 * - 「怎么读一条线」的讲解在帮助，线一节标题旁的「?」过去（L51）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { createLegendPresence } from '@/state/desk/legend'
import { useDisplayPrefs } from './useDisplayPrefs'
import RelationLegend from './RelationLegend.vue'
import StructureLegend from './StructureLegend.vue'
import RuleLegend from './RuleLegend.vue'
import MetricLegend from './MetricLegend.vue'
import OverlayLegend from './OverlayLegend.vue'
import TempLegend from './TempLegend.vue'
import './legend.css'

const desk = useDesk()
const run = computed(() => desk.perspective.value === 'run')
/** 结构视角（ADR-0031）：「线」一节换成结构视图的 */
const structure = computed(() => desk.perspective.value === 'structure')
const { open, toggleOpen, prefs } = useDisplayPrefs(desk.project)
/** L47：图例的出现集合——按当前视角 + 层次的静息态画面算一次，各节只显隐行 */
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
      <StructureLegend v-if="structure" :presence="presence" />
      <RelationLegend v-else :run="run" :presence="presence" />
      <div v-if="presence.has('node:module')" class="reading-row nodes" aria-label="节点" data-testid="legend-nodes">
        <span class="dim">节点</span>
        <span class="pair"><span class="box" />模块</span>
        <span v-if="presence.has('node:drill')" class="pair"><span class="box stack" />可下钻</span>
        <span v-if="presence.has('node:outer')" class="pair"><span class="box dashed" />目标态 / 外部</span>
      </div>
      <template v-if="structure">
        <RuleLegend :presence="presence" />
        <MetricLegend :presence="presence" />
      </template>
      <OverlayLegend v-if="!run" :structure="structure" :presence="presence" />
      <TempLegend :run="run" :structure="structure" :presence="presence" />
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

.nodes {
  color: var(--text);
}
</style>
