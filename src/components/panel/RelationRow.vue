<script setup lang="ts">
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { callbackText, isCallbackVia, moduleName } from '@/model'
import ChangeBadge from './ChangeBadge.vue'
import { RELATION_TYPE_LABELS } from '../shared/labels'

/** 一行关系：点击跳到它真实所在的层次并选中；perspective 给出时只显示对端；summary 时端点之下显示说明首句（V13，聚合边面板） */
const props = defineProps<{ id: string; perspective?: string; summary?: boolean }>()
const desk = useDesk()
const r = computed(() => desk.index.value?.relations.get(props.id))
const name = (id: string) => (desk.index.value ? moduleName(desk.index.value, id) : id)
const ifName = computed(() => (r.value?.interface ? desk.index.value?.interfaces.get(r.value.interface)?.name : undefined))
/** V13：说明首句——到第一个句号或换行，超过 SUMMARY_MAX 字截断加「…」 */
const SUMMARY_MAX = 60
const firstSentence = computed(() => {
  const d = r.value?.description?.trim()
  if (!props.summary || !d) return ''
  const cut = d.search(/[。\n]/)
  const s = cut >= 0 ? d.slice(0, cut + (d[cut] === '。' ? 1 : 0)) : d
  return s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX)}…` : s
})
/** L24：经回调的一条标「经回调」 */
const callback = computed(() => (r.value && desk.index.value && isCallbackVia(r.value.via) ? callbackText(desk.index.value, r.value.id) : null))
/** K5：有代码事实时标出证实 */
const fact = computed(() => desk.facts.report.value?.relations.get(props.id)?.status)
</script>

<template>
  <li v-if="r" class="rel-row">
    <button class="link" :title="r.description" @click="desk.revealRelation(r.id)">
      <template v-if="perspective === r.from">→ {{ name(r.to) }}</template>
      <template v-else-if="perspective === r.to">← {{ name(r.from) }}</template>
      <template v-else>{{ name(r.from) }} → {{ name(r.to) }}</template>
    </button>
    <ChangeBadge entity="relation" :id="r.id" />
    <span class="rel-chip" :class="`rel-${r.type}`" :title="r.type">{{ RELATION_TYPE_LABELS[r.type] }}</span>
    <span v-if="r.mode === 'async'" class="muted">异步</span>
    <code v-if="ifName" class="if">{{ ifName }}</code>
    <span v-if="callback" class="hook" :title="callback">回调</span>
    <span v-if="fact === 'confirmed'" class="fact ok" title="已被代码证实">✓</span>
    <span v-else-if="fact === 'unconfirmed'" class="fact" title="未被代码证实">?</span>
    <span v-if="firstSentence" class="summary" :title="r.description">{{ firstSentence }}</span>
  </li>
</template>

<style scoped>
.rel-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  padding: 3px 0;
}

.fact {
  font-size: 12px;
  color: var(--text-3);
}

.fact.ok {
  color: var(--success, var(--accent));
}

.if {
  font-size: 11.5px;
  color: var(--text-2);
}

.summary {
  flex-basis: 100%;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-2);
}

.hook {
  font-size: 11.5px;
  color: var(--text-2);
}
</style>
