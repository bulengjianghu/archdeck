<script setup lang="ts">
/**
 * 属性栏的内容：按选中分派（V2，ADR-0012），每种对象的面板都是「头部 + 理解 · 核对 · 相关资料三卡」（V15、PC-1，ADR-0053）。
 * 结构视角：选中的对象，无选中时为当前父模块（根层显示系统）；运行视角：选中步骤 → 步骤面板，选中场景 → 场景面板，
 * 其他对象的理解卡首节为运行信息（V6）。结构视角下模式切换映射不过去而被清空的选中（V12，droppedSelection）：顶部说明原选中没有对应的依赖边。
 * 代码依赖叠加线（K10）→ 代码依赖面板；耦合线（J7）→ 耦合面板；端口（L13）→ 端口面板（K11）。草图画布下（X7，ADR-0025）：换成草图面板。
 */
import { computed, provide } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'
import ScenarioPanel from './ScenarioPanel.vue'
import RunSection from './RunSection.vue'
import { RUN_FIRST } from './related'
import StepPanel from './StepPanel.vue'
import ModulePanel from './ModulePanel.vue'
import RelationPanel from './RelationPanel.vue'
import EdgePanel from './EdgePanel.vue'
import SystemPanel from './SystemPanel.vue'
import ActorPanel from './ActorPanel.vue'
import FilePanel from './FilePanel.vue'
import DepPanel from './DepPanel.vue'
import CouplePanel from './CouplePanel.vue'
import PortPanel from './PortPanel.vue'
import CyclePanel from './CyclePanel.vue'
import StratumPanel from './StratumPanel.vue'
import SketchPanel from '../sketch/SketchPanel.vue'

const desk = useDesk()
/** V12：切到结构视角时原选中（关系、视图边、端口）没有对应的依赖边，被清空 */
const dropped = computed(() => {
  const d = desk.droppedSelection.value
  const idx = desk.index.value
  if (!d || !idx || desk.perspective.value !== 'structure') return null
  if (d.kind === 'relation') {
    const r = idx.relations.get(d.id)
    return r ? `关系 ${moduleName(idx, r.from)} → ${moduleName(idx, r.to)}` : '关系'
  }
  if (d.kind === 'edge') return '交互边'
  if (d.kind === 'port') return `端口 ${idx.interfaces.get(d.id)?.name ?? d.id}`
  return '选中的对象'
})
/** V6：运行视角下模块、关系、聚合边、参与者、端口、系统的理解卡首节是运行信息（由这里注入，对象面板不引用它） */
const RUN_KINDS = new Set(['module', 'relation', 'edge', 'actor', 'port', 'system'])
provide(
  RUN_FIRST,
  computed(() => (desk.perspective.value === 'run' && target.value && RUN_KINDS.has(target.value.kind) ? RunSection : null)),
)
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
  if (s?.kind === 'port') return { kind: 'port' as const, id: s.id }
  if (s?.kind === 'cycle') return { kind: 'cycle' as const, id: s.id }
  if (s?.kind === 'stratum') return { kind: 'stratum' as const, id: s.id }
  const level = desk.levelId.value
  return level && level !== idx.rootId ? { kind: 'module' as const, id: level } : { kind: 'system' as const, id: idx.rootId }
})
</script>

<template>
  <div class="panel">
    <SketchPanel v-if="desk.edit.active.value" />
    <p v-if="dropped && !desk.edit.active.value" class="dropped" role="note">切换视角后原选中（{{ dropped }}）没有对应的依赖边，已取消选中</p>
    <template v-else-if="target">
      <StepPanel v-if="target.kind === 'step'" :key="`f:${target.id}`" />
      <ScenarioPanel v-else-if="target.kind === 'scenario'" :key="`s:${target.id}`" />
      <template v-else>
        <FilePanel v-if="target.kind === 'file'" :key="`f:${target.id}`" :path="target.id" />
        <DepPanel v-else-if="target.kind === 'dep'" :key="`d:${target.id}`" />
        <CouplePanel v-else-if="target.kind === 'couple'" :key="`c:${target.id}`" />
        <CyclePanel v-else-if="target.kind === 'cycle'" :id="target.id" :key="`y:${target.id}`" />
        <StratumPanel v-else-if="target.kind === 'stratum'" :id="target.id" :key="`s:${target.id}`" />
        <ModulePanel v-else-if="target.kind === 'module'" :id="target.id" :key="`m:${target.id}`" />
        <RelationPanel v-else-if="target.kind === 'relation'" :id="target.id" :key="`r:${target.id}`" />
        <EdgePanel v-else-if="target.kind === 'edge'" :id="target.id" :key="`e:${target.id}`" />
        <ActorPanel v-else-if="target.kind === 'actor'" :id="target.id" :key="`a:${target.id}`" />
        <PortPanel v-else-if="target.kind === 'port'" :id="target.id" :key="`p:${target.id}`" />
        <SystemPanel v-else />
      </template>
    </template>
  </div>
</template>

<style>
.panel .dropped {
  margin: 0;
  padding: 8px 18px;
  font-size: 12.5px;
  color: var(--warning);
  background: var(--warning-soft);
}

.panel {
  min-height: 100%;
  font-size: 13.5px;
  padding-bottom: 16px;
  background: var(--surface-2);
}

/* V15a：头部与属性栏头合并，粘在属性栏顶部；右上角留给属性栏的 ×（DeskView） */
.panel .head {
  position: sticky;
  top: 0;
  z-index: 5;
  padding: 8px 34px 6px 14px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.panel h2 {
  margin: 0;
  font-size: 16px;
  line-height: 1.35;
}

/* PC-1：卡片里的节去掉面板级的分隔与边距（清单是一行一个折叠标题） */
.panel .card .section {
  padding: 3px 0;
  border-top: 0;
}

.panel .card .section h3 {
  margin-bottom: 2px;
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

.panel .src {
  padding: 10px 14px 0;
  font-size: 11px;
  word-break: break-all;
}

/* ③「需要注意」行单击跳转到位时闪一次（V15b） */
.panel .jump-flash {
  animation: jump-flash 1.2s ease-out;
}

@keyframes jump-flash {
  from {
    background: var(--accent-soft);
  }
}
</style>
