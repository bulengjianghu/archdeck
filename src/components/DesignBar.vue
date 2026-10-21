<script setup lang="ts">
/** 设计版本信息条：哪个设计、第几轮、状态；对比基线、变更计数、是否在图上标出变更（ADR-0002） */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { DESIGN_STATUS_LABELS } from '@/model'

const desk = useDesk()
const d = computed(() => desk.versions.design.value)
const r = computed(() => desk.versions.revision.value)
const counts = computed(() => desk.versions.diff.value?.counts)
const latest = computed(() => !!d.value && d.value.revisions[d.value.revisions.length - 1]?.id === r.value?.id)

function showDesignNotes() {
  const idx = desk.index.value
  if (idx) desk.goTo(idx.rootId, null)
}
</script>

<template>
  <div v-if="d && r" class="design-bar">
    <span class="kind">设计版本</span>
    <strong class="name">{{ d.name }}</strong>
    <span class="rev">{{ r.id }}{{ latest ? '' : '（非最新）' }}</span>
    <span class="status" :class="d.status">{{ DESIGN_STATUS_LABELS[d.status] }}</span>
    <span v-if="r.date" class="muted">{{ r.date }}</span>
    <button class="link" @click="showDesignNotes">设计说明与变更清单</button>

    <span class="spacer" />

    <label class="cmp">
      对比
      <select v-model="desk.toggles.compareTo">
        <option value="current">{{ desk.versions.baselines.value.current?.label ?? '当前版本' }}</option>
        <option v-if="desk.versions.baselines.value.previous" value="previous">上一轮（{{ desk.versions.baselines.value.previous.label }}）</option>
      </select>
    </label>
    <span v-if="counts" class="counts" :title="`相对${desk.versions.baseline.value?.label}`">
      <span class="diff-tag added">新增 {{ counts.added }}</span>
      <span class="diff-tag changed">修改 {{ counts.changed }}</span>
      <span class="diff-tag removed">删除 {{ counts.removed }}</span>
    </span>
    <label class="check"><input v-model="desk.toggles.showDiff" type="checkbox" /> 图上标出变更</label>
    <span v-if="desk.versions.drift.value" class="drift" title="设计起草后当前版本已按新代码重新生成，「相对当前版本」的变更可能包含代码本身的变化">
      ⚠ 基线已漂移
    </span>
  </div>
</template>

<style scoped>
.design-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  padding: 6px 14px;
  font-size: 12.5px;
  background: var(--diff-changed-soft);
  border-bottom: 1px solid var(--border);
}

.kind {
  font-size: 11px;
  font-weight: 600;
  color: var(--diff-changed);
  border: 1px solid var(--diff-changed);
  border-radius: 4px;
  padding: 0 5px;
}

.name {
  font-size: 13px;
}

.rev {
  font-family: var(--mono);
}

.status {
  font-size: 11px;
  padding: 0 7px;
  border-radius: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
}

.status.accepted,
.status.implemented {
  color: var(--diff-added);
  border-color: var(--diff-added);
}

.spacer {
  flex: 1;
}

.cmp,
.check {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-2);
  white-space: nowrap;
}

.cmp select {
  font-size: 12px;
}

.counts {
  display: flex;
  gap: 4px;
}

.drift {
  color: var(--warning);
  font-weight: 600;
}
</style>
