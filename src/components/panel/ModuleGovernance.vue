<script setup lang="ts">
/** 模块面板的「架构治理」一节（GV-7、GV-9、Q1）：生效的规则、出入的违规与未解释的交互、所在的模块环与本层环（Y5） */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { RULE_LABELS, moduleName, type LevelCycleEdge } from '@/model'
import Section from './Section.vue'
import FileDepList from './FileDepList.vue'

const props = defineProps<{ id: string; /** G11 V14c：⑤ 证据与细节缺省折叠（异常计数已在 ③） */ fold?: boolean }>()
const desk = useDesk()
const d = computed(() => desk.facts.moduleDetail(props.id))
const name = (id: string) => (desk.index.value ? moduleName(desk.index.value, id) : id)
const STATUS: Record<string, string> = { new: '新增', known: '已知', open: '', allowed: '已豁免' }
/** Y5：选中的节点在本层环中时（结构视角、「代码事实」开启） */
const cycle = computed(() => (desk.selection.value?.kind === 'module' && desk.selection.value.id === props.id ? desk.facts.selectedCycle.value : null))
/** 单击一条本层依赖：有同方向视图边时选中它，否则选中这对节点的代码依赖（K10） */
const pick = (e: LevelCycleEdge) => desk.select(e.edgeId ? { kind: 'edge', id: e.edgeId } : { kind: 'dep', id: `${e.fromModule}->${e.toModule}` })
const hasRules = computed(() => !!d.value && (d.value.rules.layers.length > 0 || d.value.rules.deps.length > 0 || d.value.rules.exposes.length > 0))
const empty = computed(
  () =>
    !!d.value &&
    !hasRules.value &&
    !d.value.violations.out.length &&
    !d.value.violations.in.length &&
    !d.value.undescribed.out.length &&
    !d.value.undescribed.in.length &&
    !d.value.cycles.length &&
    !cycle.value,
)
/** 折叠计数：异常条数（违规、未解释、环；V14b 的 ③ 已给同数，这里折叠必有计数 O11） */
const anomalyCount = computed(() =>
  d.value
    ? d.value.violations.out.length +
      d.value.violations.in.length +
      d.value.undescribed.out.length +
      d.value.undescribed.in.length +
      d.value.cycles.length +
      (cycle.value ? 1 : 0)
    : 0,
)
</script>

<template>
  <Section v-if="d && !empty" title="架构治理" :count="anomalyCount || undefined" :fold="props.fold">
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
      <h4>未解释的交互</h4>
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
    <div v-if="cycle" class="block level-cycle">
      <h4 class="bad">所在的本层环 ↻{{ cycle.id }}</h4>
      <p class="list">
        <span v-for="n in cycle.nodes" :key="n.id">{{ name(n.module) }}</span>
      </p>
      <ul class="plain">
        <li v-for="e in cycle.edges" :key="`${e.from}->${e.to}`">
          <details>
            <summary>
              <button class="link" :title="e.edgeId ? '在画布上选中这条边' : '选中这对节点的代码依赖'" @click.prevent="pick(e)">
                {{ name(e.fromModule) }} → {{ name(e.toModule) }}
              </button>
              <span class="muted small">{{ e.deps.length }} 条模块依赖</span>
            </summary>
            <ul class="plain deps">
              <li v-for="dep in e.deps" :key="dep.key">
                <div>
                  {{ name(dep.from) }} → {{ name(dep.to) }} <span class="muted small">{{ dep.files.length }} 处</span>
                </div>
                <FileDepList :deps="dep.files" :limit="4" />
              </li>
            </ul>
          </details>
        </li>
      </ul>
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

.level-cycle summary {
  cursor: pointer;
}

.level-cycle .deps {
  padding-left: 14px;
}
</style>
