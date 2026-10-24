<script setup lang="ts">
/**
 * 草图面板顶部（present.panel.sketch，F-45、F-46、F-34，X14、X16、X17）：两级校验——红色格式错误（拦保存）、黄色语义提示（拦交给 AI 与定稿）、
 * 灰色提示（超七、没写职责，不进两级）；常驻「待重连 N 条」可展开；本张的两个核验数「相对当前版本 N 处偏差」「相对基线 改了 N 处」可展开清单。
 * 点一条问题定位到对应的模块或关系。没有基线提交时说明相对基线退化为相对当前版本（05 裁决 3）；持久草图只有相对当前版本（偏差，与命令行 sketch-check 同一口径）。
 */
import { computed } from 'vue'
import type { SketchValidationIssue } from '@/model'
import { useDesk } from '@/state/inject'

const desk = useDesk()
const e = desk.edit
const v = computed(() => e.validation.value)
const errors = computed(() => v.value?.errors ?? [])
const warnings = computed(() => (v.value?.warnings ?? []).filter(w => w.code !== 'sketch.pending'))
const hints = computed(() => v.value?.hints ?? [])
/** X23：待分类（迁移期的 calls）只提示、不进两级 */
const unclassified = computed(() => hints.value.filter(x => x.code === 'sketch.unclassified').length)
const pending = computed(() => e.pending.value)
const name = (id: string) => e.nameOf(id) ?? id
const relText = (id: string) => {
  const r = e.lookup.relation(id)
  return r ? `${name(r.from)} → ${name(r.to)}（${r.type}）` : id
}
function locate(x: Pick<SketchValidationIssue, 'target'>) {
  if (x.target.relation) desk.select({ kind: 'relation', id: x.target.relation })
  else if (x.target.module) desk.select({ kind: 'module', id: x.target.module })
}
const vsCurrent = computed(() => e.vsCurrent.value?.sheet ?? null)
const vsBaseline = computed(() => e.vsBaseline.value?.sheet ?? null)
</script>

<template>
  <section class="skp-checks" data-testid="sketch-checks">
    <div v-if="errors.length" class="box err">
      <b>格式错误 {{ errors.length }}</b
      ><span class="why">（拦保存）</span>
      <ul>
        <li v-for="(x, i) in errors" :key="`e${i}`">
          <button class="link" @click="locate(x)">{{ x.message }}</button>
        </li>
      </ul>
    </div>
    <div v-if="warnings.length" class="box warn">
      <b>语义提示 {{ warnings.length }}</b
      ><span class="why">（拦交给 AI 与定稿，不拦保存）</span>
      <ul>
        <li v-for="(x, i) in warnings" :key="`w${i}`">
          <button class="link" @click="locate(x)">{{ x.message }}</button>
        </li>
      </ul>
    </div>
    <p v-if="v && !errors.length && !warnings.length && !pending.length" class="ok">本张校验通过</p>
    <details class="pending" :class="{ on: pending.length }" data-testid="sketch-pending">
      <summary>
        待重连 <b>{{ pending.length }}</b> 条<span v-if="pending.length" class="why">（语义提示：重连到本层模块或删除即消除）</span>
      </summary>
      <ul>
        <li v-for="id in pending" :key="id">
          <button class="link" @click="desk.select({ kind: 'relation', id })">{{ relText(id) }}</button>
        </li>
        <li v-if="!pending.length" class="muted">没有</li>
      </ul>
    </details>
    <details v-if="hints.length" class="hints">
      <summary>
        提示 {{ hints.length }}（不拦）<span v-if="unclassified" data-testid="sketch-unclassified"> · 待分类 {{ unclassified }}</span>
      </summary>
      <ul>
        <li v-for="(x, i) in hints" :key="`h${i}`">
          <button class="link" @click="locate(x)">{{ x.message }}</button>
        </li>
      </ul>
    </details>
    <p v-for="(x, i) in e.serverIssues.value" :key="`s${i}`" class="box err">服务端：{{ x.message }}</p>

    <div class="verify" data-testid="sketch-verify">
      <p class="cap">本张核验<span v-if="e.baselineFallback.value" class="fallback" title="05 裁决 3">（没有基线提交：相对基线按相对当前版本算）</span></p>
      <details data-testid="verify-current">
        <summary>
          相对当前版本：<b>{{ vsCurrent?.changes.length ?? 0 }}</b> 处偏差 <span class="tag">本张</span>
        </summary>
        <ul>
          <li v-for="(c, i) in vsCurrent?.changes ?? []" :key="i">{{ c.message }}</li>
          <li v-if="!vsCurrent?.changes.length" class="muted">0 偏差</li>
        </ul>
      </details>
      <details v-if="e.twoBases" data-testid="verify-baseline">
        <summary>
          相对基线：改了 <b>{{ vsBaseline?.changes.length ?? 0 }}</b> 处 <span class="tag">本张</span>
        </summary>
        <ul>
          <li v-for="(c, i) in vsBaseline?.changes ?? []" :key="i">{{ c.message }}</li>
          <li v-if="!vsBaseline?.changes.length" class="muted">未改动</li>
        </ul>
      </details>
    </div>
  </section>
</template>

<style scoped>
.skp-checks {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}

.box {
  margin: 0;
  padding: 6px 8px;
  border-radius: 6px;
}

.box ul,
details ul {
  margin: 4px 0 0;
  padding-left: 16px;
}

.box.err {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 8%, transparent);
}

.box.warn {
  color: var(--warning);
  background: var(--warning-soft);
}

.why {
  font-weight: normal;
  color: var(--text-3);
}

.ok {
  margin: 0;
  color: var(--diff-added);
}

.link {
  border: none;
  background: none;
  padding: 0;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font-size: 12px;
}

.link:hover {
  text-decoration: underline;
}

.pending summary,
.hints summary,
.verify summary {
  cursor: pointer;
}

.pending.on summary {
  color: var(--warning);
}

.hints {
  color: var(--text-3);
}

.verify {
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px dashed var(--border);
}

.cap {
  margin: 0 0 2px;
  color: var(--text-3);
}

.fallback {
  color: var(--warning);
}

.tag {
  padding: 0 4px;
  font-size: 10.5px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-3);
}

.muted {
  color: var(--text-3);
}
</style>
