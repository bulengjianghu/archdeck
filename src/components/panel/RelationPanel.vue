<script setup lang="ts">
/** 关系面板：头部为方向与类型；「关系」一节按五个维度各一行（控制流、知识、语义、同步性、平面，ADR-0022）；其后接口、数据、代码事实 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { RUNTIME_RELATION_TYPES, VIA_LABELS, moduleName } from '@/model'
import { RELATION_TYPE_HINTS, RELATION_TYPE_LABELS } from '../shared/labels'
import Markdown from './Markdown.vue'
import Section from './Section.vue'
import InterfaceItem from './InterfaceItem.vue'
import DataStructureItem from './DataStructureItem.vue'
import ChangeBadge from './ChangeBadge.vue'
import DesignNote from './DesignNote.vue'
import RelationFact from './RelationFact.vue'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const r = computed(() => desk.index.value!.relations.get(props.id)!)
const name = (id: string) => moduleName(desk.index.value!, id)
const point = (id: string) => (desk.index.value!.actors.has(id) ? desk.select({ kind: 'actor', id }) : desk.revealModule(id))
const runtime = computed(() => RUNTIME_RELATION_TYPES.includes(r.value.type))
const fact = computed(() => desk.facts.relationFact(props.id))

/** 知识（谁知道谁）：由代码事实给出——依据的依赖与箭头同向 / 反向，经端口，或不判定 */
const knowledge = computed(() => {
  const x = r.value
  const c = fact.value
  const from = name(x.from)
  const to = name(x.to)
  if (x.via === 'port') return '经端口：两端只知道端口契约，由第三方接线'
  if (x.via) return `不判定：经 ${VIA_LABELS[x.via]}`
  if (!c) return '不判定：没有代码事实'
  if (c.host) return '不判定：概念拆分，同文件'
  if (c.status === 'skipped') return '不判定：端点是参与者或目标态'
  if (c.structural) return `同向：${from} 只引了 ${to} 的数据类型（结构性实现，代码未显式声明）`
  if (c.likeDepends) return `同向：${from} 使用 ${to} 的实现，没有引用它的接口（证据像 depends）`
  if (c.knows === 'forward') return `同向：${from} 知道 ${to}`
  if (c.knows === 'reverse') return `反向：${to} 知道 ${from}`
  if (c.knows === 'both') return '双向：两端互相引用'
  if (runtime.value && !c.isolated) return '不判定：只有反向的依赖或经组装（未证实）'
  return '不判定：代码里两端之间没有依赖（未证实）'
})
const semantics = computed(
  () => `${RELATION_TYPE_LABELS[r.value.type]}${r.value.type === 'streams' && r.value.pull ? '（拉取型）' : ''}：${RELATION_TYPE_HINTS[r.value.type]}`,
)
const plane = computed(() => (!runtime.value ? '—（编译期）' : r.value.type === 'streams' ? '数据面' : '控制面'))
const visibleHere = computed(() => desk.view.value?.edges.some(e => e.relationIds.includes(props.id)) ?? false)
/** J7：两端有时间耦合时标「同提交 ×N」 */
const couple = computed(() => desk.evolution.between(r.value.from, r.value.to))
</script>

<template>
  <div v-if="r" class="relation-panel">
    <header class="head">
      <h2 class="endpoints">
        <button class="link" @click="point(r.from)">{{ name(r.from) }}</button>
        <span class="arrow">→</span>
        <button class="link" @click="point(r.to)">{{ name(r.to) }}</button>
      </h2>
      <div class="badges">
        <code>{{ r.id }}</code>
        <span class="rel-chip" :class="`rel-${r.type}`">{{ RELATION_TYPE_LABELS[r.type] }}</span>
        <span v-if="runtime" class="badge">{{ r.mode === 'async' ? '异步' : '同步' }}</span>
        <span v-if="r.via" class="badge" title="经此传递，静态导入证实不了（K5b）">经 {{ VIA_LABELS[r.via] }}</span>
        <button v-if="couple" class="badge couple" title="两端是时间耦合：单击看共同的提交（J7）" @click="desk.select({ kind: 'couple', id: couple.id })">
          同提交 ×{{ couple.shared }}
        </button>
        <button v-if="!visibleHere" class="small" @click="desk.revealRelation(r.id)">定位到所在层次</button>
        <ChangeBadge entity="relation" :id="r.id" detail />
      </div>
    </header>
    <DesignNote :text="r.designNote" />

    <Section title="关系">
      <dl class="dims">
        <dt>控制流</dt>
        <dd>{{ runtime ? `${name(r.from)} → ${name(r.to)}` : '—（编译期关系，不发生运行时交互）' }}</dd>
        <dt>知识</dt>
        <dd>{{ knowledge }}</dd>
        <dt>语义</dt>
        <dd>{{ semantics }}</dd>
        <dt>同步性</dt>
        <dd>{{ runtime ? (r.mode === 'async' ? '异步' : '同步') : '—' }}</dd>
        <dt>平面</dt>
        <dd>{{ plane }}</dd>
      </dl>
    </Section>
    <Section v-if="r.description" title="说明"><Markdown :text="r.description" /></Section>
    <Section title="经由接口">
      <InterfaceItem v-if="r.interface" :id="r.interface" open />
      <p v-else class="muted">未指定</p>
    </Section>
    <Section v-if="r.payload.length" title="交换的数据结构" :count="r.payload.length">
      <DataStructureItem v-for="id in r.payload" :key="id" :id="id" open />
    </Section>
    <RelationFact :id="r.id" />

    <footer class="src muted">出处：{{ desk.modelDir.value }}/{{ r.src.file }}{{ r.src.line ? `:${r.src.line}` : '' }}</footer>
  </div>
</template>

<style scoped>
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
