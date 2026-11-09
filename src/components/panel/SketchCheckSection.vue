<script setup lang="ts">
/**
 * 设计面板的「草图核验」一节（DV-11、X3、X4）：本设计的草图对打开的这一轮的偏差清单；提醒级偏差可「认可偏差（写理由）」追加到 design.yaml 的 accepted；
 * 「归档 / 晋升」以当前版本的核验为准（由写入端点核验，不一致即拒绝）。草图版本下只说明。
 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import { SKETCH_DEVIATION_LABELS, isArchived } from '@/model'
import type { WriteOutcome } from '@/state/useDeskState'
import Section from './Section.vue'
import WriteForm from './WriteForm.vue'

const desk = useDesk()
const d = computed(() => desk.versions.design.value!)
const check = computed(() => desk.intent.current.value)
const verdict = computed(() => desk.intent.verdict.value)
const archived = computed(() => isArchived(d.value.status))
const SEV: Record<string, string> = { error: '错误', warning: '提醒', info: '已认可' }
const busy = ref(false)
const result = ref<WriteOutcome | null>(null)

async function archive() {
  if (busy.value) return
  busy.value = true
  result.value = await desk.write.archive()
  busy.value = false
}
const locate = (t: { modules?: string[]; relation?: string }) => {
  const idx = desk.index.value!
  if (t.relation && idx.relations.has(t.relation)) desk.revealRelation(t.relation)
  else {
    const m = t.modules?.find(x => idx.modules.has(x))
    if (m) desk.revealModule(m)
  }
}
</script>

<template>
  <Section v-if="desk.versions.sketch" title="草图核验">
    <p class="muted note">这是草图本身；核验在打开某一轮或当前版本时进行，偏差进问题页签。</p>
  </Section>
  <Section v-else-if="check" title="草图核验" :count="check.counts.error + check.counts.warning">
    <p v-if="check.consistent" class="ok">与草图一致{{ check.counts.info ? `（已认可 ${check.counts.info} 条提醒）` : '' }}。</p>
    <p v-else class="note">
      错误 {{ check.counts.error }} · 提醒 {{ check.counts.warning }}<template v-if="check.counts.info"> · 已认可 {{ check.counts.info }}</template
      >；错误由 AI 按草图改描述，提醒确有理由时可认可。
    </p>
    <ul class="plain devs">
      <li v-for="x in check.deviations" :key="x.key" class="dev" :class="x.severity">
        <span class="sev">{{ SEV[x.severity] }}</span>
        <span class="kind">{{ SKETCH_DEVIATION_LABELS[x.code] }}</span>
        <span class="msg">{{ x.message }}</span>
        <span v-if="x.accepted" class="muted">已认可：{{ x.accepted.reason }}{{ x.accepted.at ? `（${x.accepted.at}）` : '' }}</span>
        <span class="row">
          <button v-if="x.target.relation || x.target.modules?.length" class="link" @click="locate(x.target)">定位</button>
          <WriteForm
            v-if="x.severity === 'warning' && desk.write.canAccept"
            label="认可偏差（写理由）"
            placeholder="为什么这条偏差可以接受（追加到 design.yaml 的 accepted）"
            :submit="t => desk.write.accept(x.key, t)"
          />
        </span>
      </li>
    </ul>
    <div v-if="!archived" class="archive">
      <button
        :disabled="busy"
        :title="verdict?.ok ? '对当前版本核验一致后归档：一次性草图归档并写确认记录，声明 supersedes 的晋升替换持久草图（X3）' : (verdict?.reason ?? '')"
        @click="archive"
      >
        {{ busy ? '处理中…' : check.supersedes ? `晋升（替换 ${check.supersedes}）` : '归档' }}
      </button>
      <span class="muted small">以当前版本的核验为准；不一致会被拒绝</span>
      <p v-if="result?.ok" class="ok">
        已写入 <code>{{ result.file }}</code
        >{{ result.note ? `，${result.note}` : '' }}。
      </p>
      <p v-else-if="result" class="err">{{ result.error }}</p>
    </div>
    <p v-else class="muted note">设计已归档（{{ d.status }}），草图留在设计目录作为记录。</p>
  </Section>
</template>

<style scoped>
.note,
.small {
  font-size: 12px;
}

.devs {
  margin: 4px 0;
}

.dev {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  padding: 4px 0;
  border-left: 3px solid transparent;
  padding-left: 6px;
  font-size: 12.5px;
}

.dev.error {
  border-left-color: var(--danger);
}

.dev.warning {
  border-left-color: var(--warning);
}

.sev {
  font-weight: 600;
  color: var(--text-3);
}

.dev.error .sev {
  color: var(--danger);
}

.dev.warning .sev {
  color: var(--warning);
}

.kind {
  color: var(--text-2);
}

.msg {
  flex-basis: 100%;
}

.row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-basis: 100%;
}

.archive {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.ok {
  color: var(--diff-added);
}

.err {
  color: var(--danger);
}
</style>
