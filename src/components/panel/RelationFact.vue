<script setup lang="ts">
/**
 * 关系面板的「代码事实」一节（K5、K5b、K6）：证实状态与依据的文件依赖；未证实分可解释、两端无依赖两档；经端口的按端口证实，写了其余 via 的、概念拆分同文件的说明不判定。
 * G11 V15c（波 2 铺开）：⑤ 证据与细节——有文件证据时缺省折叠带计数（fold）；没有文件证据时只有一行判定，折叠没有可计的物，不折。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName, viaLabel } from '@/model'
import Section from './Section.vue'
import FileDepList from './FileDepList.vue'

const props = defineProps<{ id: string; /** G11 V15c：有文件证据时缺省折叠 */ fold?: boolean }>()
const desk = useDesk()
const fact = computed(() => desk.facts.relationFact(props.id))
const files = computed(() => fact.value?.deps.flatMap(d => d.files) ?? [])
const name = (id: string) => (desk.index.value ? moduleName(desk.index.value, id) : id)
</script>

<template>
  <Section
    v-if="fact && (fact.status !== 'skipped' || fact.host || fact.via)"
    title="代码事实"
    :count="files.length || undefined"
    :fold="props.fold && files.length > 0"
    data-sec="evidence.fact"
  >
    <p v-if="fact.via && fact.port && fact.status === 'confirmed'" class="ok">
      ✓ 已证实（经{{ viaLabel(fact.via, desk.index.value ?? undefined) }}）：{{
        fact.deps.map(d => `${name(d.from)} → ${name(d.to)}`).join('；')
      }}，接收方是它已证实的实现者
    </p>
    <p v-else-if="fact.via" class="muted">不判定：经 {{ viaLabel(fact.via, desk.index.value ?? undefined) }}（静态导入证实不了，K5b）</p>
    <p v-else-if="fact.host" class="muted">不判定：概念拆分，同文件（两端的代码都在「{{ name(fact.host) }}」的文件里）</p>
    <p v-else-if="fact.status === 'confirmed'" class="ok">✓ 已证实：{{ fact.deps.map(d => `${name(d.from)} → ${name(d.to)}`).join('；') }}</p>
    <p v-else-if="!fact.isolated" class="muted">? 未证实（两端之间只有反向的依赖，可能经端口或注入）</p>
    <p v-else class="bad">? 未证实：交互关系的两端之间在代码里没有任何依赖（类型依赖、端口注入都没有），多半是描述写错，请按代码修正描述</p>
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
