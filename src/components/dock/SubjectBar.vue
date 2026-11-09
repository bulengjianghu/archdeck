<script setup lang="ts">
/**
 * 主语条（LY-7、LY-2）：视图区的页头，44px（含 1px 底线），与侧栏项目标题、画布页头底线对齐。
 * 一行：所在路径（灰）› 名称 + ID + 角色徽标；全页只这一处。右端收起视图区（LY-12）。只读主语、只发意图。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'
import { subjectLabel } from './subjectLabel'

const desk = useDesk()
const label = computed(() => {
  const idx = desk.index.value
  const s = desk.subject.value
  if (!idx || !s) return null
  const f = desk.run.frame.value
  const sc = desk.run.scenario.value
  const total = desk.run.scenarioView.value?.messages.length ?? 0
  const step =
    s.kind === 'step' && f && sc
      ? { scenario: sc.name, label: f.label || `${moduleName(idx, f.from)} → ${moduleName(idx, f.to)}`, position: `第 ${desk.run.walked.value} / ${total} 步` }
      : null
  return subjectLabel(idx, s, step)
})
const collapse = () => desk.workspace.dispatch({ type: 'setCollapsed', collapsed: true })
</script>

<template>
  <header class="subject" data-head="views" aria-label="主语">
    <div v-if="label" class="st" :title="[...label.path, label.name].join(' › ')">
      <span v-if="label.path.length" class="path">{{ label.path.join(' › ') }} ›</span>
      <b class="nm" data-testid="subject-name">{{ label.name }}</b>
      <code class="id">{{ label.id }}</code>
      <span v-if="label.badge" class="tag">{{ label.badge }}</span>
    </div>
    <span v-else class="st" />
    <button class="ib" title="收起视图区（专注地图）" aria-label="收起视图区" @click="collapse">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
    </button>
  </header>
</template>

<style scoped>
.subject {
  flex: none;
  box-sizing: border-box;
  height: var(--head-h, 44px);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px 0 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.st {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  overflow: hidden;
  white-space: nowrap;
}

.path {
  flex: none;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12.5px;
  color: var(--text-3);
}

.nm {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13.5px;
  font-weight: 600;
}

.id {
  flex: none;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--text-3);
}

.tag {
  flex: none;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11px;
  background: var(--surface-2);
  color: var(--text-2);
}

.ib {
  flex: none;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-3);
}

.ib:hover {
  background: var(--surface-2);
  color: var(--text);
}

.ib svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
}
</style>
