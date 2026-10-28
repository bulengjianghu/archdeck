<script setup lang="ts">
/**
 * 模块面板 · 知识（K12、K13）：继承与组装是代码事实、不是关系——「知识」行旁列子类 / 基类、组装 / 被组装于，标出组装根（§1.7）。
 * 只对当前版本（有代码事实时，K8）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import Section from './Section.vue'
import StructureFacts, { type StructureGroup } from './StructureFacts.vue'

const props = defineProps<{ id: string; /** G11 V14c：⑤ 证据与细节缺省折叠 */ fold?: boolean }>()
const desk = useDesk()
const s = computed(() => desk.facts.structureOf(props.id))
const groups = computed<StructureGroup[]>(() =>
  s.value
    ? [
        { key: 'sub', label: '子类', title: '别的模块的类 extends 本模块的类（K12）', list: s.value.subclasses },
        { key: 'base', label: '基类', title: '本模块的类 extends 别的模块的类（K12）', list: s.value.bases },
        { key: 'asm', label: '组装', title: '本模块 new / 工厂调用 / 注册别的模块（K13）', list: s.value.assembles },
        { key: 'asmBy', label: '被组装于', title: '别的模块 new / 工厂调用 / 注册本模块（K13）', list: s.value.assembledBy },
      ]
    : [],
)
const any = computed(() => groups.value.some(g => g.list.length) || !!s.value?.root)
/** 折叠计数：子类 / 基类 / 组装 / 被组装于的事实条数（组装根不计） */
const factsCount = computed(() => groups.value.reduce((n, g) => n + g.list.length, 0))
</script>

<template>
  <Section v-if="any" title="代码事实 · 知识" :count="factsCount || undefined" :fold="props.fold">
    <dl class="dims">
      <dt>知识</dt>
      <dd>
        <span v-if="s?.root" class="badge accent" title="组装了别的模块、自身不被任何模块组装（K13）">组装根</span>
        <StructureFacts :groups="groups" />
      </dd>
    </dl>
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
</style>
