<script setup lang="ts">
/**
 * 依赖边面板的结构视图部分（结构视角选中束 `sel=d:<依赖方>-><被依赖方>` 时，A6、L21⑥，ADR-0031 修订）：
 * - 「文件依赖」：束内的元素级边按被依赖方的表面元素分组——元素名、种类、声明状态、该组的形态与档、文件依赖（文件:行）清单；
 *   整模块导入（namespace / 默认 / `*`，或被依赖方没有入口）一组；越过入口单列一组并带建议（经入口访问 / 提升到入口）；
 *   画布单击元素级边或元素时（surfaceFocus）滚到该元素的分组；
 * - 「交互覆盖」：覆盖这条束的交互（K17 明细，即以它为承载段的交互，L22 反向），单击切到交互视角并选中；另列事实覆盖；「未解释」标记；
 * - 「规则」（U15）与「稳定性」（U17）按束计。
 * 只读 desk.facts 的派生（structure.bundles / elementEdges、surfaceOf、metrics）。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { DEP_TIERS, moduleName, type Bundle, type DepTier, type ElementEdge, type FileDep, type SurfaceElement } from '@/model'
import { useDesk } from '@/state/inject'
import Section from './Section.vue'
import FileDepList from './FileDepList.vue'
import { DECL_STATE_LABEL, DEP_FORM_LABEL, DEP_TIER_LABEL, ELEMENT_KIND_LABEL, ELEMENT_KIND_MARK, STABILITY_LABEL } from '../display/labels'
import { revealIn, useSurfaceFocus } from './surfaceFocus'

const props = defineProps<{ from: string; to: string }>()
const desk = useDesk()
const idx = computed(() => desk.index.value!)
const name = (id: string) => moduleName(idx.value, id)

/** 本层这对节点同方向的束 */
const bundle = computed<Bundle | undefined>(() => {
  const sv = desk.facts.structure.value
  return sv?.facts ? sv.bundles.find(b => b.fromModule === props.from && b.toModule === props.to) : undefined
})
const edges = computed<ElementEdge[]>(() => {
  const b = bundle.value
  const sv = desk.facts.structure.value
  return b && sv?.facts ? sv.elementEdges.filter(e => e.bundle === b.id) : []
})

interface Group {
  /** 元素名；整模块 `*`，越过入口 `!` */
  key: string
  element: SurfaceElement | null
  bypass: boolean
  edges: ElementEdge[]
  files: FileDep[]
  tier: DepTier
}
const fileKey = (f: FileDep) => `${f.from}:${f.line}:${f.to}:${f.via}`
const strongest = (ts: DepTier[]) => DEP_TIERS.find(t => ts.includes(t)) ?? 'type'
/** A6：按元素分组，元素组在前（束内顺序），整模块其次，越过入口最后 */
const groups = computed<Group[]>(() => {
  const by = new Map<string, Group>()
  for (const e of edges.value) {
    const key = e.bypass ? '!' : (e.element?.name ?? '*')
    const g = by.get(key) ?? by.set(key, { key, element: e.element, bypass: !!e.bypass, edges: [], files: [], tier: e.tier }).get(key)!
    g.edges.push(e)
    const seen = new Set(g.files.map(fileKey))
    for (const f of e.files) if (!seen.has(fileKey(f))) g.files.push(f)
    g.tier = strongest(g.edges.map(x => x.tier))
  }
  const rank = (g: Group) => (g.bypass ? 2 : g.element ? 0 : 1)
  return [...by.values()].sort((a, b) => rank(a) - rank(b))
})
/** 越过入口组：被依赖方的入口与用到的符号（建议用） */
const entry = computed(() => (bundle.value ? (desk.facts.surfaceOf(bundle.value.toModule)?.entry ?? null) : null))
const symbolsOf = (g: Group) => [...new Set(g.files.flatMap(f => f.names ?? []))]

/** 覆盖它的关系较多时先列前 LIMIT 条 */
const LIMIT = 10
const allCover = ref(false)
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

/** C9、A6：画布单击元素或元素级边时滚到该元素的分组 */
const root = ref<HTMLElement | null>(null)
const focus = useSurfaceFocus()
function reveal() {
  const f = focus.value
  const b = bundle.value
  if (!f || !b) return
  const g = groups.value.find(x => x.key === f.element)
  if (!g || (f.module !== b.toModule && g.element?.module !== f.module)) return
  if (revealIn(root.value, f.element)) focus.value = null
}
onMounted(() => nextTick(reveal))
watch([focus, groups], () => nextTick(reveal))
</script>

<template>
  <div v-if="bundle" ref="root" class="dep-structure-wrap">
    <Section title="文件依赖" :count="bundle.files" class="dep-structure dep-files">
      <p class="sum">
        <b>{{ DEP_FORM_LABEL[bundle.form] }}</b>
        <span class="badge tier" :data-tier="bundle.tier">{{ DEP_TIER_LABEL[bundle.tier] }}</span>
        <span v-if="bundle.mixed" class="badge" :title="bundle.forms.map(f => DEP_FORM_LABEL[f]).join('、')">×{{ bundle.elements }} 元素</span>
        <span v-if="bundle.unexplained" class="badge bad" title="既没有交互覆盖、形态也不是端口实现 / 子类 / 组装（未解释的交互）">未解释</span>
        <span class="muted"> {{ bundle.elements }} 个元素 · 元素级边 {{ bundle.edges.length }} 条（线宽按这个数）· 模块依赖 {{ bundle.deps.length }} 条</span>
      </p>
      <ul class="plain groups">
        <li
          v-for="g in groups"
          :key="g.key"
          class="group"
          :class="{ bypass: g.bypass }"
          :data-element="g.key"
          :data-kind="g.element?.kind ?? (g.bypass ? 'bypass' : 'whole')"
        >
          <div class="g-head">
            <template v-if="g.element">
              <span class="el-mark" :data-kind="g.element.kind" aria-hidden="true">{{ ELEMENT_KIND_MARK[g.element.kind] }}</span>
              <code class="el-name">{{ g.element.name }}</code>
              <span class="muted">{{ ELEMENT_KIND_LABEL[g.element.kind] }}<template v-if="g.element.guessed">（按用法推断）</template></span>
              <span class="state" :data-state="g.element.state">{{ DECL_STATE_LABEL[g.element.state] }}</span>
            </template>
            <template v-else-if="g.bypass">
              <span class="badge warn">越过入口</span>
              <span class="muted">深层导入，接到模块本体</span>
            </template>
            <template v-else>
              <b>整模块</b>
              <span class="muted">namespace / 默认 / * 导入，或被依赖方没有入口</span>
            </template>
          </div>
          <div class="g-forms">
            <span v-for="e in g.edges" :key="e.id" class="form" :data-form="e.form"
              >{{ DEP_FORM_LABEL[e.form] }} · <span :data-tier="e.tier">{{ DEP_TIER_LABEL[e.tier] }}</span></span
            >
            <span class="muted">文件依赖 {{ g.files.length }} 条</span>
          </div>
          <FileDepList :deps="g.files" :limit="6" />
          <p v-if="g.bypass" class="advice muted">
            建议：经入口访问——改为从入口<template v-if="entry">
              <code>{{ entry }}</code></template
            >
            导入；或提升到入口——把<template v-if="symbolsOf(g).length">
              <code>{{ symbolsOf(g).join(', ') }}</code></template
            ><template v-else>用到的符号</template>加进入口导出
          </p>
        </li>
      </ul>
    </Section>

    <Section title="交互覆盖" :count="bundle.coverage.relations.length" class="dep-coverage">
      <p v-if="!bundle.coverage.relations.length" class="muted">
        <template v-if="bundle.unexplained">没有交互覆盖它：交互使用的依赖没有交互解释（未解释）</template>
        <template v-else>没有交互覆盖它：{{ bundle.tier === 'invokes' ? '由下面的结构事实覆盖' : '值使用或只引类型，正常的知识依赖' }}</template>
      </p>
      <ul v-else class="plain">
        <li v-for="r in allCover ? bundle.coverage.relations : bundle.coverage.relations.slice(0, LIMIT)" :key="r">
          <button class="link cover-rel" title="切到交互视角并选中这条关系" @click="showInteraction(r)">{{ relText(r) }}</button>
        </li>
        <li v-if="!allCover && bundle.coverage.relations.length > LIMIT">
          <button class="link more" @click="allCover = true">另 {{ bundle.coverage.relations.length - LIMIT }} 条，展开</button>
        </li>
      </ul>
      <p class="muted facts-cover">
        结构事实覆盖：端口实现者 {{ bundle.coverage.implementers }} · 子类 {{ bundle.coverage.subclass }} · 组装 {{ bundle.coverage.assembly }}
      </p>
    </Section>

    <Section title="规则" class="dep-ruling">
      <template v-if="bundle.ruling.verdict === 'violation'">
        <p>
          <span class="badge bad">违规</span> <span>{{ STATUS[bundle.ruling.status!] }}</span
          ><span class="muted"> · {{ bundle.ruling.violations.length }} 条，明细见下方「违规」</span>
        </p>
      </template>
      <template v-else-if="bundle.ruling.verdict === 'allowed'">
        <p class="muted">允许：约束这对模块的规则都通过了</p>
        <ul class="plain">
          <li v-for="b in bundle.ruling.allowedBy" :key="`${b.kind}:${b.at}`" class="rule">{{ b.text }}</li>
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
      <p v-if="bundle.againstStability" class="against" role="note">
        <span class="badge warn">逆稳定</span> 较稳定的一端依赖了更易变的一端；只是提示，不计违规
      </p>
    </Section>
  </div>
</template>

<style scoped>
.sum {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 6px;
  margin: 0 0 6px;
  font-size: 12.5px;
}

.groups .group {
  padding: 5px 0 6px;
  border-bottom: 1px dashed var(--border);
}

.groups .group:last-child {
  border-bottom: none;
}

.group.flash {
  animation: flash 1.2s ease-out;
}

@keyframes flash {
  from {
    background: var(--accent-soft);
  }
}

.g-head,
.g-forms {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  font-size: 12.5px;
}

.g-forms {
  font-size: 12px;
  color: var(--text-2);
}

.el-name {
  font-weight: 600;
}

.el-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  font-size: 10px;
  color: var(--text-2);
  border: 1px solid var(--border-strong);
  border-radius: 3px;
}

.el-mark[data-kind='port'] {
  border-radius: 50%;
}

.state {
  font-size: 11px;
  color: var(--text-3);
}

.state[data-state='exported-only'] {
  color: var(--warning);
}

.advice {
  margin: 2px 0 0;
  font-size: 12px;
}

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
