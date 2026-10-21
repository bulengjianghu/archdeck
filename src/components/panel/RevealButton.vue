<script setup lang="ts">
/** V9：在画布上临时显示这些视图节点的静态关系；再按一次收起。进度、选中、层次变化后自动收回 */
import { computed } from 'vue'
import { useStage } from '../stage/useStageDisplay'

const props = defineProps<{ nodes: string[] }>()
const stage = useStage()
const on = computed(() => props.nodes.length > 0 && props.nodes.every(id => stage.reveal.value.includes(id)))
</script>

<template>
  <button v-if="nodes.length" class="small reveal" :class="{ on }" @click="stage.toggleReveal(nodes)">
    {{ on ? '收起画布上的结构关系' : '在画布上显示结构关系' }}
  </button>
</template>

<style scoped>
.reveal.on {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
}
</style>
