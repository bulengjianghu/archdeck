<script setup lang="ts">
/** 校验与核验结果（P-6、L-1，X7f、X4）：面板顶部的即时校验（error 拒绝保存）与对当前版本的实时核验「实现后将有 N 处偏差」；单击一条定位到实体 */
import { computed } from 'vue'
import type { SketchValidationIssue } from '@/model'
import { useDesk } from '@/state/inject'

const desk = useDesk()
const e = desk.edit
const issues = computed<SketchValidationIssue[]>(() => [...(e.validation.value?.issues ?? []), ...e.serverIssues.value])
const errors = computed(() => issues.value.filter(i => i.severity === 'error'))
const warnings = computed(() => issues.value.filter(i => i.severity === 'warning'))
const check = computed(() => e.check.value)
const deviations = computed(() => (check.value ? check.value.counts.error + check.value.counts.warning : 0))

function go(i: SketchValidationIssue) {
  if (i.target.module && desk.index.value?.modules.has(i.target.module)) desk.revealModule(i.target.module)
  else if (i.target.relation && desk.index.value?.relations.has(i.target.relation)) desk.revealRelation(i.target.relation)
}
</script>

<template>
  <section class="checks">
    <p class="line" :class="errors.length ? 'bad' : 'good'" data-testid="edit-validation">
      {{ errors.length ? `校验：${errors.length} 个错误（不能保存）` : '校验通过' }}{{ warnings.length ? ` · ${warnings.length} 个提醒` : '' }}
    </p>
    <ul v-if="issues.length" class="issues">
      <li v-for="(i, n) in issues" :key="n" :class="i.severity">
        <button class="link" @click="go(i)">{{ i.message }}</button>
      </li>
    </ul>
    <p v-if="check" class="line" data-testid="edit-check" :title="`对当前版本核验草图（X4）：错误 ${check.counts.error} · 提醒 ${check.counts.warning}`">
      实现后将有 {{ deviations }} 处偏差<span class="muted">（对当前版本：错误 {{ check.counts.error }} · 提醒 {{ check.counts.warning }}）</span>
    </p>
  </section>
</template>

<style scoped>
.checks {
  padding: 10px 18px;
  border-bottom: 1px solid var(--border);
  font-size: 12.5px;
}

.line {
  margin: 0 0 4px;
}

.good {
  color: var(--diff-added);
}

.bad {
  color: var(--danger);
  font-weight: 600;
}

.issues {
  margin: 0 0 6px;
  padding-left: 16px;
}

.issues .error .link {
  color: var(--danger);
}

.issues .warning .link {
  color: var(--warning);
}

.muted {
  color: var(--text-3);
}
</style>
