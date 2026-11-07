<script setup lang="ts">
/**
 * 环组的面板（L42，第十四轮 F10）：单击节点名称行的环编号「↻ N」或环组框的编号选中；列成员与环内的依赖（Y5），环内的束随之画出。
 * 反馈边（打破环的建议）以后再说（第十四轮 §6 第 10 项）。本层已没有这个环时说明原因。
 * 三卡（PC-10）：理解为说明与成员；核对为「环内的依赖」清单（环本身就是治理异常，计数在卡头）。
 */
import { computed } from 'vue'
import { usePanelPart } from '../shared/panelPart'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'
import Section from './Section.vue'
import PanelCard from './PanelCard.vue'
import CheckCard from './CheckCard.vue'

const props = defineProps<{ id: string }>()
const desk = useDesk()
/** LY-13、LY-7：描述里面板头是一行操作（不写名称与 ID），核对里不出现 */
const pp = usePanelPart()
const name = (id: string) => (desk.index.value ? moduleName(desk.index.value, id) : id)
const cycle = computed(() => desk.facts.level.value?.levelCycles.find(c => String(c.id) === props.id) ?? null)
const hidden = computed(() => desk.facts.cycleHidden.value.get(Number(props.id)) ?? 0)
</script>

<template>
  <div class="cycle-panel" data-testid="cycle-panel">
    <header v-if="pp.card" class="head id-card">
      <h2 v-if="pp.name">环 {{ id }}</h2>
      <div class="badges">
        <span class="badge warn">环组</span>
        <span v-if="cycle" class="badge">成员 {{ cycle.nodes.length }} · 环内 {{ cycle.edges.length }} 条</span>
      </div>
    </header>
    <Section v-if="!cycle" title="说明">
      <p class="muted">本层现在没有这个环（代码事实已刷新，或换了层次）。</p>
    </Section>
    <template v-else>
      <PanelCard kind="understand" title="理解" closed-summary :summary="`${cycle.nodes.length} 个模块互相依赖`">
        <p class="hint muted">
          环是一组模块的属性：组内互相依赖、整组同层。静息态只画组与计数，环内的依赖在选中环组或聚焦成员时画出（L42）{{
            hidden ? `；现在另有 ${hidden} 条收起` : ''
          }}。
        </p>
        <Section title="成员" :count="cycle.nodes.length">
          <ul class="list">
            <li v-for="n in cycle.nodes" :key="n.id">
              <button class="link" @click="desk.select({ kind: 'module', id: n.module })">{{ name(n.module) }}</button>
            </li>
          </ul>
        </Section>
      </PanelCard>
      <CheckCard :rows="[]" :empty="`⚠ 环内 ${cycle.edges.length} 条依赖`">
        <Section title="环内的依赖" :count="cycle.edges.length" fold>
          <ul class="list" data-testid="cycle-edges">
            <li v-for="e in cycle.edges" :key="`${e.from}->${e.to}`">
              <button class="link" @click="desk.select({ kind: 'dep', id: `${e.fromModule}->${e.toModule}` })">
                {{ name(e.fromModule) }} → {{ name(e.toModule) }}
              </button>
              <span class="muted"> · {{ e.deps.length }} 条模块依赖</span>
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
  font-size: 13px;
}

.hint {
  margin: 8px 0;
  font-size: 12px;
}
</style>
