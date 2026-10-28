<script setup lang="ts">
/**
 * 人确认层的面板件（Z1、Z3、Z4，RV-3）：三块可分别放在模块面板的不同位置——
 * badge：标题旁的状态标记（已确认 <日期> / 需复核；未确认时只在范围内的模块上显示）；
 * diff：需复核时「自上次确认以来的改动」（职责按行、包含 / 不包含与可依赖的层按项、接口按 ID 增删改、子模块增删）；
 * confirm：底部「确认 / 复核并确认」，可填一句 note，有子模块时可勾「也确认子模块」；默认只对核心模块与第二级模块提供，
 * 范围外的模块只显示状态。设计版本与提交版本只显示状态（desk.review.canReview 为 false）。
 * 系统本身（id 为系统 ID，Z7）也用这三块：放在系统面板，指纹只覆盖简介，总提供确认；层也总提供确认（原则三级都能确认，ADR-0042），
 * 两者都不计入健康度（Z5 只数范围内的模块）。
 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import { REVIEW_FIELDS, REVIEW_FIELD_LABELS, REVIEW_STATUS_LABELS, type ReviewChange } from '@/model'
import type { WriteOutcome } from '@/state/useDeskState'
import Section from './Section.vue'

const props = defineProps<{ id: string; part: 'badge' | 'diff' | 'confirm'; /** G11 V15c：diff 与确认的明细缺省折叠（确认过期的计数在 ③） */ fold?: boolean }>()
const desk = useDesk()
const st = computed(() => desk.review.of(props.id))
const isSystem = computed(() => props.id === desk.index.value?.rootId)
const isLayer = computed(() => desk.index.value?.modules.get(props.id)?.kind === 'layer')
const inScope = computed(() => isSystem.value || isLayer.value || desk.review.scope.value.has(props.id))
const subtree = computed(() => desk.review.subtree(props.id))
const fields = computed(() => (st.value.diff ? REVIEW_FIELDS.filter(f => st.value.diff![f].length) : []))
const mark = (c: ReviewChange) => (c.kind === 'added' ? '+' : c.kind === 'removed' ? '−' : '≠')
const SOURCE = (s?: string) => (s === 'manual' ? '面板确认' : s?.startsWith('sketch:') ? `草图归档 ${s.slice(7)}` : (s ?? ''))
/** 确认只回答「AI 有没有动你看过的东西」，不担保描述与代码一致 */
const FACTS_NOTE = '已确认的内容与代码是否一致由代码事实判断'
const badgeTitle = computed(() => {
  const e = st.value.entry
  if (!e) return isSystem.value ? '架构师还没有确认过系统的定位与核心原则' : '架构师还没有确认过这个模块'
  const base = `${e.at} ${SOURCE(e.source)}${e.note ? `：${e.note}` : ''}`
  return st.value.status === 'reviewed' ? `${base}\n${FACTS_NOTE}` : base
})

const note = ref('')
const withChildren = ref(false)
const busy = ref(false)
const result = ref<WriteOutcome | null>(null)
async function confirm() {
  if (busy.value) return
  busy.value = true
  result.value = await desk.review.confirm(withChildren.value ? subtree.value : [props.id], note.value)
  busy.value = false
  if (result.value.ok) note.value = ''
}
</script>

<template>
  <span
    v-if="part === 'badge' && (st.status !== 'unreviewed' || inScope)"
    class="badge review"
    :class="{ accent: st.status === 'reviewed', warn: st.status === 'stale' }"
    :title="badgeTitle"
    >{{ st.status === 'reviewed' ? `已确认 ${st.entry!.at}` : REVIEW_STATUS_LABELS[st.status] }}</span
  >

  <Section v-else-if="part === 'diff' && st.status === 'stale'" title="自上次确认以来的改动" :count="st.diff?.count" :fold="props.fold">
    <p class="muted when">
      {{ st.entry!.at }} 确认（{{ SOURCE(st.entry!.source) }}）<template v-if="st.entry!.note">：{{ st.entry!.note }}</template>
    </p>
    <p v-if="!st.diff" class="muted">记录里没有确认时的摘要，列不出差异；复核后确认即记下现在的样子。</p>
    <dl v-else class="diff">
      <template v-for="f in fields" :key="f">
        <dt>{{ REVIEW_FIELD_LABELS[f] }}</dt>
        <dd>
          <div v-for="(c, i) in st.diff![f]" :key="i" class="change" :class="c.kind">
            <span class="mark">{{ mark(c) }}</span>
            <span class="text">
              <template v-if="f === 'provides'"
                ><code>{{ c.text }}</code>
                <template v-if="c.kind === 'changed'">
                  <span class="sig removed">{{ c.before || '（无签名）' }}</span> → <span class="sig added">{{ c.after || '（无签名）' }}</span>
                </template>
                <span v-else-if="c.before || c.after" class="sig">{{ c.before ?? c.after }}</span></template
              >
              <template v-else>{{ c.text }}</template>
            </span>
          </div>
        </dd>
      </template>
    </dl>
  </Section>

  <Section v-else-if="part === 'confirm' && desk.review.canReview && (inScope || st.status !== 'unreviewed')" title="确认" :fold="props.fold">
    <p class="muted hint">
      <template v-if="st.status === 'reviewed'">{{ st.entry!.at }} 确认过（{{ SOURCE(st.entry!.source) }}），内容没有变；再次确认会更新那一条记录。</template>
      <template v-else-if="st.status === 'stale'">看过上面的改动后点「复核并确认」，记录会更新为现在的内容。</template>
      <template v-else-if="isSystem">确认表示你看过并认可上面的定位与核心原则；AI 之后改了简介会标「需复核」。</template>
      <template v-else>确认表示你看过并认可它的职责、原则、接口与子模块；AI 之后改了这些会标「需复核」。</template>
    </p>
    <form class="confirm" @submit.prevent="confirm">
      <input v-model="note" placeholder="一句话（可选），如：确认只有转移函数能改状态" aria-label="确认说明" />
      <div class="row">
        <label v-if="subtree.length > 1" class="kids"
          ><input v-model="withChildren" type="checkbox" /> 也确认子模块（共 {{ subtree.length }} 个，各记一条）</label
        >
        <span class="spacer" />
        <button type="submit" class="primary" :disabled="busy">{{ busy ? '写入中…' : st.status === 'stale' ? '复核并确认' : '确认' }}</button>
      </div>
    </form>
    <p v-if="result?.ok" class="ok">
      已写入 <code>{{ result.file }}</code
      >，页面随之刷新。
    </p>
    <p v-else-if="result" class="err">{{ result.error }}</p>
  </Section>
</template>

<style scoped>
.when,
.hint {
  margin: 0 0 6px;
  font-size: 12px;
}

.diff {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin: 0;
  font-size: 12.5px;
}

.diff dt {
  color: var(--text-3);
}

.diff dd {
  margin: 0;
}

.change {
  display: flex;
  gap: 6px;
  align-items: baseline;
  padding: 1px 0;
}

.mark {
  flex: none;
  width: 1em;
  text-align: center;
  font-family: var(--mono);
}

.change.added .mark,
.sig.added {
  color: var(--diff-added);
}

.change.removed .mark,
.sig.removed {
  color: var(--diff-removed);
}

.change.changed .mark {
  color: var(--diff-changed);
}

.change.removed .text {
  text-decoration: line-through;
  color: var(--text-2);
}

.sig {
  font-family: var(--mono);
  font-size: 11.5px;
}

.confirm {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.confirm input[type='text'],
.confirm input:not([type]) {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.kids {
  display: flex;
  align-items: center;
  gap: 4px;
}

.spacer {
  flex: 1;
}

.row button {
  font-size: 11.5px;
  padding: 1px 8px;
}

.primary {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.ok {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--diff-added);
}

.err {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--danger);
}
</style>
