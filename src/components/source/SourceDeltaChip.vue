<script setup lang="ts">
/**
 * 源码胶囊（TB-8、G22）：画布标题行里的一枚胶囊——描述的 `system.source.commit` 与源码树 HEAD 不一致时「描述落后 N 个提交」，
 * 源码读取失败时「源码不可用」；单击展开原文（措辞与 `lint:model` 摘要同源，sourceDeltaNote），再单击或单击外面收起。
 * 落后超过阈值、描述的提交不在源码树中、源码不可用时着警示色；一致、未写 commit 或读不到 git 时不出现。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CommitDelta } from '@/model'
import { sourceChipView } from './sourceChip'

const props = defineProps<{ delta: CommitDelta | null; unavailable?: string | null }>()
const open = ref(false)
const root = ref<HTMLElement>()
const view = computed(() => sourceChipView(props.delta, props.unavailable))
const onDoc = (e: MouseEvent) => {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('mousedown', onDoc))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDoc))
</script>

<template>
  <span v-if="view" ref="root" class="source-chip-wrap">
    <button class="canvas-chip source-chip" :class="{ warn: view.warn }" :aria-expanded="open" :title="open ? '' : view.note" @click="open = !open">
      {{ view.label }}
    </button>
    <span v-if="open" class="note" role="status">{{ view.note }}</span>
  </span>
</template>

<style scoped>
.source-chip-wrap {
  position: relative;
  display: inline-flex;
}

.source-chip.warn {
  color: var(--warning);
  border-color: var(--warning);
  background: var(--warning-soft);
}

.note {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 8;
  width: max-content;
  max-width: 380px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 4px 14px rgb(0 0 0 / 10%);
}
</style>
