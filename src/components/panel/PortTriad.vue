<script setup lang="ts">
/** 模块面板 · 端口三角（K11、ADR-0022）：声明了接口的模块列出定义（它的接口）· 实现者（入边 implements）· 使用者（入边 depends / calls / streams，含经 via 的）；单击一项选中那条关系 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { VIA_LABELS, moduleName, type PortParty } from '@/model'
import { RELATION_TYPE_LABELS } from '../shared/labels'
import Section from './Section.vue'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const triad = computed(() => desk.facts.portTriadOf(props.id))
const name = (id: string) => (desk.index.value ? moduleName(desk.index.value, id) : id)
const ifName = (id: string) => desk.index.value?.interfaces.get(id)?.name ?? id
const groups = computed(() =>
  triad.value
    ? [
        { title: '实现者', parties: triad.value.implementers, empty: '没有模块 implements 它的接口' },
        { title: '使用者', parties: triad.value.users, empty: '没有模块 depends / calls / streams 它' },
      ]
    : [],
)
const mark = (p: PortParty) => (p.status === 'confirmed' ? '✓' : p.status === 'unconfirmed' ? '?' : '')
</script>

<template>
  <Section v-if="triad" title="端口（定义 · 实现者 · 使用者）" :count="triad.defines.length">
    <div class="group">
      <div class="label">定义</div>
      <div class="defs">
        <code v-for="x in triad.defines" :key="x" :title="x">{{ ifName(x) }}</code>
      </div>
    </div>
    <div v-for="g in groups" :key="g.title" class="group">
      <div class="label">
        {{ g.title }} <span class="muted">{{ g.parties.length }}</span>
      </div>
      <p v-if="!g.parties.length" class="muted">{{ g.empty }}</p>
      <ul v-else class="plain">
        <li v-for="p in g.parties" :key="p.relation" class="party">
          <button class="link" :title="p.relation" @click="desk.revealRelation(p.relation)">{{ name(p.module) }}</button>
          <span class="rel-chip" :class="`rel-${p.type}`">{{ RELATION_TYPE_LABELS[p.type] }}</span>
          <span v-if="p.via" class="muted">经 {{ VIA_LABELS[p.via] }}</span>
          <span v-if="mark(p)" class="fact" :class="{ ok: p.status === 'confirmed' }" :title="p.status === 'confirmed' ? '已被代码证实' : '未被代码证实'">{{
            mark(p)
          }}</span>
        </li>
      </ul>
    </div>
  </Section>
</template>

<style scoped>
.group + .group {
  margin-top: 6px;
}

.label {
  margin-bottom: 2px;
  font-size: 11.5px;
  color: var(--text-3);
}

.defs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
}

.defs code {
  font-size: 11.5px;
}

.party {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  padding: 2px 0;
}

.fact {
  font-size: 12px;
  color: var(--text-3);
}

.fact.ok {
  color: var(--success, var(--accent));
}

p {
  margin: 0;
}
</style>
