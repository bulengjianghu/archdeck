<script setup lang="ts">
/**
 * 编辑落点（C-1、C-4，X7）：带之间与末尾的插入条「+ 层」、带内与父模块框内的「+ 模块」。点击后就地输入名称，回车发一个编辑操作。
 * 位置来自画布场景（canvasScene 的 insert 节点），这里只画按钮与输入框。
 */
import { computed, ref } from 'vue'
import type { NodeData } from '@/layout/canvas'
import { useDesk } from '@/state/inject'
import InlineName from './InlineName.vue'

const props = defineProps<{ data: NodeData }>()
const desk = useDesk()
const open = ref(false)
const error = ref('')
const insert = computed(() => props.data.insert!)

function submit(name: string, id: string) {
  const i = insert.value
  const r =
    i.kind === 'layer'
      ? desk.edit.edit({ op: 'addLayer', name, at: i.at, ...(id ? { id } : {}) })
      : desk.edit.edit({ op: 'addModule', parent: i.parent, name, ...(id ? { id } : {}) })
  if (r.ok) {
    open.value = false
    error.value = ''
  } else error.value = r.reason
}
</script>

<template>
  <div class="insert-slot" :class="insert.kind">
    <button v-if="!open" class="add nodrag" :title="insert.kind === 'layer' ? '在这里加一层（C-1）' : '加一个模块（C-4）'" @click.stop="open = true">
      {{ insert.kind === 'layer' ? '+ 层' : '+ 模块' }}
    </button>
    <span v-else class="editor">
      <InlineName
        :parent="insert.kind === 'module' ? insert.parent : undefined"
        :placeholder="insert.kind === 'layer' ? '层名称' : '模块名称'"
        @submit="submit"
        @cancel="((open = false), (error = ''))"
      />
      <span v-if="error" class="error" role="alert">{{ error }}</span>
    </span>
  </div>
</template>

<style scoped>
.insert-slot {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
}

.insert-slot.layer {
  justify-content: center;
  border-top: 1px dashed transparent;
}

.insert-slot.layer:hover {
  border-top-color: var(--accent);
}

.add {
  font-size: 11.5px;
  padding: 0 8px;
  line-height: 18px;
  border: 1px dashed var(--accent);
  border-radius: 10px;
  background: var(--surface);
  color: var(--accent);
  opacity: 0.75;
}

.add:hover {
  opacity: 1;
}

.editor {
  position: relative;
  z-index: 10;
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
}

.error {
  font-size: 11.5px;
  color: var(--danger);
  background: var(--surface);
}
</style>
