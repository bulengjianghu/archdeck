<script setup lang="ts">
/**
 * 「显示」面板（W-2、ADR-0017；L45，第十五轮 G13）：画布右下角，分上「设置」下「图例」两块。
 * - 设置（NodeSettings 容器）：开关与筛选一律在这里、按对象分组——边界与现状、关系筛选（L8）、代码事实与组装（K9、O12）、
 *   结构筛选与表面（L21、L20）、演化（J5）、运行视角的交互关系显示方式（V8）；开关行标注它控制的画布记号。
 * - 图例只读（L45：一行不兼两职）：按画布上的对象分组（RelationLegend、节点、FactsLegend、EvolutionLegend、ReplayLegend），
 *   一行一项，左列为与画布同款的示意（LineSwatch，与 RouteEdge 共用 edgeStyle）、右列为文字；
 *   组标题旁标注对应开关（互指）。时序图的箭头约定不在这里，在副栏时序图标题栏的「图例」里。
 * - 图例按视角整体替换、不混列（L19、D-26）：交互视角为关系、代码事实、组装、演化各组；结构视角为「依赖 · 形态与档」、
 *   规则叠加、指标与共用件；运行视角为回放。共享通道（选中、变淡、违规、环、演化、线宽、线型、标签位）三处同文（SharedLegend，L18、ADR-0035）。
 * - 图例按上下文显示（L47，第十五轮 G14）：每一组只列当前视角 + 当前层次静息态画面出现的记号（出现集合由 state/desk/legend
 *   一处派生，这里算一次往下传），没出现的记号行不列；组结构与行序按固定词表、行只显隐不重排；临时（聚焦 / 悬停 / 回放才出现）
 *   记号归各组尾部固定的「临时可见」小节常列。
 * - 折叠时标题后摘要列出非默认的设置；面板展开与各组折叠按视角记在本机（useDisplayPrefs，运行视角默认只展开「回放」）。
 * - 隐藏画布内容的开关在画布角留痕计数、单击可撤销（GraphCanvas 的 corner，L45）。
 */
import { computed, watch } from 'vue'
import { RELATION_TYPES } from '@/model'
import { useDesk } from '@/state/inject'
import { createLegendPresence } from '@/state/desk/legend'
import { useStage } from './stage/useStageDisplay'
import { useDisplayPrefs } from './display/useDisplayPrefs'
import { HEAT_LABEL, MODE_LABEL } from './display/labels'
import NodeSettings from './display/NodeSettings.vue'
import DisplayGroup from './display/DisplayGroup.vue'
import RelationLegend from './display/RelationLegend.vue'
import FactsLegend from './display/FactsLegend.vue'
import AssemblyLegend from './display/AssemblyLegend.vue'
import EvolutionLegend from './display/EvolutionLegend.vue'
import ReplayLegend from './display/ReplayLegend.vue'
import StructureLegend from './display/StructureLegend.vue'
import RuleLegend from './display/RuleLegend.vue'
import MetricLegend from './display/MetricLegend.vue'
import SharedLegend from './display/SharedLegend.vue'
import './display/legend.css'

const desk = useDesk()
const stage = useStage()
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
/** E-2：编辑态下草图不对应代码——隐藏代码事实与演化两组；进入编辑态时收起面板，不挡住编辑落点 */
const editing = computed(() => desk.edit.active.value)
watch(editing, on => on && open.value && toggleOpen(), { immediate: true })

/** 折叠时的摘要：只列非默认的设置（设置块收编全部开关后照旧，W-2） */
const summary = computed(() => {
  const t = desk.toggles
  // 运行视角缺省折叠为一行：总是给出交互关系的显示方式（V8）
  if (run.value) return [`交互关系：${MODE_LABEL[stage.mode.value]}`]
  if (structure.value)
    return [
      t.showBoundaries ? '' : '无边界节点',
      t.currentOnly ? '只看现状' : '',
      prefs.value.typeOnly ? '只引类型已显示' : '',
      prefs.value.invokesOnly ? '只看交互使用' : '',
      prefs.value.uncoveredOnly ? '只看未解释' : '',
      prefs.value.surfaceAlways ? '总是展开表面' : '',
      t.heat === 'off' ? '' : `热度：${HEAT_LABEL[t.heat]}`,
      t.coupling ? '时间耦合' : '',
    ].filter(Boolean)
  const hidden = RELATION_TYPES.length - t.relationTypes.length
  return [
    hidden ? `隐藏 ${hidden} 类关系` : '',
    t.showBoundaries ? '' : '无边界节点',
    t.currentOnly ? '只看现状' : '',
    t.showFacts || desk.facts.status.value !== 'ready' ? '' : '代码事实已关',
    t.heat === 'off' ? '' : `热度：${HEAT_LABEL[t.heat]}`,
    t.coupling ? '时间耦合' : '',
    t.assembly ? '组装' : '',
  ].filter(Boolean)
})
</script>

<template>
  <div class="display" role="region" aria-label="显示">
    <button class="head-btn" :aria-expanded="open" @click="toggleOpen">
      <span class="title">显示</span><span class="caret">{{ open ? '▾' : '▸' }}</span>
      <span v-if="!open && summary.length" class="summary">{{ summary.join(' · ') }}</span>
    </button>

    <div v-if="open" class="body">
      <NodeSettings :run="run" :structure="structure" :editing="editing" />
      <div class="block-label">图例</div>
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
      <template v-else-if="!run && !editing">
        <FactsLegend :open="groups.facts" :presence="presence" @toggle="toggleGroup('facts')" />
        <AssemblyLegend :open="groups.asm" :presence="presence" @toggle="toggleGroup('asm')" />
      </template>
      <EvolutionLegend v-if="!run && !editing" :open="groups.evo" :presence="presence" @toggle="toggleGroup('evo')" />
      <ReplayLegend v-else :open="groups.play" @toggle="toggleGroup('play')" />
      <SharedLegend :open="groups.shared" :presence="presence" :structure="structure" @toggle="toggleGroup('shared')" />
    </div>
  </div>
</template>

<style scoped>
.display {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  min-width: 236px;
  max-width: 300px;
  /* 顶部留给画布右上角的提示与计数（只引类型、折叠提示），图例再长也不压住它们 */
  max-height: calc(100% - 72px);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 12px;
  color: var(--text);
}

.head-btn {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: 4px;
  border: none;
  background: none;
  padding: 5px 10px;
  font: inherit;
  text-align: left;
  color: var(--text-2);
}

.head-btn .title {
  font-weight: 600;
}

.caret {
  display: inline-block;
  width: 12px;
  font-size: 12px;
  line-height: 1;
  color: var(--text-3);
}

.summary {
  margin-left: 4px;
  color: var(--warning);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.body {
  overflow-y: auto;
  padding: 0 10px 8px;
}

.block-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: var(--text-3);
  min-height: 22px;
  display: flex;
  align-items: center;
}
</style>
