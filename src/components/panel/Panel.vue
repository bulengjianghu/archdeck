<script setup lang="ts">
/**
 * 属性面板：按选中分派（V2，ADR-0012）。结构视角：选中的对象，无选中时为当前父模块（根层显示系统）；
 * 运行视角：选中步骤 → 步骤面板，选中场景 → 场景面板，其他对象 → 运行信息在上、结构信息折叠在下（V6）。
 * 代码依赖叠加线（K10）→ 代码依赖面板；耦合线（J7）→ 耦合面板。编辑态（X7）：换成编辑表单，仍按唯一的选中分派。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import ScenarioPanel from './ScenarioPanel.vue'
import StepPanel from './StepPanel.vue'
import RunSection from './RunSection.vue'
import ModulePanel from './ModulePanel.vue'
import RelationPanel from './RelationPanel.vue'
import EdgePanel from './EdgePanel.vue'
import SystemPanel from './SystemPanel.vue'
import ActorPanel from './ActorPanel.vue'
import EditPanel from '../edit/panel/EditPanel.vue'
import FilePanel from './FilePanel.vue'
import DepPanel from './DepPanel.vue'
import CouplePanel from './CouplePanel.vue'

const desk = useDesk()
const run = computed(() => desk.perspective.value === 'run')
const target = computed(() => {
  const idx = desk.index.value
  const s = desk.selected.value
  if (!idx) return null
  if (s?.kind === 'step') return desk.run.frame.value ? { kind: 'step' as const, id: s.id } : null
  if (s?.kind === 'scenario') return { kind: 'scenario' as const, id: s.id }
  if (s?.kind === 'module' && idx.modules.has(s.id)) return { kind: 'module' as const, id: s.id }
  if (s?.kind === 'relation' && idx.relations.has(s.id)) return { kind: 'relation' as const, id: s.id }
  if (s?.kind === 'edge') return { kind: 'edge' as const, id: s.id }
  if (s?.kind === 'actor' && idx.actors.has(s.id)) return { kind: 'actor' as const, id: s.id }
  if (s?.kind === 'file') return { kind: 'file' as const, id: s.id }
  if (s?.kind === 'dep') return { kind: 'dep' as const, id: s.id }
  if (s?.kind === 'couple') return { kind: 'couple' as const, id: s.id }
  const level = desk.levelId.value
  return level && level !== idx.rootId ? { kind: 'module' as const, id: level } : { kind: 'system' as const, id: idx.rootId }
})
</script>

<template>
  <div class="panel">
    <EditPanel v-if="desk.edit.active.value" />
    <template v-else-if="target">
      <StepPanel v-if="target.kind === 'step'" :key="`f:${target.id}`" />
      <ScenarioPanel v-else-if="target.kind === 'scenario'" :key="`s:${target.id}`" />
      <template v-else>
        <FilePanel v-if="target.kind === 'file'" :key="`f:${target.id}`" :path="target.id" />
        <DepPanel v-else-if="target.kind === 'dep'" :key="`d:${target.id}`" />
        <CouplePanel v-else-if="target.kind === 'couple'" :key="`c:${target.id}`" />
        <RunSection v-if="run && target.kind !== 'file' && target.kind !== 'dep' && target.kind !== 'couple'" />
        <component
          :is="run ? 'details' : 'div'"
          v-if="target.kind !== 'file' && target.kind !== 'dep' && target.kind !== 'couple'"
          class="structure"
          :open="run ? false : undefined"
        >
          <summary v-if="run" class="structure-head">结构信息</summary>
          <ModulePanel v-if="target.kind === 'module'" :id="target.id" :key="`m:${target.id}`" />
          <RelationPanel v-else-if="target.kind === 'relation'" :id="target.id" :key="`r:${target.id}`" />
          <EdgePanel v-else-if="target.kind === 'edge'" :id="target.id" :key="`e:${target.id}`" />
          <ActorPanel v-else-if="target.kind === 'actor'" :id="target.id" :key="`a:${target.id}`" />
          <SystemPanel v-else />
        </component>
      </template>
    </template>
  </div>
</template>

<style>
.panel {
  font-size: 13.5px;
  padding-bottom: 24px;
}

.panel .head {
  padding: 16px 18px 12px;
}

.panel h2 {
  margin: 0;
  font-size: 18px;
  line-height: 1.35;
}

.panel .title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.panel .drill,
.panel .small {
  font-size: 12px;
  padding: 1px 8px;
}

.panel .badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.panel .badges code {
  font-size: 11.5px;
  color: var(--text-3);
}

.panel .badge {
  font-size: 11px;
  padding: 0 7px;
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--text-2);
  border: 1px solid var(--border);
}

.panel .badge.accent {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: transparent;
}

.panel .badge.bad {
  background: var(--danger-soft, var(--warning-soft));
  color: var(--danger);
  border-color: transparent;
}

.panel button.badge.couple {
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.panel .badge.warn {
  background: var(--warning-soft);
  color: var(--warning);
  border-color: transparent;
}

.panel ul.plain {
  list-style: none;
  margin: 0;
  padding: 0;
}

.panel .item {
  border: 1px solid var(--border);
  border-radius: 6px;
  margin: 6px 0;
}

.panel .item summary {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 5px 10px;
  cursor: pointer;
}

.panel .item summary .name {
  font-weight: 600;
}

.panel .item summary .id {
  font-size: 11px;
  color: var(--text-3);
}

.panel .item .body {
  padding: 0 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.panel .item .meta,
.panel .item .sub {
  font-size: 12px;
  color: var(--text-3);
}

.panel .structure-head {
  padding: 10px 18px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3);
  cursor: pointer;
  border-top: 1px solid var(--border);
}

.panel .src {
  padding: 12px 18px 0;
  font-size: 11.5px;
  border-top: 1px solid var(--border);
  word-break: break-all;
}
</style>
