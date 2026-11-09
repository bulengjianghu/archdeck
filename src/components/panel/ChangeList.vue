<script setup lang="ts">
/** 变更清单（DV-4、E5）：相对对比基线的新增 / 修改 / 删除，按实体分组，可跳到所在层次；设计版本与提交版本共用 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import type { Change, EntityKind } from '@/model'
import Section from './Section.vue'
import ChangeBadge from './ChangeBadge.vue'

const desk = useDesk()
const diff = computed(() => desk.versions.diff.value)

const ENTITY_LABEL: Record<EntityKind, string> = { module: '模块', relation: '关系', interface: '接口', dataStructure: '数据结构' }
const groups = computed(() => {
  const changes = diff.value?.changes ?? []
  return (Object.keys(ENTITY_LABEL) as EntityKind[])
    .map(entity => ({ entity, label: ENTITY_LABEL[entity], items: changes.filter(c => c.entity === entity) }))
    .filter(g => g.items.length)
})

function reveal(c: Change) {
  if (c.kind === 'removed') return
  if (c.entity === 'module') desk.revealModule(c.id)
  else if (c.entity === 'relation') desk.revealRelation(c.id)
  else {
    // 接口 / 数据结构：跳到提供或持有它的模块
    const idx = desk.index.value!
    const owner =
      (c.entity === 'interface' ? idx.interfaces.get(c.id)?.owner : undefined) ??
      [...idx.modules.values()].find(m => (c.entity === 'interface' ? m.provides : m.dataStructures)?.includes(c.id))?.id
    if (owner) desk.revealModule(owner)
  }
}
</script>

<template>
  <Section :title="`变更清单（相对${desk.versions.baseline.value?.label ?? '基线'}）`" :count="diff?.changes.length ?? 0">
    <p v-if="!diff" class="muted">没有对比基线</p>
    <p v-else-if="!diff.changes.length" class="muted">没有变更</p>
    <div v-for="g in groups" :key="g.entity" class="group">
      <div class="sub">{{ g.label }} · {{ g.items.length }}</div>
      <ul class="plain">
        <li v-for="c in g.items" :key="c.id" class="change">
          <span v-if="c.kind === 'removed'" class="diff-tag removed">删除</span>
          <ChangeBadge v-else :entity="c.entity" :id="c.id" />
          <button v-if="c.kind !== 'removed'" class="link" @click="reveal(c)">{{ c.name }}</button>
          <span v-else class="removed-name">{{ c.name }}</span>
          <code class="id">{{ c.id }}</code>
        </li>
      </ul>
    </div>
  </Section>
</template>

<style scoped>
.group + .group {
  margin-top: 8px;
}

.sub {
  font-size: 12px;
  color: var(--text-3);
  margin-bottom: 2px;
}

.change {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 0;
}

.change .id {
  font-size: 11px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.removed-name {
  text-decoration: line-through;
  color: var(--text-3);
}
</style>
