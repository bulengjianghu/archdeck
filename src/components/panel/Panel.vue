<script setup lang="ts">
/** 属性面板：按选中对象的类型分派；无选中时显示当前父模块（根层显示系统） */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import ModulePanel from './ModulePanel.vue'
import RelationPanel from './RelationPanel.vue'
import EdgePanel from './EdgePanel.vue'
import SystemPanel from './SystemPanel.vue'
import ActorPanel from './ActorPanel.vue'

const desk = useDesk()
const target = computed(() => {
  const idx = desk.index.value
  const s = desk.selection.value
  if (!idx) return null
  if (s?.kind === 'module' && idx.modules.has(s.id)) return { kind: 'module' as const, id: s.id }
  if (s?.kind === 'relation' && idx.relations.has(s.id)) return { kind: 'relation' as const, id: s.id }
  if (s?.kind === 'edge') return { kind: 'edge' as const, id: s.id }
  if (s?.kind === 'actor' && idx.actors.has(s.id)) return { kind: 'actor' as const, id: s.id }
  const level = desk.levelId.value
  return level && level !== idx.rootId ? { kind: 'module' as const, id: level } : { kind: 'system' as const, id: idx.rootId }
})
</script>

<template>
  <div class="panel">
    <template v-if="target">
      <ModulePanel v-if="target.kind === 'module'" :id="target.id" :key="`m:${target.id}`" />
      <RelationPanel v-else-if="target.kind === 'relation'" :id="target.id" :key="`r:${target.id}`" />
      <EdgePanel v-else-if="target.kind === 'edge'" :id="target.id" :key="`e:${target.id}`" />
      <ActorPanel v-else-if="target.kind === 'actor'" :id="target.id" :key="`a:${target.id}`" />
      <SystemPanel v-else />
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
  padding: 12px 18px 0;
  font-size: 11.5px;
  border-top: 1px solid var(--border);
  word-break: break-all;
}
</style>
