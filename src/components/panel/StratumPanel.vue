<script setup lang="ts">
/**
 * 层面板（ADR-0052，V2）：单击多成员层的带选中。层是父模块对子模块的分类，不是模块：
 * 名称、回答的问题（asks）、归属判定问（admits）、原则、可依赖的层、成员、Ca / Ce / I 与本层的向上依赖（ST-3–ST-5 的依据）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { mayDependOnOf, moduleName, stratumByKey, stratumKey } from '@/model'
import Section from './Section.vue'

const props = defineProps<{ id: string }>()
const desk = useDesk()
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
</script>

<template>
  <div class="stratum-panel" data-testid="stratum-panel">
    <header class="head">
      <h2>{{ s?.name ?? id }}</h2>
      <div class="badges">
        <span class="badge">层</span>
        <span v-if="s" class="badge">{{ name(s.parent) }} · 第 {{ (idx?.strata.get(s.parent) ?? []).indexOf(s) + 1 }} 层</span>
      </div>
    </header>
    <Section v-if="!s" title="说明">
      <p class="muted">描述里已没有这个层。</p>
    </Section>
    <template v-else>
      <Section title="说明" data-sec="purpose">
        <p v-if="s.asks" class="asks" :title="s.admits ? `归属判定：${s.admits}` : undefined">{{ s.asks }}</p>
        <p v-else class="muted">没有写回答的问题（asks）</p>
        <p v-if="s.admits" class="muted">归属判定：{{ s.admits }}</p>
        <p v-if="s.abstraction" class="principle">{{ s.abstraction }}</p>
        <p v-if="s.singular" class="muted">单独成层：{{ s.singular }}</p>
      </Section>
      <Section title="可依赖的层" data-sec="purpose">
        <span v-if="!deps.length" class="muted">{{ mayDependOnOf(s) ? '无' : '不约束（旧写法迁移，M26）' }}</span>
        <span v-for="(d, i) in deps" :key="d.id">
          <span v-if="i > 0"> · </span><button class="link" @click="pick(d)">{{ d.name }}</button>
        </span>
      </Section>
      <Section title="成员" :count="s.members.length" data-sec="boundary.children">
        <ul class="list" data-testid="stratum-members">
          <li v-for="m in s.members" :key="m">
            <button class="link" @click="desk.select({ kind: 'module', id: m })">{{ name(m) }}</button>
          </li>
        </ul>
      </Section>
      <Section v-if="metrics && metrics.instability !== null" title="结构" data-sec="structure">
        <p>Ca {{ metrics.ca }} · Ce {{ metrics.ce }} · I {{ metrics.instability.toFixed(2) }}</p>
        <ul v-if="metrics.upward.length" class="list">
          <li v-for="u in metrics.upward" :key="`${u.from}->${u.to}`">
            向上：<button class="link" @click="desk.select({ kind: 'dep', id: `${u.from}->${u.to}` })">{{ name(u.from) }} → {{ name(u.to) }}</button>
            <span class="muted">{{ u.typeOnly ? ' · 只引类型' : '' }} · {{ u.files }} 处</span>
          </li>
        </ul>
      </Section>
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
