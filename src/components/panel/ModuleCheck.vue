<script setup lang="ts">
/**
 * 模块的核对卡（PC-6–PC-8，V15b、V15c）：六行（证实、治理、表面、拆分、演化、确认）由 moduleCheckRows 定状态与结论，
 * 条目文字在这里按名称写好；清单为原 ③④⑤ 的证据节，折叠带计数、计数为 0 不出现。清单与计数全部来自现有派生，不新算。
 * 画布单击本模块的表面元素（C9）时展开核对卡，让「表面元素」清单去定位。
 */
import { computed, ref, watch } from 'vue'
import { useDesk } from '@/state/inject'
import Markdown from './Markdown.vue'
import Section from './Section.vue'
import CheckCard from './CheckCard.vue'
import RelationRow from './RelationRow.vue'
import DataStructureItem from './DataStructureItem.vue'
import ModuleSource from './ModuleSource.vue'
import ModuleSplit from './ModuleSplit.vue'
import ModuleGovernance from './ModuleGovernance.vue'
import ModuleEvolution from './ModuleEvolution.vue'
import ModulePorts from './ModulePorts.vue'
import ModuleKnowledge from './ModuleKnowledge.vue'
import ModuleStructure from './ModuleStructure.vue'
import ModuleSurface from './ModuleSurface.vue'
import ModuleDecisions from './ModuleDecisions.vue'
import ReviewSection from './ReviewSection.vue'
import { moduleCheckRowsOf, moduleReviewInScope } from './checkRows'
import { useSurfaceFocus } from './surfaceFocus'
import { BASIS_CHANGE_TEXT } from '../shared/explainerText'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const idx = computed(() => desk.index.value!)
const m = computed(() => idx.value.modules.get(props.id)!)
const rows = computed(() => moduleCheckRowsOf(desk, props.id))
const crossing = computed(() => desk.facts.collaborations(props.id).flatMap(c => c.relations))
/** EX-7：本模块图解的依据状态（没有图解为 null） */
const explainer = computed(() => desk.explainers.status(props.id))
/** 确认行：徽标（已确认 / 需复核 / 未确认）只在范围内或已有记录时出现（ReviewSection 同口径） */
const reviewInScope = computed(() => moduleReviewInScope(desk, props.id))

// C9：画布单击本模块的表面元素时展开核对卡（「表面元素」清单收到后自己展开并定位）
const focus = useSurfaceFocus()
const force = ref(0)
watch(
  focus,
  f => {
    if (f?.module === props.id) force.value++
  },
  { immediate: true },
)

const refsCount = computed(() => (m.value.codeRefs?.length ?? 0) + (m.value.docRefs?.length ?? 0))
</script>

<template>
  <CheckCard :rows="rows" :force="force">
    <template #row-review="{ row }">
      <ReviewSection :id="id" part="badge" />
      <span v-if="row.state === 'bad' || (row.state === 'none' && !reviewInScope)"> {{ row.text }}</span>
    </template>
    <Section v-if="crossing.length" title="交互证据" fold :count="crossing.length" data-sec="evidence.relations">
      <ul class="plain">
        <RelationRow v-for="r in crossing" :key="r" :id="r" />
      </ul>
    </Section>
    <div data-sec="evidence.source"><ModuleSource :id="id" /></div>
    <ModuleEvolution :id="id" data-sec="evidence.evolution" />
    <template v-if="desk.viewpoint.value === 'structure'">
      <ModuleStructure :id="id" fold data-sec="boundary.structure" />
      <ModuleSurface :id="id" fold data-sec="boundary.surface" />
    </template>
    <ModulePorts :id="id" fold data-sec="boundary.ports" />
    <ModuleGovernance :id="id" fold data-sec="evidence.governance" />
    <ModuleSplit :id="id" fold data-sec="evidence.split" />
    <ModuleKnowledge :id="id" fold data-sec="evidence.knowledge" />
    <ModuleDecisions :id="id" fold data-sec="evidence.decisions" />
    <Section v-if="m.principle" title="实现原理" fold data-sec="evidence.principle"><Markdown :text="m.principle" /></Section>
    <Section v-if="m.dataStructures?.length" title="核心数据结构" fold :count="m.dataStructures.length" data-sec="evidence.data">
      <DataStructureItem v-for="x in m.dataStructures" :key="x" :id="x" :open="m.dataStructures.length <= 2" />
    </Section>
    <Section v-if="refsCount" title="代码与文档引用" fold :count="refsCount" data-sec="evidence.refs">
      <ul class="plain refs">
        <li v-for="c in m.codeRefs ?? []" :key="c">
          <code>{{ c }}</code>
        </li>
        <li v-for="x in m.docRefs ?? []" :key="x">
          <a v-if="/^https?:/.test(x)" :href="x" target="_blank" rel="noreferrer">{{ x }}</a>
          <span v-else>📄 {{ x }}</span>
        </li>
        <li v-if="m.owner" class="muted">负责人：{{ m.owner }}</li>
      </ul>
    </Section>
    <div data-sec="review.diff">
      <ReviewSection :id="id" part="diff" fold />
    </div>
    <Section v-if="explainer?.changes.length" title="图解依据的改动" fold :count="explainer.changes.length" data-sec="review.explainer">
      <ul class="plain">
        <li v-for="c in explainer.changes" :key="c.key" class="basis">
          <span class="kind">{{ BASIS_CHANGE_TEXT[c.kind] }}</span> {{ c.label }}
        </li>
      </ul>
    </Section>
    <ReviewSection :id="id" part="confirm" fold />
  </CheckCard>
</template>

<style scoped>
.basis {
  padding: 2px 0;
  font-size: 12.5px;
}

.basis .kind {
  display: inline-block;
  min-width: 1.4em;
  color: var(--warning);
}

.refs li {
  padding: 2px 0;
  font-size: 12.5px;
  word-break: break-all;
}
</style>
