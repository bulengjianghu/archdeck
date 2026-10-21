<script setup lang="ts">
/**
 * 信息卡（W-9）：悬停时序图的泳道头或消息片刻后在指针旁弹出摘要，移开即消失，不改变焦点；完整内容仍在面板。
 * 泳道：名称、类别、完整路径、所属层（P13）、职责第一句；消息：类型、两端、作用、输入与输出（F7）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName, type SequenceMessage, type SequenceParticipant } from '@/model'
import { KIND_LABEL, dataNames, firstSentence, nodeName, placeOf, stepOutput } from '../panel/runText'

export type CardTarget = { kind: 'lane'; participant: SequenceParticipant } | { kind: 'message'; message: SequenceMessage }

const props = defineProps<{ target: CardTarget; x: number; y: number }>()
const desk = useDesk()
const idx = computed(() => desk.index.value!)

const LANE_KIND = { module: '模块', boundary: '外部模块（本层之外）', actor: '外部参与者' } as const

const lane = computed(() => {
  if (props.target.kind !== 'lane') return null
  const p = props.target.participant
  if (p.kind === 'actor') {
    const a = idx.value.actors.get(p.id)
    return { name: p.name, kind: LANE_KIND.actor, path: '', layer: undefined, text: firstSentence(a?.description) }
  }
  const m = idx.value.modules.get(p.id)
  const place = placeOf(idx.value, p.id)
  return { name: p.name, kind: `${LANE_KIND[p.kind]}${m?.kind ? ` · ${m.kind}` : ''}`, ...place, text: firstSentence(m?.responsibility) }
})

const message = computed(() => {
  if (props.target.kind !== 'message') return null
  const m = props.target.message
  const plan = desk.plan.value
  const f = plan?.frames.get(m.frameIds[0])
  if (!f || !plan) return null
  const out = stepOutput(f, desk.pairs.value, plan.frames)
  const output =
    out.kind === 'pair'
      ? `${out.frame.label ?? '返回'}${out.frame.payload.length ? `（${dataNames(idx.value, out.frame.payload)}）` : ''}`
      : out.kind === 'reply'
        ? `回应：${out.frame.label ?? moduleName(idx.value, out.frame.to)}`
        : out.kind === 'async'
          ? '异步，不等待返回'
          : out.kind === 'implicit'
            ? '隐含返回（见接口签名）'
            : '—'
  return {
    kind: KIND_LABEL[m.kind] ?? m.kind,
    ends: m.kind === 'internal' ? `${nodeName(idx.value, m.from)} 内部` : `${nodeName(idx.value, m.from)} → ${nodeName(idx.value, m.to)}`,
    label: m.label,
    note: firstSentence(f.note),
    input: f.payload.length ? dataNames(idx.value, f.payload) : '—',
    output,
  }
})

/** 不超出窗口右侧与底部 */
const style = computed(() => ({ left: `${Math.min(props.x + 14, window.innerWidth - 320)}px`, top: `${Math.min(props.y + 14, window.innerHeight - 180)}px` }))
</script>

<template>
  <div v-if="lane || message" class="info-card" :style="style" role="tooltip">
    <template v-if="lane">
      <div class="title">{{ lane.name }}</div>
      <div class="meta">{{ lane.kind }}</div>
      <dl>
        <template v-if="lane.path"><dt>路径</dt><dd>{{ lane.path }}</dd></template>
        <template v-if="lane.layer"><dt>所属层</dt><dd>{{ lane.layer }}</dd></template>
        <template v-if="lane.text"><dt>职责</dt><dd>{{ lane.text }}</dd></template>
      </dl>
    </template>
    <template v-else-if="message">
      <div class="title">{{ message.label || message.ends }}</div>
      <div class="meta">{{ message.kind }} · {{ message.ends }}</div>
      <dl>
        <template v-if="message.note"><dt>作用</dt><dd>{{ message.note }}</dd></template>
        <dt>输入</dt>
        <dd>{{ message.input }}</dd>
        <dt>输出</dt>
        <dd>{{ message.output }}</dd>
      </dl>
    </template>
  </div>
</template>

<style scoped>
.info-card {
  position: fixed;
  z-index: 50;
  width: 300px;
  padding: 8px 10px;
  font-size: 12px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgb(0 0 0 / 18%);
  pointer-events: none;
}

.title {
  font-weight: 600;
  font-size: 13px;
}

.meta {
  color: var(--text-3);
  margin-top: 2px;
}

dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 8px;
  margin: 6px 0 0;
}

dt {
  color: var(--text-3);
}

dd {
  margin: 0;
  color: var(--text-2);
}
</style>
