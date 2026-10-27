<script setup lang="ts">
/**
 * 「显示」面板 · 共享通道（L18）：选中、变淡、违规红晕、环编号、演化叠加、线宽 = 聚合条数、线型（实线 = 交互、虚线 = 依赖，ADR-0035）与标签位（L26）——交互、结构、运行三个视角同义，
 * 三处同文（文字取 labels.ts 的 SHARED_CHANNELS，不在各组里各写一遍）。
 */
import DisplayGroup from './DisplayGroup.vue'
import LineSwatch from './LineSwatch.vue'
import { SHARED_CHANNELS, SHARED_CHANNELS_TITLE } from './labels'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const NEUTRAL = 'var(--text-2)'
</script>

<template>
  <DisplayGroup :title="SHARED_CHANNELS_TITLE" :open="open" @toggle="emit('toggle')">
    <div class="shared" aria-label="共享通道">
      <div v-for="c in SHARED_CHANNELS" :key="c.key" class="item">
        <span class="sw">
          <span v-if="c.key === 'select'" class="box active" />
          <span v-else-if="c.key === 'dim'" class="box faded" />
          <LineSwatch v-else-if="c.key === 'violation'" :color="NEUTRAL" halo />
          <span v-else-if="c.key === 'cycle'" class="cycle">↻N</span>
          <LineSwatch v-else-if="c.key === 'evolution'" :look="{ temp: 'couple' }" />
          <LineSwatch v-else-if="c.key === 'solid'" :color="NEUTRAL" arrow="closed" />
          <LineSwatch v-else-if="c.key === 'dashed'" :color="NEUTRAL" :look="{ temp: 'code' }" arrow="open" />
          <span v-else-if="c.key === 'label'" class="tag-pill">×N</span>
          <LineSwatch v-else :color="NEUTRAL" :look="{ weight: 3 }" />
        </span>
        <span>{{ c.text }}</span>
      </div>
    </div>
  </DisplayGroup>
</template>

<style scoped>
.faded {
  opacity: 0.35;
}

.cycle {
  padding: 0 4px;
  font-size: 10px;
  line-height: 14px;
  color: var(--danger);
  border: 1px solid var(--danger);
  border-radius: 7px;
  white-space: nowrap;
}
</style>
