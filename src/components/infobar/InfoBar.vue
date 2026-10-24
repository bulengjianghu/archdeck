<script setup lang="ts">
/**
 * 顶部信息条（F-60–F-63）：提交版本、设计轮次、草图（设计的草图与持久草图）共用，分三区——
 * 身份（kind 标签 + 名称 + 状态 chip；名称只出现这一次）、动作（按模式，ActionZone）、对比（一个按钮弹层，CompareZone）。
 */
import { computed } from 'vue'
import { isCommitVersion, isIntentVersion, isSketchVersion } from '@/model'
import { useDesk } from '@/state/inject'
import { DESIGN_STATUS_LABELS, intentName } from '../shared/labels'
import ActionZone from './ActionZone.vue'
import CompareZone from './CompareZone.vue'

/** back：进入这个版本之前的地址（「退出」回到那里，#20b） */
defineProps<{ back?: string }>()
const desk = useDesk()
const v = desk.version
const mode = isCommitVersion(v) ? 'commit' : isSketchVersion(v) ? 'sketch' : 'round'
const KIND = { commit: '提交版本', round: '设计版本', sketch: '草图' } as const

const d = computed(() => desk.versions.design.value)
const r = computed(() => desk.versions.revision.value)
const c = computed(() => desk.versions.commit.value)
const latest = computed(() => !!d.value && d.value.revisions[d.value.revisions.length - 1]?.id === r.value?.id)

/** 身份：名称、名称的说明（title）、状态 chip */
const who = computed(() => {
  if (mode === 'commit') return { name: c.value?.short ?? '', title: [c.value?.hash, c.value?.subject].filter(Boolean).join('\n'), chip: c.value?.date }
  if (isIntentVersion(v)) return { name: intentName(v.intent), title: `持久草图 intent/${v.intent}.yaml：人拥有，可编辑；对比当前版本`, chip: '持久 · 人拥有' }
  const status = d.value ? DESIGN_STATUS_LABELS[d.value.status] : undefined
  if (mode === 'sketch') return { name: d.value?.name ?? '', title: '架构师画的局部描述：各轮按它展开，核验以它为尺子（X1–X4）', chip: status }
  return { name: d.value?.name ?? '', title: r.value?.date ? `${r.value.id} · ${r.value.date}` : '', chip: status }
})
const statusClass = computed(() => (mode === 'commit' || !d.value ? '' : d.value.status))
const ready = computed(() => (mode === 'commit' ? !!c.value : !!d.value || isIntentVersion(v)))
</script>

<template>
  <div v-if="ready" class="info-bar" :class="mode">
    <div class="zone who" aria-label="身份">
      <span class="kind">{{ KIND[mode] }}</span>
      <strong class="name" :class="{ mono: mode === 'commit' }" :title="who.title">{{ who.name }}</strong>
      <span v-if="mode === 'commit' && c?.subject" class="sub" :title="c.subject">{{ c.subject }}</span>
      <span v-if="mode === 'round' && r" class="chip rev" :title="latest ? '最新一轮' : '不是最新一轮'">{{ r.id }}{{ latest ? '' : ' · 非最新' }}</span>
      <span v-if="who.chip" class="chip" :class="statusClass">{{ who.chip }}</span>
      <template v-if="mode === 'sketch'">
        <span class="mount" title="草图挂载的位置（本轮草图还没有挂载点，整张挂在根上）"><span class="muted">挂在：</span>根</span>
        <span v-if="desk.edit.dirty.value" class="dirty" title="有未保存的改动">编辑中 ●</span>
      </template>
    </div>
    <ActionZone class="zone act" :mode="mode" :back="back" />
    <CompareZone class="zone cmp" :mode="mode" />
  </div>
</template>

<style scoped>
.info-bar {
  display: flex;
  align-items: stretch;
  min-height: 38px;
  font-size: 12.5px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.zone {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  min-width: 0;
}

.zone + .zone {
  border-left: 1px solid var(--border);
}

.who {
  flex: 1;
}

.kind {
  flex: none;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  padding: 0 6px;
  border-radius: 4px;
  border: 1px solid var(--border-strong);
  color: var(--text-2);
  background: var(--surface-2);
}

.round .kind {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.sketch .kind {
  color: var(--diff-changed);
  border-color: var(--diff-changed);
  background: var(--diff-changed-soft);
}

.name {
  font-size: 13.5px;
  min-width: 2em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.name.mono {
  font-family: var(--mono);
}

.sub {
  min-width: 0;
  max-width: 420px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip {
  flex: none;
  font-size: 11.5px;
  line-height: 18px;
  padding: 0 8px;
  border-radius: 10px;
  white-space: nowrap;
  color: var(--text-2);
  background: var(--surface-2);
}

.chip.rev {
  font-family: var(--mono);
}

.chip.draft {
  color: var(--diff-changed);
  background: var(--diff-changed-soft);
}

.chip.reviewing {
  color: var(--accent);
  background: var(--accent-soft);
}

.chip.accepted,
.chip.implemented {
  color: var(--diff-added);
  background: var(--diff-added-soft);
}

.mount {
  flex: none;
  white-space: nowrap;
  color: var(--text-2);
}

.dirty {
  flex: none;
  white-space: nowrap;
  color: var(--warning);
  font-weight: 600;
}

@media (width < 1100px) {
  .sub,
  .mount {
    display: none;
  }
}
</style>
