<script setup lang="ts">
/**
 * 源码版本提示条（G22）：描述的 `system.source.commit` 与源码树的 git HEAD 不一致时常显一条——
 * 代码事实、几何检查器与源码验收读到的是当前源码树，不是描述那一份，不能没有提示。
 * 措辞与 `lint:model` 摘要同源（sourceDeltaNote）；一致、未写 commit 或读不到 git（发布产物等）时不出现。
 */
import { computed } from 'vue'
import { sourceDeltaNote, type CommitDelta } from '@/model'

const props = defineProps<{ delta: CommitDelta | null }>()
const note = computed(() => (props.delta ? sourceDeltaNote(props.delta) : ''))
</script>

<template>
  <div v-if="delta" class="source-delta" role="status" :title="`描述提交 ${delta.described}，源码树 HEAD ${delta.head}；lint:model 摘要给同一条提醒`">
    <span class="mark">源码版本</span>
    <span class="note">{{ note }}；代码事实与源码验收读到的是当前源码树</span>
  </div>
</template>

<style scoped>
.source-delta {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 14px;
  font-size: 12px;
  background: var(--warning-soft);
  border-bottom: 1px solid var(--border);
  min-width: 0;
}

.mark {
  flex: none;
  font-weight: 600;
  color: var(--warning);
}

.note {
  min-width: 0;
  color: var(--text-2);
}
</style>
