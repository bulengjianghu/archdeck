<script setup lang="ts">
/**
 * 聚合边面板（V15、PC-10，ADR-0053）：头部（端点、类型与条数徽标、控制反转的注记）之下三卡——
 * 理解：原始关系（每条目的 + 说明首句，V13；可跳到它真实所在的层次并选中，N3）；
 * 核对：方向（K22 向上却不是控制反转，desk.facts.upward；控制反转是应有之义，只在头部注记）、证实（被聚合关系中未证实的条数）两行。
 * 运行视角下理解卡首节为运行信息（V6）。
 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'
import Section from './Section.vue'
import RelationRow from './RelationRow.vue'
import PanelCard from './PanelCard.vue'
import CheckCard from './CheckCard.vue'
import { usePanelJump, type PanelNotice } from './panelNotices'
import { rowsFromNotices } from './panelCheck'
import { RELATION_TYPE_LABELS } from '../shared/labels'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const edge = computed(() => {
  const v = desk.view.value
  return [...(v?.edges ?? []), ...(v?.coreEdges ?? []), ...(v?.shelfEdges ?? [])].find(e => e.id === props.id)
})
function endName(nodeId: string): string {
  const boundary = nodeId.startsWith('boundary:')
  const id = boundary ? nodeId.slice('boundary:'.length) : nodeId
  const n = desk.index.value ? moduleName(desk.index.value, id) : id
  return boundary ? `${n}（外部）` : n
}
const endId = (nodeId: string) => (nodeId.startsWith('boundary:') ? nodeId.slice('boundary:'.length) : nodeId)
/** J7：两端模块有时间耦合时标「同提交 ×N」 */
const couple = computed(() => {
  const e = edge.value
  if (!e || !desk.index.value) return undefined
  const a = endId(e.from)
  const b = endId(e.to)
  return desk.index.value.modules.has(a) && desk.index.value.modules.has(b) ? desk.evolution.between(a, b) : undefined
})
/** K22：分层（按依赖算出的层或声明的层）后向上的边——控制反转是应有之义，否则多半是没标的回调、通知或经通道；画布标「向上」（L26） */
const upward = computed(() => desk.facts.upward.value.find(u => u.edge === props.id) ?? null)
const endSelection = (nodeId: string) =>
  desk.index.value?.actors.has(nodeId) ? ({ kind: 'actor', id: nodeId } as const) : ({ kind: 'module', id: endId(nodeId) } as const)

// ── 核对卡（PC-10）：向上却不是控制反转（K22）、未证实（K6）；单击跳到「原始关系」 ──
const root = ref<HTMLElement | null>(null)
usePanelJump(root)
const notices = computed<PanelNotice[]>(() =>
  upward.value && !upward.value.inversion
    ? [
        {
          key: 'upward',
          label: '向上却不是控制反转',
          count: 1,
          target: 'boundary.relations',
          to: '原始关系',
          note: `本层分了层（算出的或声明的），依赖都朝下；${upward.value.relations.join('、')} 是直接的查询或委托，发起方却在被依赖的一侧——多半是没标的回调、通知或经通道（K22）`,
        },
      ]
    : [],
)
const unconfirmed = computed(() => {
  const rep = desk.facts.report.value
  return rep && edge.value ? edge.value.relationIds.filter(id => rep.relations.get(id)?.status === 'unconfirmed').length : null
})
const rows = computed(() =>
  rowsFromNotices(
    [
      ...notices.value,
      ...(unconfirmed.value ? [{ key: 'unconfirmed' as const, label: '未证实', count: unconfirmed.value, target: 'boundary.relations', to: '原始关系' }] : []),
    ],
    [
      { key: 'direction', label: '方向', notices: ['upward'], ok: upward.value?.inversion ? '向上，是控制反转' : '没有违背分层' },
      { key: 'verify', label: '证实', notices: ['unconfirmed'], ...(unconfirmed.value === null ? { none: '没有代码事实' } : { ok: '全部被代码证实' }) },
    ],
  ),
)
</script>

<template>
  <div v-if="edge" ref="root" class="edge-panel">
    <header class="head" data-sec="head">
      <h2 class="endpoints">
        <button class="link" @click="desk.select(endSelection(edge.from))">{{ endName(edge.from) }}</button>
        <span class="muted">→</span>
        <button class="link" @click="desk.select(endSelection(edge.to))">{{ endName(edge.to) }}</button>
      </h2>
      <div class="badges">
        <span class="rel-chip" :class="`rel-${edge.type}`" :title="edge.type">{{ RELATION_TYPE_LABELS[edge.type] }} ×{{ edge.relationIds.length }}</span>
        <span class="badge">{{ edge.kind === 'aggregate' ? '聚合边' : '直接边' }}</span>
        <span v-if="edge.mode !== 'sync'" class="badge">{{ edge.mode === 'async' ? '异步' : '同步 + 异步' }}</span>
        <button v-if="couple" class="badge couple" title="两端是时间耦合：单击看共同的提交（J7）" @click="desk.select({ kind: 'couple', id: couple.id })">
          同提交 ×{{ couple.shared }}
        </button>
      </div>
      <p class="hint muted">由更深层次的 {{ edge.relationIds.length }} 条关系汇总而成。点击任意一条，跳到它真实所在的层次。</p>
      <p v-if="upward?.inversion" class="hint muted" data-testid="upward-note">
        向上的线：本层分了层（算出的或声明的），依赖都朝下，这条是控制反转（通知、流或经端口 / 总线 / 通道），向上是应有之义（K22）。
      </p>
    </header>
    <PanelCard kind="understand" title="理解" closed-summary :summary="`${edge.relationIds.length} 条原始关系`">
      <Section title="原始关系" :count="edge.relationIds.length" data-sec="boundary.relations">
        <ul class="plain">
          <RelationRow v-for="r in edge.relationIds" :key="r" :id="r" summary />
        </ul>
      </Section>
    </PanelCard>
    <CheckCard :rows="rows" />
  </div>
  <div v-else class="head muted">这条边在当前视图中已不存在（可能被筛选隐藏，或描述已更新）。</div>
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

.hint {
  margin: 6px 0 0;
  font-size: 12px;
}
</style>
