<script setup lang="ts">
/**
 * 依赖边面板的结构视图部分（结构视角选中 `sel=d:<依赖方>-><被依赖方>` 时，ADR-0031）：
 * 本层这对节点之间的结构边（desk.facts.structure）——种类与档、文件依赖条数与清单、聚合的模块依赖条数（K14、L16）；
 * 交互覆盖数与明细（覆盖它的关系可单击切到交互视角并选中，另列端口实现者 / 子类 / 组装的覆盖）、「未解释」标记（K17）；
 * 规则判定（违规含豁免，或允许它的规则，U15）；两端的不稳定度与「逆稳定」提示（U17）。
 */
import { computed } from 'vue'
import { contractNames, fileKinds, moduleName, type FileDep, type StructureEdge } from '@/model'
import { useDesk } from '@/state/inject'
import Section from './Section.vue'
import FileDepList from './FileDepList.vue'
import { DEP_TIER_LABEL, STABILITY_LABEL, STRUCTURE_KIND_LABEL } from '../display/labels'

const props = defineProps<{ from: string; to: string }>()
const desk = useDesk()
const idx = computed(() => desk.index.value!)
const name = (id: string) => moduleName(idx.value, id)

/** 本层这对节点同方向的结构边（依赖、组装、子类、端口实现各至多一条） */
const edges = computed<StructureEdge[]>(() => {
  const sv = desk.facts.structure.value
  return sv?.facts ? sv.edges.filter(e => e.fromModule === props.from && e.toModule === props.to) : []
})
const dependency = computed(() => edges.value.find(e => e.kind === 'dependency'))
/** 同一对节点的各种类共用一个判定（U15a） */
const ruling = computed(() => edges.value[0]?.ruling)
const moduleDeps = computed(() => new Set(edges.value.flatMap(e => e.deps)).size)

/** 归入一条结构边的文件依赖（按 K14 的种类筛） */
function filesOf(e: StructureEdge): FileDep[] {
  const r = desk.facts.report.value
  if (!r) return []
  const out: FileDep[] = []
  for (const k of e.deps) {
    const d = r.moduleDeps.get(k)
    if (!d) continue
    const ports = contractNames(idx.value, d.to)
    for (const f of d.files) if (fileKinds(f, ports).includes(e.kind)) out.push(f)
  }
  return out
}

const STATUS: Record<string, string> = { new: '新增', known: '已知', open: '违规（无基线）', allowed: '已豁免' }
const fmtI = (i: number | null | undefined) => (i == null ? '—' : i.toFixed(2))
const metric = (m: string) => desk.facts.metrics.value?.get(m)

/** K17：单击覆盖它的关系 → 切到交互视角并选中 */
function showInteraction(id: string) {
  desk.setMode('interaction')
  desk.select({ kind: 'relation', id })
}
const relText = (id: string) => {
  const r = idx.value.relations.get(id)
  return r ? `${name(r.from)} → ${name(r.to)}` : id
}
</script>

<template>
  <template v-if="edges.length">
    <Section title="结构边" :count="edges.length" class="dep-structure">
      <ul class="plain">
        <li v-for="e in edges" :key="e.id" class="edge-row" :data-kind="e.kind">
          <div>
            <b>{{ STRUCTURE_KIND_LABEL[e.kind] }}</b>
            <span v-if="e.tier" class="badge tier" :data-tier="e.tier">{{ DEP_TIER_LABEL[e.tier] }}</span>
            <span v-if="e.unexplained" class="badge bad" title="交互使用的依赖没有交互解释（未解释的交互）">未解释</span>
            <span class="muted"> 文件依赖 {{ e.files }} 条 · 模块依赖 {{ e.deps.length }} 条</span>
          </div>
          <details class="files">
            <summary class="muted">文件依赖清单</summary>
            <FileDepList :deps="filesOf(e)" :limit="8" />
          </details>
        </li>
      </ul>
      <p class="muted sum">聚合了 {{ moduleDeps }} 条模块依赖（线宽按这个数）</p>
    </Section>

    <Section v-if="dependency?.coverage" title="交互覆盖" :count="dependency.coverage.relations.length" class="dep-coverage">
      <p v-if="!dependency.coverage.relations.length" class="muted">
        <template v-if="dependency.unexplained">没有交互覆盖它：交互使用的依赖没有交互解释（未解释）</template>
        <template v-else>没有交互覆盖它：{{ dependency.tier === 'invokes' ? '由下面的结构事实覆盖' : '值使用或只引类型，正常的知识依赖' }}</template>
      </p>
      <ul v-else class="plain">
        <li v-for="r in dependency.coverage.relations" :key="r">
          <button class="link cover-rel" title="切到交互视角并选中这条关系" @click="showInteraction(r)">{{ relText(r) }}</button>
        </li>
      </ul>
      <p class="muted facts-cover">
        结构事实覆盖：端口实现者 {{ dependency.coverage.implementers }} · 子类 {{ dependency.coverage.subclass }} · 组装 {{ dependency.coverage.assembly }}
      </p>
    </Section>

    <Section v-if="ruling" title="规则" class="dep-ruling">
      <template v-if="ruling.verdict === 'violation'">
        <p>
          <span class="badge bad">违规</span> <span>{{ STATUS[ruling.status!] }}</span
          ><span class="muted"> · {{ ruling.violations.length }} 条，明细见下方「违规」</span>
        </p>
      </template>
      <template v-else-if="ruling.verdict === 'allowed'">
        <p class="muted">允许：约束这对模块的规则都通过了</p>
        <ul class="plain">
          <li v-for="b in ruling.allowedBy" :key="`${b.kind}:${b.at}`" class="rule">{{ b.text }}</li>
        </ul>
      </template>
      <p v-else class="muted">无约束：没有规则约束这对模块</p>
    </Section>

    <Section title="稳定性" class="dep-stability">
      <dl class="dims">
        <dt>{{ name(from) }}</dt>
        <dd>
          I {{ fmtI(metric(from)?.instability) }}
          <span v-if="metric(from)?.band" class="muted">{{ STABILITY_LABEL[metric(from)!.band!] }}</span>
        </dd>
        <dt>{{ name(to) }}</dt>
        <dd>
          I {{ fmtI(metric(to)?.instability) }}
          <span v-if="metric(to)?.band" class="muted">{{ STABILITY_LABEL[metric(to)!.band!] }}</span>
        </dd>
      </dl>
      <p v-if="dependency?.againstStability" class="against" role="note">
        <span class="badge warn">逆稳定</span> 较稳定的一端依赖了更易变的一端；只是提示，不计违规
      </p>
    </Section>
  </template>
</template>

<style scoped>
.edge-row {
  padding: 3px 0;
}

.tier {
  margin-left: 6px;
}

.files summary {
  cursor: pointer;
  font-size: 12px;
}

.sum,
.facts-cover {
  margin: 4px 0 0;
  font-size: 12px;
}

.rule {
  font-size: 12.5px;
  padding: 1px 0;
}

.dims {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 3px 10px;
  margin: 0;
}

.dims dt {
  color: var(--text-3);
}

.dims dd {
  margin: 0;
}

.against {
  margin: 6px 0 0;
  font-size: 12.5px;
}
</style>
