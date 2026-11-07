<script setup lang="ts">
/**
 * 画布左上角的状态胶囊（TB-7–TB-9；第二十二轮 LY-5：面包屑移进画布页头）——⚠ 问题胶囊（单击打开「问题」资料标签，LY-4a）、源码胶囊（G22）、
 * 非当前版本时的版本胶囊（× 回到当前版本，N11；有未保存改动时由项目视图的离开确认三选，X7a）。「我在哪」贴着画布放（C6）。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isCommitVersion, isIntentVersion, isSketchVersion } from '@/model'
import { useDesk } from '@/state/inject'
import SourceDeltaChip from './source/SourceDeltaChip.vue'
import { intentName } from './shared/labels'

const emit = defineEmits<{ issues: [] }>()
const desk = useDesk()
const route = useRoute()
const router = useRouter()
const v = desk.version

const issueCount = computed(() => {
  const c = desk.rework.value?.counts
  return { errors: c?.error ?? 0, warnings: c?.warning ?? 0, total: (c?.error ?? 0) + (c?.warning ?? 0) }
})
/** G22、TB-8：只在当前版本下（提交 / 设计版本没有代码事实） */
const source = computed(() => {
  const p = desk.files.payload.value
  if (v || !p) return { delta: null, unavailable: null }
  return p.status === 'local' ? { delta: p.commitDelta ?? null, unavailable: null } : { delta: null, unavailable: p.reason }
})
/** TB-9：版本胶囊——种类图标与名称 */
const versionChip = computed(() => {
  if (!v) return null
  if (isCommitVersion(v)) {
    const c = desk.versions.commit.value
    return { label: `⎇ 提交 ${c?.short ?? v.commit.slice(0, 8)}`, title: [c?.hash ?? v.commit, c?.subject].filter(Boolean).join('\n') }
  }
  if (isIntentVersion(v)) return { label: `✎ ${intentName(v.intent)}`, title: `持久草图 intent/${v.intent}.yaml` }
  const name = desk.versions.design.value?.name ?? v.design
  if (isSketchVersion(v)) return { label: `✎ 草图 ${name}`, title: `设计「${name}」的草图` }
  return { label: `设计 ${name} · ${v.revision}`, title: `设计版本「${name}」的 ${v.revision}` }
})
const toCurrent = () => void router.push({ name: 'project', params: { project: desk.project! }, query: route.query })
</script>

<template>
  <div class="canvas-title">
    <button
      v-if="issueCount.total"
      class="canvas-chip issue-badge"
      :class="{ bad: issueCount.errors }"
      :title="`返工清单：${issueCount.errors} 个错误、${issueCount.warnings} 个提醒，单击在视图区打开「问题」`"
      @click="emit('issues')"
    >
      ⚠ {{ issueCount.total }}
    </button>
    <SourceDeltaChip :delta="source.delta" :unavailable="source.unavailable" />
    <span v-if="versionChip" class="canvas-chip version-chip" :title="versionChip.title" data-testid="version-chip">
      {{ versionChip.label }}
      <button class="x" title="回到当前版本" aria-label="回到当前版本" @click="toCurrent">×</button>
    </span>
  </div>
</template>

<style scoped>
.canvas-title {
  position: absolute;
  top: 10px;
  left: 12px;
  right: calc(12px + 140px);
  z-index: 6;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  pointer-events: none;
}

.canvas-title > * {
  pointer-events: auto;
}

.issue-badge {
  font-weight: 600;
  border-color: var(--warning);
  background: var(--warning-soft);
  color: var(--warning);
}

.issue-badge.bad {
  border-color: var(--danger);
  background: var(--danger-soft);
  color: var(--danger);
}

.version-chip {
  border-color: var(--diff-changed);
  background: var(--diff-changed-soft);
  color: var(--text);
  font-weight: 600;
  padding-right: 4px;
}

.x {
  border: none;
  background: none;
  padding: 0 4px;
  line-height: 1;
  color: var(--text-3);
}

.x:hover {
  color: var(--text);
}
</style>
