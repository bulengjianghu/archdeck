<script setup lang="ts">
/** 代码依赖叠加线的面板（K10）：投影到这对节点的模块依赖、其中的违规与文件证据 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { RULE_LABELS, moduleName } from '@/model'
import Section from './Section.vue'
import FileDepList from './FileDepList.vue'
import StructureFacts, { type StructureGroup } from './StructureFacts.vue'

const desk = useDesk()
const sel = computed(() => desk.facts.selectedDep.value)
const name = (id: string) => (desk.index.value ? moduleName(desk.index.value, id) : id)
const STATUS: Record<string, string> = { new: '新增', known: '已知', open: '违规', allowed: '已豁免' }
/** K12、K13：这对节点之间的子类与组装事实 */
const structure = computed<StructureGroup[]>(() => {
  if (!sel.value) return []
  const b = desk.facts.structureBetween(sel.value.from, sel.value.to)
  return [
    { key: 'sub', label: '子类', title: '继承（K12）：不是关系', list: b.subclass },
    { key: 'asm', label: '组装', title: '组装（K13）：new / 工厂 / 注册，不是关系', list: b.assembly },
  ]
})
</script>

<template>
  <div class="dep-panel">
    <header class="head">
      <h2 v-if="sel">{{ name(sel.from) }} → {{ name(sel.to) }}</h2>
      <div class="badges">
        <span class="badge">代码依赖</span>
        <template v-if="structure.some(g => g.list.length)"><span class="muted">知识</span><StructureFacts :groups="structure" /></template>
      </div>
    </header>
    <Section v-if="!sel || !sel.detail" title="说明">
      <p class="muted">本层没有这对节点之间的代码依赖（层次已变化，或代码事实已刷新）。</p>
    </Section>
    <template v-else>
      <Section v-if="sel.detail.violations.length" title="违规" :count="sel.detail.violations.length">
        <ul class="plain">
          <li v-for="v in sel.detail.violations" :key="v.key" class="item">
            <div>
              <button class="link" @click="desk.revealModule(v.from)">{{ name(v.from) }}</button> →
              <button class="link" @click="desk.revealModule(v.to)">{{ name(v.to) }}</button>
              <span class="chip">{{ RULE_LABELS[v.kind] }}</span
              ><span :class="v.status === 'new' ? 'bad' : 'muted'">{{ STATUS[v.status] }}</span>
            </div>
            <p class="muted reason">
              {{ v.reason }}<template v-if="v.allowReason">；例外理由：{{ v.allowReason }}</template>
            </p>
            <FileDepList :deps="v.files" :limit="4" />
          </li>
        </ul>
      </Section>
      <Section title="模块依赖" :count="sel.detail.deps.length">
        <ul class="plain">
          <li v-for="d in sel.detail.deps" :key="d.key" class="item">
            <div>
              <button class="link" @click="desk.revealModule(d.from)">{{ name(d.from) }}</button> →
              <button class="link" @click="desk.revealModule(d.to)">{{ name(d.to) }}</button>
              <span :class="d.described ? 'muted' : 'warn'">{{ d.described ? '有交互' : '未解释' }}</span>
              <span class="muted">{{ d.files.length }} 处</span>
            </div>
            <FileDepList :deps="d.files" :limit="4" />
          </li>
        </ul>
      </Section>
    </template>
  </div>
</template>

<style scoped>
.item {
  padding: 4px 0 6px;
  border-bottom: 1px dashed var(--border);
}

.item:last-child {
  border-bottom: none;
}

.chip {
  margin: 0 6px;
  padding: 0 6px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.reason {
  margin: 2px 0;
  font-size: 12px;
}

.bad,
.warn {
  color: var(--danger);
}
</style>
