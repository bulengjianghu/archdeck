<script setup lang="ts">
/** 一个 ADR 编号的链接（PC-3 不变式的「ADR-NNNN」）：文件在源码清单中时单击在资料区预览，否则只显示编号 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { useOpenPreview } from '../shared/preview'

const props = defineProps<{ n: number }>()
const desk = useDesk()
const openPreview = useOpenPreview()
const link = computed(() => desk.files.adrLink(props.n))
</script>

<template>
  <button v-if="link.file" class="link adr" :title="link.title ? `${link.title}（在资料区预览）` : '在资料区预览'" @click="openPreview(link.file)">
    {{ link.label }}
  </button>
  <span v-else class="adr muted">{{ link.label }}</span>
</template>

<style scoped>
.adr {
  font-size: 11px;
  padding: 0;
}
</style>
