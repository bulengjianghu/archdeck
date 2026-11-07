<script setup lang="ts">
/**
 * 模块的核对卡（PC-6–PC-8，V15b、V15c）：六行（证实、治理、表面、拆分、演化、确认）由 moduleCheckRows 定状态与结论，
 * 条目文字在这里按名称写好；清单为原 ③④⑤ 的证据节，折叠带计数、计数为 0 不出现。清单与计数全部来自现有派生，不新算。
 * 画布单击本模块的表面元素（C9）时展开核对卡，让「表面元素」清单去定位。
 */
import { computed, ref, watch } from 'vue'
import { useDesk } from '@/state/inject'
import { HOT_SURFACE_MODULES, moduleName } from '@/model'
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
import { moduleCheckRows, relationTypeLabel, type CheckItem } from './panelCheck'
import { useSurfaceFocus } from './surfaceFocus'
import { BASIS_CHANGE_TEXT, staleText } from '../shared/explainerText'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const idx = computed(() => desk.index.value!)
const m = computed(() => idx.value.modules.get(props.id)!)
const name = (id: string) => (idx.value.actors.get(id)?.name ?? moduleName(idx.value, id)) as string
const inside = (id: string) => !!idx.value.pathOf.get(id)?.includes(props.id)

const ready = computed(() => desk.facts.status.value === 'ready')
const detail = computed(() => (ready.value ? desk.facts.moduleDetail(props.id) : null))
const crossing = computed(() => desk.facts.collaborations(props.id).flatMap(c => c.relations))

/** 一条关系相对本模块的写法：「→ 对端（类型）」/「← 对端（类型）」 */
const relText = (rid: string) => {
  const r = idx.value.relations.get(rid)!
  const out = inside(r.from)
  return `${out ? '→' : '←'} ${name(out ? r.to : r.from)}（${relationTypeLabel(r.type)}）`
}

/** EX-7：本模块图解的依据状态（没有图解为 null） */
const explainer = computed(() => desk.explainers.status(props.id))
/** 确认行：徽标（已确认 / 需复核 / 未确认）只在范围内或已有记录时出现（ReviewSection 同口径） */
const reviewInScope = computed(() => idx.value.stratumOf.get(props.id)?.members.length === 1 || desk.review.scope.value.has(props.id))
const rows = computed(() => {
  const d = detail.value
  const unconfirmed: CheckItem[] = ready.value
    ? desk.facts.isolatedOf(props.id).map(rid => ({ text: `${relText(rid)}：代码里两端之间没有依赖`, relation: rid }))
    : []
  const undescribed: CheckItem[] = d
    ? [
        ...d.undescribed.out.map(x => ({ text: `→ ${name(x)}：代码有依赖，描述没写关系`, target: 'evidence.governance' })),
        ...d.undescribed.in.map(x => ({ text: `← ${name(x)}：代码有依赖，描述没写关系`, target: 'evidence.governance' })),
      ]
    : []
  const violations: CheckItem[] = d
    ? [
        ...d.violations.out.map(v => ({ text: `→ ${name(v.other)}：${v.reason}`, target: 'evidence.governance' })),
        ...d.violations.in.map(v => ({ text: `← ${name(v.other)}：${v.reason}`, target: 'evidence.governance' })),
      ]
    : []
  const cycles: CheckItem[] = d ? d.cycles.map(c => ({ text: `模块环：${c.map(name).join(' ↔ ')}`, target: 'evidence.governance' })) : []
  if (ready.value && desk.facts.selectedCycle.value) cycles.push({ text: '本层环：选中的节点在本层的环里', target: 'evidence.governance' })
  const against: CheckItem[] = ready.value
    ? desk.facts.againstOf(props.id).map(a => ({
        text: `→ ${name(a.module)}：依赖比自己更易变的模块（I ${a.hit.from.toFixed(2)} → ${a.hit.to.toFixed(2)}）`,
        target: 'boundary.structure',
      }))
    : []
  const sm = ready.value ? desk.facts.surfaceMetricsOf(props.id) : null
  const surface: CheckItem[] = sm
    ? [
        ...sm.bypasses.map(f => ({ text: `越过入口：${f.from}:${f.line} → ${f.via}`, target: 'boundary.surface' })),
        ...sm.uses
          .filter(u => u.element.state === 'exported-only' && u.modules.length >= HOT_SURFACE_MODULES)
          .map(u => ({ text: `热表面未声明：${u.element.name} 被 ${u.modules.length} 个模块使用`, target: 'boundary.surface' })),
      ]
    : []
  const s = desk.facts.splitOf(props.id)
  const long = desk.files.linesOf(props.id).long
  const split: CheckItem[] = []
  if (s) {
    const to = 'evidence.split'
    if (s.noFiles) split.push({ text: '不占任何文件：代码在别的模块的文件里', target: to })
    for (const x of s.shared)
      split.push({
        text: `与 ${x.modules
          .filter(y => y !== props.id)
          .map(name)
          .join('、')} 共用 ${x.file}`,
        target: to,
      })
    if (s.children.noFiles.length) split.push({ text: `${s.children.noFiles.length} 个子模块不占文件`, target: to })
    for (const x of s.children.shared) split.push({ text: `子模块 ${x.modules.map(name).join('、')} 共用 ${x.file}`, target: to })
    if (s.noDeps) split.push({ text: '子模块之间有交互、没有值依赖', target: to })
    else for (const x of s.undepended) split.push({ text: `${name(x.from)} 与 ${name(x.to)} 交互却没有值依赖`, target: to })
    if (long) split.push({ text: `${long} 个文件超过 ${desk.files.maxLines.value} 行`, target: 'evidence.source' })
  }
  // ST-1（ADR-0060）：子模块超过七个却没有声明分层——与代码事实无关的描述信号，单击跳到理解卡的「怎么分」
  const childCount = (desk.index.value?.childrenOf.get(props.id) ?? []).length
  if (childCount > 7 && !(desk.index.value?.strata.get(props.id) ?? []).length)
    split.push({ text: `${childCount} 个子模块未声明分层：归纳 2–5 个有原则的层，或记一条拆分信号（ST-1）`, target: 'split', hint: true })
  const ev = desk.evolution.moduleOf(props.id)
  const stats = desk.evolution.stats.value
  const st = desk.review.of(props.id)
  return moduleCheckRows({
    facts: ready.value && !!d,
    noFactsReason: { loading: '代码事实读取中', design: '设计版本没有代码事实', error: '没有代码事实（源码不可用）', ready: '没有代码事实' }[
      desk.facts.status.value
    ],
    relations: crossing.value.length,
    unconfirmed,
    undescribed,
    violations,
    cycles,
    against,
    surfaceWidth: sm?.w ?? null,
    surface,
    split,
    evolution: ev && stats && ev.changes ? { changes: ev.changes, fixes: ev.fixes, heat: Math.round(ev.heat), days: stats.days } : null,
    review: { status: st.status, date: st.entry?.at, changes: st.diff?.count, inScope: reviewInScope.value },
    ...(explainer.value?.stale ? { explainerStale: staleText(explainer.value) } : {}),
  })
})

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
