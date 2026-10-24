<script setup lang="ts">
/** 关系面板的「代码事实」一节（K5、K6）：证实状态与依据的文件依赖；未证实分编译期、运行时可解释、运行时两端无依赖三档，implements 另有「结构性实现」与「证据像使用」；写了 via 的、概念拆分同文件的说明不判定 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { RUNTIME_RELATION_TYPES, VIA_LABELS, moduleName } from '@/model'
import Section from './Section.vue'
import FileDepList from './FileDepList.vue'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const fact = computed(() => desk.facts.relationFact(props.id))
const r = computed(() => desk.index.value?.relations.get(props.id))
const runtime = computed(() => !!r.value && RUNTIME_RELATION_TYPES.includes(r.value.type))
const files = computed(() => fact.value?.deps.flatMap(d => d.files) ?? [])
const name = (id: string) => (desk.index.value ? moduleName(desk.index.value, id) : id)
</script>

<template>
  <Section v-if="fact && (fact.status !== 'skipped' || fact.host || fact.via)" title="代码事实">
    <p v-if="fact.via" class="muted">不判定：经 {{ VIA_LABELS[fact.via] }}（静态导入证实不了，K5b）</p>
    <p v-else-if="fact.host" class="muted">不判定：概念拆分，同文件（两端的代码都在「{{ name(fact.host) }}」的文件里）</p>
    <p v-else-if="fact.status === 'confirmed'" class="ok">✓ 已证实：{{ fact.deps.map(d => `${name(d.from)} → ${name(d.to)}`).join('；') }}</p>
    <p v-else-if="fact.structural" class="muted">? 结构性实现（代码未显式声明）：只引了「{{ name(r!.to) }}」的数据类型；可在类上写明 implements 它声明的接口</p>
    <p v-else-if="fact.likeDepends" class="bad">
      ? 证据像使用：代码引用了「{{ name(r!.to) }}」的函数、类或变量，没有引用它声明的接口，也没有类 implements / extends 它；有交互时改为
      calls，只是知道时删除关系（由代码事实承载），或在它的描述里声明被实现的接口
    </p>
    <p v-else-if="runtime && !fact.isolated" class="muted">? 未证实（运行时关系，两端之间只有反向的依赖，可能经端口或注入）</p>
    <p v-else-if="runtime" class="bad">? 未证实：运行时关系的两端之间在代码里没有任何依赖（类型依赖、端口注入都没有），多半是描述写错，请按代码修正描述</p>
    <p v-else class="bad">? 未证实：implements 在代码里找不到对应的导入，请按代码修正描述</p>
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
