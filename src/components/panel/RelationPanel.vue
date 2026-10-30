<script setup lang="ts">
/**
 * 关系面板（V15、PC-10，ADR-0053）：头部（端点、类型与修饰徽标）之下三卡——
 * 理解：目的（purposeOf，粗体）→ 说明（机制，V13）→ 关系维度（控制流、知识、语义、同步性、平面，ADR-0022）→ 经由接口 → 交换的数据结构；
 * 核对：证实（K5 / K6）、承载（K20 缺段）两行，清单为代码事实与承载的逐段证据；相关资料：经过它的场景。运行视角下理解卡首节为运行信息（V6）。
 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import { RUNTIME_RELATION_TYPES, callbackText, isCallbackVia, moduleName, parseVia, purposeOf, relationMode, viaLabel } from '@/model'
import { RELATION_TYPE_HINTS, RELATION_TYPE_LABELS } from '../shared/labels'
import Markdown from './Markdown.vue'
import Section from './Section.vue'
import InterfaceItem from './InterfaceItem.vue'
import DataStructureItem from './DataStructureItem.vue'
import ChangeBadge from './ChangeBadge.vue'
import DesignNote from './DesignNote.vue'
import RelationFact from './RelationFact.vue'
import RelationCarrier from './RelationCarrier.vue'
import StructureFacts, { type StructureGroup } from './StructureFacts.vue'
import PanelCard from './PanelCard.vue'
import CheckCard from './CheckCard.vue'
import RelatedCard from './RelatedCard.vue'
import { usePanelJump } from './panelNotices'
import type { CheckRow } from './panelCheck'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const r = computed(() => desk.index.value!.relations.get(props.id)!)
const name = (id: string) => moduleName(desk.index.value!, id)
const point = (id: string) => (desk.index.value!.actors.has(id) ? desk.select({ kind: 'actor', id }) : desk.revealModule(id))
const runtime = computed(() => RUNTIME_RELATION_TYPES.includes(r.value.type))
const fact = computed(() => desk.facts.relationFact(props.id))
const carrier = computed(() => desk.facts.carrierOf(props.id))

// ── 核对卡（PC-10）：证实（K6，写了 via 或同文件概念拆分的不判定不算异常）、承载缺段（K20）；清单来自现有派生，不新算 ──
const root = ref<HTMLElement | null>(null)
usePanelJump(root)
const rows = computed<CheckRow[]>(() => {
  const f = fact.value
  const out: CheckRow[] = []
  if (!f) out.push({ key: 'verify', label: '证实', state: 'none', text: '没有代码事实', items: [] })
  else if (f.via || f.host || f.status === 'skipped')
    out.push({ key: 'verify', label: '证实', state: 'none', text: '不判定（经机制、同文件或端点是参与者）', items: [] })
  else if (f.status === 'unconfirmed')
    out.push({
      key: 'verify',
      label: '证实',
      state: 'bad',
      text: '未被代码证实',
      items: [
        {
          text: f.isolated ? '两端之间在代码里没有任何依赖，多半是描述写错（K6）' : '两端之间只有反向的依赖，可能经端口或注入（K6）',
          target: 'evidence.fact',
        },
      ],
    })
  else out.push({ key: 'verify', label: '证实', state: 'ok', text: '已被代码证实', items: [] })
  const c = carrier.value
  if (c) {
    const missing = c.segments.filter(x => x.missing)
    out.push({
      key: 'carrier',
      label: '承载',
      state: missing.length ? 'bad' : 'ok',
      text: missing.length ? `${c.segments.length} 段中缺 ${missing.length} 段` : `${c.segments.length} 段齐全`,
      items: missing.map(x => ({ text: `缺段：${name(x.from)} → ${name(x.to)}`, target: 'boundary.carrier' })),
    })
  }
  return out
})
const purpose = computed(() => purposeOf(r.value))
const scenarios = computed(() => desk.run.scenariosOfRelation(props.id))

/** 知识（谁知道谁）：由代码事实给出——依据的依赖与箭头同向 / 反向，经端口，或不判定 */
const knowledge = computed(() => {
  const x = r.value
  const c = fact.value
  const from = name(x.from)
  const to = name(x.to)
  const via = parseVia(x.via)
  // K5b：经端口而证实——发起方依赖端口的定义模块，接收方是端口已证实的实现者
  if (via?.kind === 'port' && c?.port)
    return `经端口：${from} 只知道端口「${desk.index.value!.interfaces.get(via.target!)?.name ?? via.target}」，${to} 是它的实现者`
  if (via?.kind === 'port' && !via.target) return '经端口（未指明）：两端只知道端口契约，由第三方接线'
  if (x.via) return `不判定：经 ${viaLabel(x.via, desk.index.value!)}`
  if (!c) return '不判定：没有代码事实'
  if (c.host) return '不判定：概念拆分，同文件'
  if (c.status === 'skipped') return '不判定：端点是参与者或目标态'
  if (c.structural) return `同向：${from} 只引了 ${to} 的数据类型（结构性实现，代码未显式声明）`
  if (c.likeDepends) return `同向：${from} 使用 ${to} 的实现，没有引用它的接口（证据像使用）`
  if (c.knows === 'forward') return `同向：${from} 知道 ${to}`
  if (c.knows === 'reverse') return `反向：${to} 知道 ${from}`
  if (c.knows === 'both') return '双向：两端互相引用'
  if (runtime.value && !c.isolated) return '不判定：只有反向的依赖或经组装（未证实）'
  return '不判定：代码里两端之间没有依赖（未证实）'
})
const semantics = computed(
  () => `${RELATION_TYPE_LABELS[r.value.type]}${r.value.type === 'streams' && r.value.pull ? '（拉取型）' : ''}：${RELATION_TYPE_HINTS[r.value.type]}`,
)
/** L10、M13：同步性——通知一律异步，查询与委托按 mode */
const mode = computed(() => (relationMode(r.value) === 'async' ? '异步' : '同步'))
/** L12：经端口（插座记号）；其余机制只在面板标出 */
const viaText = computed(() => (r.value.via ? viaLabel(r.value.via, desk.index.value!) : ''))
/** 徽标说明：经端口（L12）、经回调（L24）、其余经此传递 */
const viaTitle = computed(() => {
  const via = r.value.via
  if (!via) return ''
  if (via.startsWith('port:')) return '经端口：接收方是端口的实现者，可替换（L12）'
  if (isCallbackVia(via)) return callbackText(desk.index.value!, r.value.id)
  return '经此传递，静态导入证实不了（K5b）'
})
const plane = computed(() => (!runtime.value ? '—（编译期）' : r.value.type === 'streams' ? '数据面' : '控制面'))
const visibleHere = computed(() => desk.view.value?.edges.some(e => e.relationIds.includes(props.id)) ?? false)
/** K12、K13：两端之间的子类与组装事实，「知识」行旁标出 */
const structure = computed<StructureGroup[]>(() => {
  const b = desk.facts.structureBetween(r.value.from, r.value.to)
  return [
    { key: 'sub', label: '子类', title: '两端之间的继承（K12）：不是关系，由代码事实承载', list: b.subclass },
    { key: 'asm', label: '组装', title: '两端之间的组装（K13）：new / 工厂 / 注册，不是关系', list: b.assembly },
  ]
})
/** J7：两端有时间耦合时标「同提交 ×N」 */
const couple = computed(() => desk.evolution.between(r.value.from, r.value.to))
</script>

<template>
  <div v-if="r" ref="root" class="relation-panel">
    <header class="head">
      <h2 class="endpoints">
        <button class="link" @click="point(r.from)">{{ name(r.from) }}</button>
        <span class="arrow">→</span>
        <button class="link" @click="point(r.to)">{{ name(r.to) }}</button>
      </h2>
      <div class="badges">
        <code>{{ r.id }}</code>
        <span class="rel-chip" :class="`rel-${r.type}`">{{ RELATION_TYPE_LABELS[r.type] }}</span>
        <span v-if="runtime" class="badge">{{ mode }}</span>
        <span v-if="r.type === 'streams' && r.pull" class="badge">拉取</span>
        <span v-if="r.via" class="badge via" :title="viaTitle">经 {{ viaText }}</span>
        <button v-if="couple" class="badge couple" title="两端是时间耦合：单击看共同的提交（J7）" @click="desk.select({ kind: 'couple', id: couple.id })">
          同提交 ×{{ couple.shared }}
        </button>
        <span v-if="!visibleHere" class="muted not-here">不在本层，已选中</span>
        <button v-if="!visibleHere" class="small" @click="desk.revealRelation(r.id)">定位到所在层次</button>
        <ChangeBadge entity="relation" :id="r.id" detail />
      </div>
    </header>
    <DesignNote :text="r.designNote" />
    <PanelCard kind="understand" title="理解" closed-summary :summary="purpose?.text">
      <p v-if="purpose" class="purpose" data-testid="purpose">
        {{ purpose.text }}<span v-if="purpose.pending" class="pending" title="描述没有写 purpose：取自说明首句截断（M30）">待提炼</span>
      </p>
      <!-- V13：先读说明（机制）建立认知，再看维度 -->
      <Section v-if="r.description" title="说明" class="summary" data-sec="purpose"><Markdown :text="r.description" /></Section>
      <p v-else class="no-summary muted" data-sec="purpose">未写说明</p>

      <Section title="关系" data-sec="boundary.dimensions">
        <dl class="dims">
          <dt>控制流</dt>
          <dd>{{ runtime ? `${name(r.from)} → ${name(r.to)}` : '—（编译期关系，不发生运行时交互）' }}</dd>
          <dt>知识</dt>
          <dd>{{ knowledge }}<StructureFacts :groups="structure" /></dd>
          <dt>语义</dt>
          <dd>{{ semantics }}</dd>
          <dt>同步性</dt>
          <dd>{{ runtime ? mode : '—' }}</dd>
          <dt>平面</dt>
          <dd>{{ plane }}</dd>
        </dl>
      </Section>
      <Section title="经由接口" data-sec="boundary.interface">
        <InterfaceItem v-if="r.interface" :id="r.interface" open />
        <p v-else class="muted">未指定</p>
      </Section>
      <Section v-if="r.payload.length" title="交换的数据结构" :count="r.payload.length" data-sec="boundary.payload">
        <DataStructureItem v-for="id in r.payload" :key="id" :id="id" open />
      </Section>
    </PanelCard>
    <CheckCard :rows="rows">
      <RelationFact :id="r.id" fold />
      <RelationCarrier :id="r.id" fold />
    </CheckCard>
    <RelatedCard :scenarios="scenarios" />

    <footer class="src muted">出处：{{ desk.modelDir.value }}/{{ r.src.file }}{{ r.src.line ? `:${r.src.line}` : '' }}</footer>
  </div>
</template>

<style scoped>
.purpose {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
}

.pending {
  margin-left: 6px;
  padding: 0 5px;
  font-size: 10.5px;
  font-weight: 400;
  color: var(--warning);
  background: var(--warning-soft);
  border-radius: 3px;
}

.no-summary {
  margin: 8px 0 4px;
  font-size: 12.5px;
}

.endpoints {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}

.endpoints .link {
  font-size: inherit;
  font-weight: inherit;
}

.arrow {
  color: var(--text-3);
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
</style>
