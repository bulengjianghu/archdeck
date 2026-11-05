<script setup lang="ts">
/**
 * 提议卡（DA-8）：AI 改完一轮出一张——第几轮、动了哪几个号（可点：画布居中、改动页签滚到）、牵动谁（按当前描述估；全是新框标「新」）、
 * 「撤回本轮」（最近一轮 = 撤销；更早的按快照恢复，后面也碰过的先确认，CI-5）。没落时列原因。
 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import type { ProposalOutcome } from '@/state/desk/dialogue'

const props = defineProps<{ outcome: ProposalOutcome; busy?: boolean }>()
const desk = useDesk()
const changes = desk.edit.changes
const applied = computed(() => (props.outcome.applied ? props.outcome : null))
const reasons = computed(() => (props.outcome.applied ? [] : props.outcome.reasons))
const live = computed(() => !!applied.value && changes.rounds.value.find(r => r.n === applied.value!.round)?.state === 'live')
const note = ref('')
function show(n: number) {
  changes.focusItem(n)
  changes.revealItem(n)
}
function withdraw() {
  if (!applied.value) return
  const r = changes.withdrawRound(applied.value.round)
  note.value = !r.ok && r.reason && !changes.pending.value ? r.reason : ''
}
</script>

<template>
  <div class="card proposal" :class="{ rejected: !applied }" data-testid="proposal-card">
    <template v-if="applied">
      <p class="head">
        第 {{ applied.round }} 轮 · 动了
        <button
          v-for="n in applied.numbers"
          :key="n"
          class="num"
          data-testid="proposal-number"
          :title="changes.byNumber(n)?.summary ?? '已撤回'"
          :disabled="!changes.byNumber(n)"
          @click="show(n)"
        >
          #{{ n }}
        </button>
        <span v-if="!applied.numbers.length" class="muted">（没有留下改动项）</span>
      </p>
      <p class="impact" data-testid="proposal-impact">
        <template v-if="applied.impact.fresh">全是新框（新）</template>
        <template v-else>牵动 {{ applied.impact.modules }} 个模块 · 涉及 {{ applied.impact.scenarios }} 个场景</template>
        <span class="est">按当前描述估</span>
      </p>
      <p class="acts">
        <button class="link" data-testid="withdraw-round" :disabled="!live || busy || !!desk.edit.statusLock.value" @click="withdraw">
          {{ live ? '撤回本轮' : '本轮已撤回' }}
        </button>
        <span v-if="note" class="muted">{{ note }}</span>
      </p>
    </template>
    <template v-else>
      这一轮没落到草图上：
      <ul>
        <li v-for="(r, n) in reasons" :key="n">{{ r }}</li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.link:disabled {
  color: var(--text-3);
  cursor: not-allowed;
}

.card {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  font-size: 12.5px;
}
.card.rejected {
  border-color: var(--danger, #c44);
}
.head {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.num {
  padding: 0 6px;
  border-radius: 8px;
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11.5px;
  cursor: pointer;
}
.num:disabled {
  opacity: 0.5;
  text-decoration: line-through;
  cursor: default;
}
.impact {
  margin: 4px 0 0;
  color: var(--text-2);
}
.est {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 8px;
  font-size: 11px;
  border: 1px dashed var(--border);
  color: var(--text-3);
}
.acts {
  margin: 6px 0 0;
  display: flex;
  gap: 10px;
  align-items: center;
}
.muted {
  color: var(--text-3);
}
</style>
