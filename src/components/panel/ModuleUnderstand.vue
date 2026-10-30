<script setup lang="ts">
/**
 * 模块的理解卡（PC-3，R3.2、R3.3）：按五问，没有内容的问不出现——
 * ① 一句话职责（summaryOf，粗体，回退值标「待提炼」；职责全文折叠在下）② 怎么分（原则一句 + 各层或子模块，每个一句话；
 * 单成员层另有「包含 / 不包含」折叠块与「可依赖」链接行）③ 对外表面（接口名 + 一句用途，单击展开详情）④ 协作（ModuleCollab）
 * ⑤ 守住什么（不变式，带 ADR 链接）。不写画布已经表达的位置信息（C2）。运行视角下首节是运行信息（V6）。
 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import { collaborationsOf, firstSentence, invariantsOf, mayDependOnOf, stratumKey, summaryOf, truncateWidth, PURPOSE_LIMIT } from '@/model'
import Markdown from './Markdown.vue'
import InterfaceItem from './InterfaceItem.vue'
import ChangeBadge from './ChangeBadge.vue'
import ModuleCollab from './ModuleCollab.vue'
import RunSection from './RunSection.vue'
import { useOpenPreview } from '../shared/preview'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const openPreview = useOpenPreview()
const idx = computed(() => desk.index.value!)
const m = computed(() => idx.value.modules.get(props.id)!)
const summary = computed(() => summaryOf(m.value))
const fullOpen = ref(false)

// ── ② 怎么分 ──
const stratum = computed(() => idx.value.stratumOf.get(props.id) ?? null)
const isLayer = computed(() => stratum.value?.members.length === 1)
const principle = computed(() => m.value.abstraction ?? (isLayer.value ? stratum.value?.abstraction : undefined))
const ownStrata = computed(() => idx.value.strata.get(props.id) ?? [])
const children = computed(() => (idx.value.childrenOf.get(props.id) ?? []).map(id => idx.value.modules.get(id)!))
const CHILDREN_CAP = 6
const childrenOpen = ref(false)
const childrenShown = computed(() => (childrenOpen.value ? children.value : children.value.slice(0, CHILDREN_CAP)))
const layerDeps = computed(() => {
  const s = stratum.value
  if (!s || !isLayer.value) return []
  const list = idx.value.strata.get(s.parent) ?? []
  return (mayDependOnOf(s) ?? []).map(d => list.find(x => x.id === d)).filter((x): x is NonNullable<typeof x> => !!x)
})
const pickStratum = (x: { parent: string; id: string; members: string[] }) =>
  x.members.length === 1 ? desk.select({ kind: 'module', id: x.members[0] }) : desk.select({ kind: 'stratum', id: stratumKey(idx.value, x) })
const isCurrentLevel = computed(() => desk.levelId.value === props.id)
const openChild = (childId: string) =>
  isCurrentLevel.value ? desk.select({ kind: 'module', id: childId }) : desk.goTo(props.id, { kind: 'module', id: childId })
const childSummary = (id: string) => summaryOf(idx.value.modules.get(id)!)
const inc = computed(() => ({ yes: m.value.includes ?? [], no: m.value.excludes ?? [] }))
const hasSplit = computed(() => !!principle.value || ownStrata.value.length > 0 || children.value.length > 0 || isLayer.value)

// ── ③ 对外表面 ──
const provides = computed(() => m.value.provides ?? [])
const IFACE_CAP = 5
const ifaceOpen = ref(false)
const ifaceShown = computed(() => (ifaceOpen.value ? provides.value : provides.value.slice(0, IFACE_CAP)))
const detail = ref<string | null>(null)
const iface = (id: string) => idx.value.interfaces.get(id)
const use = (id: string) => {
  const d = iface(id)?.description
  return d ? truncateWidth(firstSentence(d), PURPOSE_LIMIT) : ''
}
const isPort = (id: string) => !!desk.facts.portOf(id)?.isPort

const hasCollab = computed(() => collaborationsOf(idx.value, props.id).length > 0)

// ── ⑤ 守住什么 ──
const invariants = computed(() => invariantsOf(m.value).map(x => ({ ...x, link: x.adr !== undefined ? desk.files.adrLink(x.adr) : null })))
const run = computed(() => desk.perspective.value === 'run')
</script>

<template>
  <div class="understand" data-sec="understand">
    <RunSection v-if="run" class="run-first" />
    <!-- ① 一句话职责 -->
    <div class="one" data-sec="purpose">
      <p v-if="summary" class="summary" data-testid="summary">
        {{ summary.text }}<span v-if="summary.pending" class="pending" title="描述没有写 summary：取自职责首句截断（M30）">待提炼</span>
        <button
          v-if="m.responsibility && !(summary && !summary.pending && summary.text === m.responsibility.trim())"
          class="link full"
          :aria-expanded="fullOpen"
          title="职责全文"
          @click="fullOpen = !fullOpen"
        >
          {{ fullOpen ? '收起全文' : '全文 ▸' }}
        </button>
      </p>
      <p v-else class="muted">职责未填写</p>
      <Markdown v-if="fullOpen" class="full-text" :text="m.responsibility" />
    </div>

    <!-- ② 怎么分 -->
    <div v-if="hasSplit" class="q-block" data-sec="split">
      <h4 class="q">怎么分</h4>
      <p v-if="principle" class="principle" :title="principle"><span class="label">原则</span>{{ principle }}</p>
      <ul v-if="ownStrata.length" class="parts" data-testid="module-strata">
        <li v-for="x in ownStrata" :key="x.id" class="part">
          <button class="link k" :title="x.admits ? `归属判定：${x.admits}` : undefined" @click="pickStratum(x)">{{ x.name }}</button>
          <span class="v" :title="x.asks">{{ x.asks ?? '' }}</span>
          <span class="members">
            <template v-for="(id, i) in x.members" :key="id"
              ><span v-if="i" class="muted">、</span><button class="link" @click="openChild(id)">{{ idx.modules.get(id)?.name ?? id }}</button></template
            >
          </span>
        </li>
      </ul>
      <ul v-else-if="children.length" class="parts" data-testid="module-children">
        <li v-for="c in childrenShown" :key="c.id" class="part">
          <button class="link k" @click="openChild(c.id)">{{ c.name }}</button>
          <span class="v" :title="childSummary(c.id)?.text">
            <span v-if="c.role === 'core'" class="badge accent">核心</span>
            <span v-if="(idx.childrenOf.get(c.id) ?? []).length" class="muted">⌄ {{ idx.childrenOf.get(c.id)!.length }} </span>
            <ChangeBadge entity="module" :id="c.id" />
            <span :class="{ pending: childSummary(c.id)?.pending }">{{ childSummary(c.id)?.text ?? '' }}</span>
          </span>
        </li>
        <li v-if="children.length > CHILDREN_CAP">
          <button class="link more" :aria-expanded="childrenOpen" @click="childrenOpen = !childrenOpen">
            {{ childrenOpen ? '收起' : `+${children.length - CHILDREN_CAP}` }}
          </button>
        </li>
      </ul>
      <details v-if="isLayer && (inc.yes.length || inc.no.length || stratum?.asks || stratum?.admits)" class="inc">
        <summary>包含 / 不包含 {{ inc.yes.length }} / {{ inc.no.length }}</summary>
        <p v-if="stratum?.asks" class="muted">层的问题：{{ stratum.asks }}</p>
        <p v-if="stratum?.admits" class="muted">归属判定：{{ stratum.admits }}</p>
        <ul class="yes">
          <li v-for="x in inc.yes" :key="x">{{ x }}</li>
        </ul>
        <ul class="no">
          <li v-for="x in inc.no" :key="x">{{ x }}</li>
        </ul>
      </details>
      <p v-if="isLayer" class="deps" data-testid="layer-deps">
        <span class="label">可依赖</span>
        <span v-if="!layerDeps.length" class="muted">无</span>
        <template v-for="(d, i) in layerDeps" :key="d.id"
          ><span v-if="i" class="muted"> · </span><button class="link" @click="pickStratum(d)">{{ d.name }}</button></template
        >
      </p>
    </div>

    <!-- ③ 对外表面 -->
    <div v-if="provides.length" class="q-block" data-sec="surface">
      <h4 class="q">
        对外表面<span class="count">{{ provides.length }}</span>
      </h4>
      <ul class="parts">
        <li v-for="id in ifaceShown" :key="id" class="part iface">
          <button
            class="link k"
            :aria-expanded="detail === id"
            :title="detail === id ? '收起详情' : '展开签名与说明'"
            @click="detail = detail === id ? null : id"
          >
            {{ iface(id)?.name ?? id }}
          </button>
          <span class="v"><span v-if="isPort(id)" class="badge">端口</span> {{ use(id) }}</span>
          <InterfaceItem v-if="detail === id" class="iface-detail" :id="id" open />
        </li>
        <li v-if="provides.length > IFACE_CAP">
          <button class="link more" :aria-expanded="ifaceOpen" @click="ifaceOpen = !ifaceOpen">
            {{ ifaceOpen ? '收起' : `+${provides.length - IFACE_CAP}` }}
          </button>
        </li>
      </ul>
    </div>

    <!-- ④ 协作 -->
    <div v-if="hasCollab" class="q-block" data-sec="collab">
      <h4 class="q">协作 <span class="muted hint">悬停高亮画布上的线</span></h4>
      <ModuleCollab :id="id" />
    </div>

    <!-- ⑤ 守住什么 -->
    <div v-if="invariants.length" class="q-block" data-sec="invariants">
      <h4 class="q">守住什么</h4>
      <ul class="inv" data-testid="invariants">
        <li v-for="(x, i) in invariants" :key="i">
          {{ x.text }}
          <button
            v-if="x.link?.file"
            class="link adr"
            :title="x.link.title ? `${x.link.title}（在资料区预览）` : '在资料区预览'"
            @click="openPreview(x.link.file)"
          >
            {{ x.link.label }}
          </button>
          <span v-else-if="x.link" class="adr muted">{{ x.link.label }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.run-first {
  margin: 0 -12px 6px;
}

.summary {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
}

.pending {
  margin-left: 6px;
  padding: 0 5px;
  font-size: 10.5px;
  font-weight: 400;
  color: var(--warning);
  background: var(--warning-soft);
  border-radius: 3px;
  vertical-align: 1px;
}

.full {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 400;
  padding: 0;
  vertical-align: 1px;
}

.full-text {
  font-size: 12.5px;
  color: var(--text-2);
}

.q-block {
  margin-top: 6px;
}

.q {
  margin: 0 0 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
}

.q .count {
  margin-left: 4px;
  font-weight: 500;
}

.q .hint {
  font-weight: 400;
}

.principle,
.deps {
  margin: 0 0 2px;
  color: var(--text-2);
  font-size: 12.5px;
}

/* C3：原则一句，长了收两行（悬停看全文） */
.principle {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.label {
  margin-right: 6px;
  font-size: 11px;
  color: var(--text-3);
}

.parts {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 12.5px;
}

.part {
  line-height: 20px;
  display: grid;
  grid-template-columns: minmax(4.5em, auto) 1fr;
  gap: 0 10px;
  padding: 1px 0;
}

.part .k {
  text-align: left;
  white-space: nowrap;
  max-width: 9em;
  overflow: hidden;
  text-overflow: ellipsis;
}

.part .v {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-2);
}

.part .v .pending {
  font-style: italic;
  margin: 0;
  padding: 0;
  font-size: inherit;
  background: none;
  color: var(--text-2);
}

.members {
  grid-column: 2;
  font-size: 11.5px;
}

.iface-detail {
  grid-column: 1 / 3;
}

.more {
  font-size: 11.5px;
}

.inc {
  margin: 2px 0;
  font-size: 12px;
}

.inc summary {
  cursor: pointer;
  color: var(--text-2);
}

.inc p {
  margin: 2px 0;
}

.inc ul {
  margin: 0;
  padding-left: 1.2em;
}

.inc .yes li::marker {
  content: '✓ ';
  color: var(--rel-streams);
}

.inc .no li::marker {
  content: '✗ ';
  color: var(--danger);
}

.inv {
  margin: 0;
  padding-left: 16px;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--text-2);
}

.adr {
  font-size: 11px;
  padding: 0;
}
</style>
