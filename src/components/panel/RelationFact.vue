<script setup lang="ts">
/** 关系面板的「代码事实」一节（K5、K6）：证实状态与依据的文件依赖 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'
import Section from './Section.vue'
import FileDepList from './FileDepList.vue'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const fact = computed(() => desk.facts.relationFact(props.id))
const r = computed(() => desk.index.value?.relations.get(props.id))
const runtime = computed(() => r.value?.type === 'calls' || r.value?.type === 'dataflow' || r.value?.type === 'event')
const files = computed(() => fact.value?.deps.flatMap(d => d.files) ?? [])
const name = (id: string) => (desk.index.value ? moduleName(desk.index.value, id) : id)
</script>

<template>
  <Section v-if="fact && fact.status !== 'skipped'" title="代码事实">
    <p v-if="fact.status === 'confirmed'" class="ok">✓ 已证实：{{ fact.deps.map(d => `${name(d.from)} → ${name(d.to)}`).join('；') }}</p>
    <p v-else-if="runtime" class="muted">? 未证实（运行时关系，可能经端口或注入，代码里没有直接的导入）</p>
    <p v-else class="bad">? 未证实：编译期关系在代码里找不到对应的导入，请按代码修正描述</p>
    <FileDepList v-if="files.length" :deps="files" />
  </Section>
</template>

<style scoped>
p {
  margin: 0 0 4px;
}

.ok {
  color: var(--success, var(--accent));
}

.bad {
  color: var(--danger);
}
</style>
