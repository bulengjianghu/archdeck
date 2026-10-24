<script setup lang="ts">
/**
 * 模块面板 · 结构（结构视角，ADR-0031）：
 * - K16：扇入 Ca、扇出 Ce、不稳定度 I 与三档，本层节点数另列，贡献最多的依赖方 / 被依赖方；
 * - K15：影响面 / 依赖面清单（按距离分组，列模块与文件数，缺省只展开距离 1），方向写显示偏好 impactMode，「只看值依赖」写 valuesOnly（画布同读）；
 * - U17：逆稳定方向的提示行（info）；
 * - K17：交互图互查——涉及本模块（含子树）、两端之间没有任何依赖的交互关系（K6），单击切到交互视角并选中它。
 * 没有代码事实（K8、U16）时只说明原因。
 */
import { computed, ref } from 'vue'
import { moduleName, type ImpactEntry } from '@/model'
import { useDesk } from '@/state/inject'
import Section from './Section.vue'
import { IMPACT_MODE_HINT, IMPACT_MODE_LABEL, STABILITY_LABEL } from '../display/labels'
import { useStructurePrefs, type ImpactMode } from '../display/useDisplayPrefs'
import { RELATION_TYPE_LABELS } from '../shared/labels'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const sp = useStructurePrefs(desk.project)
const impactMode = computed({ get: () => sp.prefs.value.impactMode, set: sp.setImpactMode })
const valuesOnly = computed({ get: () => sp.prefs.value.valuesOnly, set: sp.setValuesOnly })
const MODES: readonly ImpactMode[] = ['in', 'out', 'both']
/** 每组先列前 LIMIT 个，其余单击展开 */
const LIMIT = 15
const expanded = ref(new Set<string>())
const shownOf = (key: string, list: ImpactEntry[]) => (expanded.value.has(key) ? list : list.slice(0, LIMIT))
const expand = (key: string) => (expanded.value = new Set([...expanded.value, key]))

const idx = computed(() => desk.index.value!)
const name = (id: string) => moduleName(idx.value, id)
const ready = computed(() => desk.facts.status.value === 'ready')
const noFacts = computed(() =>
  desk.facts.status.value === 'loading'
    ? '正在提取代码依赖…'
    : desk.facts.status.value === 'design'
      ? '没有代码事实：设计版本与历史提交不对应当前代码'
      : '没有代码事实：读取源码或提取代码依赖失败',
)

const metrics = computed(() => desk.facts.metricsOf(props.id, valuesOnly.value))
const impact = computed(() => desk.facts.impactOf(props.id, valuesOnly.value))
const fmtI = (i: number | null) => (i === null ? '—' : i.toFixed(2))

/** 闭包内模块的文件数（归属可用时） */
const filesOf = (m: string) => (desk.files.ownership.value ? desk.files.filesOf(m).length : null)

interface Side {
  dir: 'in' | 'out'
  title: string
  modules: number
  nodes: number
  files: number | null
  groups: { label: string; list: ImpactEntry[] }[]
}
const sides = computed<Side[]>(() => {
  const i = impact.value
  if (!i) return []
  const dirs: ('in' | 'out')[] = impactMode.value === 'both' ? ['in', 'out'] : [impactMode.value]
  return dirs.map(dir => {
    const list = dir === 'in' ? i.impact.incoming : i.impact.outgoing
    const nodes = i.level ? [...i.level.values()].filter(x => x.direction === dir || x.direction === 'both').length : 0
    const by = (pred: (d: number) => boolean) => list.filter(e => pred(e.distance))
    return {
      dir,
      title: IMPACT_MODE_LABEL[dir],
      modules: list.length,
      nodes,
      files: i.impact.files ? i.impact.files[dir === 'in' ? 'incoming' : 'outgoing'] : null,
      groups: [
        { label: '距离 1', list: by(d => d === 1) },
        { label: '距离 2', list: by(d => d === 2) },
        { label: '距离 3+', list: by(d => d >= 3) },
      ].filter(g => g.list.length),
    }
  })
})

/** U17：本模块直接依赖的模块中、比它更易变超过阈值的（被依赖方是共用件不提示；desk.facts 派生） */
const against = computed(() => desk.facts.againstOf(props.id, valuesOnly.value))

/** K17：涉及本模块（含子树）、两端之间没有任何依赖的交互关系（K6；desk.facts 派生） */
const isolated = computed(() => (ready.value ? desk.facts.isolatedOf(props.id) : []))

/** K17：单击切到交互视角并选中这条关系（V11） */
function showInteraction(id: string) {
  desk.setMode('interaction')
  desk.select({ kind: 'relation', id })
}
const relText = (id: string) => {
  const r = idx.value.relations.get(id)!
  return `${name(r.from)} → ${name(r.to)}`
}
</script>

<template>
  <Section title="结构" class="module-structure">
    <p v-if="!ready" class="muted no-facts">{{ noFacts }}</p>
    <template v-else-if="metrics">
      <dl class="dims">
        <dt>扇入 Ca</dt>
        <dd>{{ metrics.ca }} <span class="muted">个模块依赖它</span></dd>
        <dt>扇出 Ce</dt>
        <dd>{{ metrics.ce }} <span class="muted">个它依赖的模块</span></dd>
        <dt>不稳定度 I</dt>
        <dd>
          {{ fmtI(metrics.instability) }}
          <span v-if="metrics.band" class="band" :class="`band-${metrics.band}`">{{ STABILITY_LABEL[metrics.band] }}</span>
          <span class="muted"> = 出 ÷（入 + 出）</span>
        </dd>
        <template v-if="metrics.level">
          <dt>本层节点</dt>
          <dd>入 {{ metrics.level.in }} · 出 {{ metrics.level.out }} <span class="muted">（投影到本层后的不同节点，与图上的线对得上）</span></dd>
        </template>
      </dl>
      <label class="check values-only" title="去掉只引类型的依赖重算指标与影响面（环仍只按值依赖）">
        <input v-model="valuesOnly" type="checkbox" /> 只看值依赖
      </label>

      <div v-if="metrics.topDependents.length || metrics.topDependencies.length" class="top">
        <div v-if="metrics.topDependents.length">
          <span class="muted">依赖它最多</span>
          <span v-for="t in metrics.topDependents" :key="t.module" class="top-item">
            <button class="link" @click="desk.revealModule(t.module)">{{ name(t.module) }}</button><span class="muted"> {{ t.files }} 处</span>
          </span>
        </div>
        <div v-if="metrics.topDependencies.length">
          <span class="muted">它依赖最多</span>
          <span v-for="t in metrics.topDependencies" :key="t.module" class="top-item">
            <button class="link" @click="desk.revealModule(t.module)">{{ name(t.module) }}</button><span class="muted"> {{ t.files }} 处</span>
          </span>
        </div>
      </div>

      <p v-if="against.length" class="against" role="note">
        <span class="badge warn">逆稳定</span>
        它（I {{ fmtI(metrics.instability) }}）依赖了更易变的
        <template v-for="(a, i) in against" :key="a.module"
          >{{ i ? '、' : '' }}<button class="link" @click="desk.revealModule(a.module)">{{ name(a.module) }}</button
          ><span class="muted">（I {{ fmtI(a.hit.to) }}）</span></template
        >；只是提示，不计违规
      </p>

      <div class="impact">
        <div class="impact-head">
          <span class="segmented" role="group" aria-label="影响面方向">
            <button
              v-for="m in MODES"
              :key="m"
              :class="{ on: impactMode === m }"
              :aria-pressed="impactMode === m"
              :title="IMPACT_MODE_HINT[m]"
              @click="impactMode = m"
            >
              {{ IMPACT_MODE_LABEL[m] }}
            </button>
          </span>
          <span v-if="impact?.impact.inCycle" class="badge bad" title="本模块在模块环中（只按值依赖）">在环中</span>
        </div>
        <div v-for="s in sides" :key="s.dir" class="side" :data-dir="s.dir">
          <div class="side-count">
            <b>{{ s.title }}</b>
            <span class="muted"
              >本层 {{ s.nodes }} 个节点 · 全系统 {{ s.modules }} 个模块<template v-if="s.files !== null"> · {{ s.files }} 个文件</template></span
            >
          </div>
          <p v-if="!s.groups.length" class="muted empty">{{ s.dir === 'in' ? '没有模块依赖它' : '它不依赖别的模块' }}</p>
          <details v-for="(g, gi) in s.groups" :key="g.label" class="dist" :open="gi === 0 && g.label === '距离 1'">
            <summary>
              {{ g.label }}<span class="muted"> · {{ g.list.length }}</span>
            </summary>
            <ul class="plain">
              <li v-for="e in shownOf(`${s.dir}:${g.label}`, g.list)" :key="e.module">
                <button class="link" @click="desk.revealModule(e.module)">{{ name(e.module) }}</button>
                <span v-if="filesOf(e.module) !== null" class="muted"> {{ filesOf(e.module) }} 个文件</span>
                <span v-if="e.inCycle" class="cyc" title="在模块环中">↻</span>
              </li>
              <li v-if="shownOf(`${s.dir}:${g.label}`, g.list).length < g.list.length">
                <button class="link more" @click="expand(`${s.dir}:${g.label}`)">另 {{ g.list.length - LIMIT }} 个，展开</button>
              </li>
            </ul>
          </details>
        </div>
      </div>

      <div class="cross" aria-label="交互图互查">
        <div class="cross-head">
          交互图互查<span class="muted"> · 有交互、两端之间没有任何依赖（{{ isolated.length }}）</span>
        </div>
        <p v-if="!isolated.length" class="muted empty">没有：涉及它的交互都有依赖撑着或不判定</p>
        <ul v-else class="plain">
          <li v-for="r in isolated" :key="r">
            <button class="link cross-item" title="切到交互视角并选中这条关系" @click="showInteraction(r)">{{ relText(r) }}</button>
            <span class="muted"> {{ RELATION_TYPE_LABELS[idx.relations.get(r)!.type] }} · 未证实</span>
          </li>
        </ul>
      </div>
    </template>
    <p v-else class="muted">这个模块没有指标（系统根不计）</p>
  </Section>
</template>

<style scoped>
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

.band {
  margin-left: 4px;
  padding: 0 6px;
  font-size: 11px;
  border-radius: 8px;
  border: 1px solid var(--border);
}

.band-stable {
  color: var(--stability-stable);
}

.band-unstable {
  color: var(--stability-unstable);
}

.values-only {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-2);
}

.top {
  margin-top: 6px;
  font-size: 12.5px;
}

.top-item {
  margin-left: 8px;
}

.against {
  margin: 6px 0 0;
  font-size: 12.5px;
}

.impact {
  margin-top: 10px;
}

.impact-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.segmented {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.segmented button {
  border: none;
  border-radius: 0;
  padding: 1px 10px;
  font-size: 12px;
  background: none;
}

.segmented button + button {
  border-left: 1px solid var(--border);
}

.segmented button.on {
  background: var(--accent-soft);
  color: var(--accent);
}

.side {
  margin-top: 6px;
}

.side-count {
  font-size: 12.5px;
}

.side-count b {
  margin-right: 6px;
}

.dist summary {
  cursor: pointer;
  font-size: 12.5px;
  padding: 2px 0;
}

.dist ul {
  padding-left: 14px;
  font-size: 12.5px;
}

.dist li .muted,
.top-item .muted {
  margin-left: 3px;
}

.cyc {
  margin-left: 4px;
  color: var(--danger);
}

.cross {
  margin-top: 10px;
  font-size: 12.5px;
}

.cross-head {
  font-weight: 600;
  color: var(--text-2);
}

.empty {
  margin: 2px 0;
  font-size: 12px;
}
</style>
