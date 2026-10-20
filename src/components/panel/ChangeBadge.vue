<script setup lang="ts">
/** 设计版本：实体相对对比基线是新增还是修改；detail 时列出改了哪些字段 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { FIELD_LABELS, type EntityKind } from '@/model'

const props = defineProps<{ entity: EntityKind; id: string; detail?: boolean }>()
const desk = useDesk()
const c = computed(() => desk.diff.value?.[props.entity].get(props.id))
const fields = computed(() => c.value?.fields?.map(f => FIELD_LABELS[f] ?? f).join('、'))
</script>

<template>
  <template v-if="c">
    <span class="diff-tag" :class="c.kind" :title="`相对${desk.baseline.value?.label}`">{{ c.kind === 'added' ? '新增' : '修改' }}</span>
    <span v-if="detail && fields" class="changed-fields">改了：{{ fields }}</span>
  </template>
</template>

<style scoped>
.changed-fields {
  font-size: 11.5px;
  color: var(--diff-changed);
}
</style>
