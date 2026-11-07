<script setup lang="ts">
/**
 * 层面板（ADR-0052，V2；V15、PC-10，ADR-0053）：单击多成员层的带选中。层是父模块对子模块的分类，不是模块。理解卡按五问：
 * ① 回答的问题（asks，粗体）② 怎么分：原则、归属判定问（admits）、单独成层的理由、成员（名称 · 一句话职责）④ 可依赖的层（只留链接，C2）；
 * 核对：结构一行（Ca / Ce / I 与本层的向上依赖，向上依赖为提示，ST-3–ST-5 的依据）。
 */
import { computed } from 'vue'
import { usePanelPart } from '../shared/panelPart'
import ScopeSummary from './ScopeSummary.vue'
import { useDesk } from '@/state/inject'
import { mayDependOnOf, moduleName, stratumByKey, stratumKey, summaryOf } from '@/model'
import Section from './Section.vue'
import PanelCard from './PanelCard.vue'
import CheckCard from './CheckCard.vue'
import type { CheckRow } from './panelCheck'

const props = defineProps<{ id: string }>()
const desk = useDesk()
/** LY-13、LY-7：描述里面板头是一行操作（不写名称与 ID），核对里不出现 */
const pp = usePanelPart()
const idx = computed(() => desk.index.value)
const s = computed(() => (idx.value ? (stratumByKey(idx.value, props.id) ?? null) : null))
const name = (id: string) => (idx.value ? moduleName(idx.value, id) : id)
const metrics = computed(() => {
  if (!idx.value || !s.value) return null
  return desk.facts.strataOf(s.value.parent).find(m => m.id === s.value!.id) ?? null
})
const deps = computed(() => {
  if (!idx.value || !s.value) return []
  const list = idx.value.strata.get(s.value.parent) ?? []
  return (mayDependOnOf(s.value) ?? []).map(d => list.find(x => x.id === d)).filter((x): x is NonNullable<typeof x> => !!x)
})
const key = (x: { parent: string; id: string }) => (idx.value ? stratumKey(idx.value, x) : x.id)
const pick = (x: { parent: string; id: string; members: string[] }) =>
  x.members.length === 1 ? desk.select({ kind: 'module', id: x.members[0] }) : desk.select({ kind: 'stratum', id: key(x) })
const brief = (id: string) => {
  const m = idx.value?.modules.get(id)
  return m ? (summaryOf(m)?.text ?? '') : ''
}
const rows = computed<CheckRow[]>(() => {
  const x = metrics.value
  if (!x || x.instability === null) return [{ key: 'structure', label: '结构', state: 'none', text: '没有代码事实', items: [] }]
  return [
    {
      key: 'structure',
      label: '结构',
      state: x.upward.length ? 'hint' : 'ok',
      text: `Ca ${x.ca} · Ce ${x.ce} · I ${x.instability.toFixed(2)}${x.upward.length ? ` · 向上 ${x.upward.length}` : ''}`,
      items: x.upward.map(u => ({
        text: `向上：${name(u.from)} → ${name(u.to)}${u.typeOnly ? '（只引类型）' : ''} · ${u.files} 处`,
        target: 'structure',
        hint: true,
      })),
    },
  ]
})
</script>

<template>
  <div class="stratum-panel" data-testid="stratum-panel">
    <header v-if="pp.card" class="head id-card">
      <h2 v-if="pp.name">{{ s?.name ?? id }}</h2>
      <div class="badges">
        <span class="badge">层</span>
        <span v-if="s" class="badge">{{ name(s.parent) }} · 第 {{ (idx?.strata.get(s.parent) ?? []).indexOf(s) + 1 }} 层</span>
      </div>
    </header>
    <Section v-if="!s" title="说明">
      <p class="muted">描述里已没有这个层。</p>
    </Section>
    <template v-else>
      <PanelCard kind="understand" title="理解" closed-summary :summary="s.asks">
        <Section title="说明" data-sec="purpose">
          <p v-if="s.asks" class="asks" :title="s.admits ? `归属判定：${s.admits}` : undefined">{{ s.asks }}</p>
          <p v-else class="muted">没有写回答的问题（asks）</p>
          <p v-if="s.admits" class="muted">归属判定：{{ s.admits }}</p>
          <p v-if="s.abstraction" class="principle">{{ s.abstraction }}</p>
          <p v-if="s.singular" class="muted">单独成层：{{ s.singular }}</p>
        </Section>
        <Section title="成员" :count="s.members.length" data-sec="boundary.children">
          <ul class="list" data-testid="stratum-members">
            <li v-for="m in s.members" :key="m">
              <button class="link" :data-ref-module="m" @click="desk.select({ kind: 'module', id: m })">{{ name(m) }}</button>
              <span v-if="brief(m)" class="muted"> · {{ brief(m) }}</span>
            </li>
          </ul>
        </Section>
        <Section title="可依赖的层" data-sec="purpose">
          <span v-if="!deps.length" class="muted">{{ mayDependOnOf(s) ? '无' : '不约束（旧写法迁移，M26）' }}</span>
          <span v-for="(d, i) in deps" :key="d.id">
            <span v-if="i > 0"> · </span><button class="link" @click="pick(d)">{{ d.name }}</button>
          </span>
        </Section>
      </PanelCard>
      <!-- LY-13：主语是系统 / 层时，核对标签先给这棵子树的汇总 -->
      <ScopeSummary :roots="s?.members ?? []" />
      <CheckCard :rows="rows">
        <Section v-if="metrics && metrics.instability !== null" title="结构" fold data-sec="structure">
          <p>Ca {{ metrics.ca }} · Ce {{ metrics.ce }} · I {{ metrics.instability.toFixed(2) }}</p>
          <ul v-if="metrics.upward.length" class="list">
            <li v-for="u in metrics.upward" :key="`${u.from}->${u.to}`">
              向上：<button class="link" @click="desk.select({ kind: 'dep', id: `${u.from}->${u.to}` })">{{ name(u.from) }} → {{ name(u.to) }}</button>
              <span class="muted">{{ u.typeOnly ? ' · 只引类型' : '' }} · {{ u.files }} 处</span>
            </li>
          </ul>
        </Section>
      </CheckCard>
    </template>
  </div>
</template>

<style scoped>
.list {
  margin: 0;
  padding-left: 16px;
}
.asks {
  font-weight: 600;
  margin: 0 0 4px;
}
.principle {
  margin: 4px 0 0;
}
</style>
