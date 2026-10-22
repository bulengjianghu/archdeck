<script setup lang="ts">
/** 编辑表单（P-1–P-6，SK-8、SK-9）：编辑态下属性面板换成表单——按选中显示层、模块、关系，无选中时为草图元信息；顶部常驻校验与实时核验 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import EditChecks from './EditChecks.vue'
import LayerForm from './LayerForm.vue'
import ModuleForm from './ModuleForm.vue'
import RelationForm from './RelationForm.vue'
import SketchMetaForm from './SketchMetaForm.vue'

const desk = useDesk()
const sel = computed(() => desk.selection.value)
const isLayer = computed(() => sel.value?.kind === 'module' && desk.index.value?.modules.get(sel.value.id)?.kind === 'layer')
const notice = ref('')
function notify(msg: string) {
  notice.value = msg
  setTimeout(() => notice.value === msg && (notice.value = ''), 4000)
}
</script>

<template>
  <div class="edit-panel">
    <EditChecks />
    <p v-if="notice" class="notice" role="alert">{{ notice }}</p>
    <LayerForm v-if="isLayer" :id="sel!.id" :key="`l:${sel!.id}`" @notice="notify" />
    <ModuleForm v-else-if="sel?.kind === 'module' && desk.index.value?.modules.has(sel.id)" :id="sel.id" :key="`m:${sel.id}`" @notice="notify" />
    <RelationForm v-else-if="sel?.kind === 'relation'" :id="sel.id" :key="`r:${sel.id}`" @notice="notify" />
    <SketchMetaForm v-else @notice="notify" />
  </div>
</template>

<style scoped>
.notice {
  margin: 6px 18px 0;
  font-size: 12.5px;
  color: var(--danger);
}
</style>
