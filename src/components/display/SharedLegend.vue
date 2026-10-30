<script setup lang="ts">
/**
 * 图例 · 共享通道（L18）：选中、变淡、违规红晕、环编号、演化叠加、线宽 = 聚合条数、线型（实线 = 交互、虚线 = 依赖，ADR-0035）与标签位（L26）——交互、结构、运行三个视角同义，
 * 三处同文（文字取 labels.ts 的 SHARED_CHANNELS，不在各组里各写一遍）。
 * 图例按上下文显示（L47，G14）：红晕、环编号、演化、线宽、线型、标签位只列当前画面出现的（出现集合由 state/desk/legend 一处派生）；
 * 选中与变淡是选中 / 悬停才出现的记号（L25、L27），结构视角的实线（承载的交互，L22）也是——归尾部「临时可见」小节常列，不随出现显隐。
 */
import { computed } from 'vue'
import DisplayGroup from './DisplayGroup.vue'
import LineSwatch from './LineSwatch.vue'
import { SHARED_CHANNELS, SHARED_CHANNELS_TITLE } from './labels'

const props = defineProps<{ open: boolean; presence: Set<string>; structure: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const NEUTRAL = 'var(--text-2)'
/** L47：正文的行（按出现集合显隐）与「临时可见」的行（常列）：选中、变淡总是临时的；结构视角的实线是选中束承载的交互（L22） */
const TEMPORAL = new Set(['select', 'dim'])
const main = computed(() =>
  SHARED_CHANNELS.filter(c => !TEMPORAL.has(c.key) && !(props.structure && c.key === 'solid') && props.presence.has(`shared:${c.key}`)),
)
const temp = computed(() => SHARED_CHANNELS.filter(c => TEMPORAL.has(c.key) || (props.structure && c.key === 'solid')))
</script>

<template>
  <DisplayGroup :title="SHARED_CHANNELS_TITLE" :open="open" @toggle="emit('toggle')">
    <div v-if="!main.length && temp.length" class="item muted">本层静息态没有这些记号</div>
    <div class="shared" aria-label="共享通道">
      <div v-for="c in main" :key="c.key" class="item">
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
      <div class="section-label">临时可见 · 选中 / 悬停时出现</div>
      <div v-for="c in temp" :key="c.key" class="item">
        <span class="sw">
          <span v-if="c.key === 'select'" class="box active" />
          <span v-else-if="c.key === 'dim'" class="box faded" />
          <LineSwatch v-else :color="NEUTRAL" arrow="closed" />
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
