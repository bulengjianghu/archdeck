<script setup lang="ts">
/** 模块面板的「架构治理」一节（GV-7、Q1）：生效的规则、出入的违规与未描述依赖、所在的模块环 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { RULE_LABELS, moduleName } from '@/model'
import Section from './Section.vue'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const d = computed(() => desk.facts.moduleDetail(props.id))
const name = (id: string) => (desk.index.value ? moduleName(desk.index.value, id) : id)
const STATUS: Record<string, string> = { new: '新增', known: '已知', open: '', allowed: '已豁免' }
const hasRules = computed(() => !!d.value && (d.value.rules.layers.length > 0 || d.value.rules.deps.length > 0 || d.value.rules.exposes.length > 0))
const empty = computed(
  () =>
    !!d.value &&
    !hasRules.value &&
    !d.value.violations.out.length &&
    !d.value.violations.in.length &&
    !d.value.undescribed.out.length &&
    !d.value.undescribed.in.length &&
    !d.value.cycles.length,
)
</script>

<template>
  <Section v-if="d && !empty" title="架构治理">
    <div v-if="hasRules" class="block">
      <h4>生效的规则</h4>
      <ul class="plain">
        <li v-for="l in d.rules.layers" :key="l.layer">所在层 {{ l.layer }} 只可依赖：{{ l.mayDependOn.join('、') || '无' }}</li>
        <li v-for="r in d.rules.deps" :key="r.module">
          {{ r.module }} 之外只许依赖：{{ r.mayDependOn.join('、') }}<span v-if="r.reason" class="muted">（{{ r.reason }}）</span>
        </li>
        <li v-for="e in d.rules.exposes" :key="e.module">
          外部访问 {{ e.module }} 只许经由：{{ e.exposes.map(x => (x === 'entry' ? `入口 ${e.entry ?? '（无）'}` : x)).join('、') }}
        </li>
      </ul>
    </div>
    <div v-if="d.violations.out.length || d.violations.in.length" class="block">
      <h4 class="bad">违规</h4>
      <ul class="plain">
        <li v-for="v in d.violations.out" :key="v.key">
          → <button class="link" @click="desk.revealModule(v.other)">{{ name(v.other) }}</button> <span class="chip">{{ RULE_LABELS[v.kind] }}</span
          ><span class="muted">{{ STATUS[v.status] }}</span>
          <div class="muted small">{{ v.example }}</div>
        </li>
        <li v-for="v in d.violations.in" :key="v.key">
          ← <button class="link" @click="desk.revealModule(v.other)">{{ name(v.other) }}</button> <span class="chip">{{ RULE_LABELS[v.kind] }}</span
          ><span class="muted">{{ STATUS[v.status] }}</span>
          <div class="muted small">{{ v.example }}</div>
        </li>
      </ul>
    </div>
    <div v-if="d.undescribed.out.length || d.undescribed.in.length" class="block">
      <h4>未描述的代码依赖</h4>
      <p class="list">
        <template v-for="m in d.undescribed.out" :key="`o:${m}`">
          <span
            >→ <button class="link" @click="desk.revealModule(m)">{{ name(m) }}</button></span
          >
        </template>
        <template v-for="m in d.undescribed.in" :key="`i:${m}`">
          <span
            >← <button class="link" @click="desk.revealModule(m)">{{ name(m) }}</button></span
          >
        </template>
      </p>
    </div>
    <div v-if="d.cycles.length" class="block">
      <h4 class="bad">所在的模块环</h4>
      <p v-for="(c, i) in d.cycles" :key="i" class="list">
        <button v-for="m in c" :key="m" class="link" @click="desk.revealModule(m)">{{ name(m) }}</button>
      </p>
    </div>
  </Section>
</template>

<style scoped>
.block + .block {
  margin-top: 8px;
}

h4 {
  margin: 0 0 2px;
  font-size: 12px;
  font-weight: 600;
}

.bad {
  color: var(--danger);
}

.chip {
  margin: 0 6px;
  padding: 0 6px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.small {
  font-size: 11.5px;
  word-break: break-all;
}

.list {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  margin: 0;
}

li {
  padding: 2px 0;
}
</style>
