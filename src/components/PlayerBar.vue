<script setup lang="ts">
/**
 * 回放控制条（D-3、D-12、R1、R12、F6d）：回放只由用户驱动——上一步 / 下一步（按本层可见消息）、
 * 进度条拖动到已走路径上的任意位置（拖到 0 即回到开头）；「第 i / N 步」，分支点之后未定时为「≥ N」；停在分支点时展开全部选项。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import BranchChooser from './BranchChooser.vue'

const desk = useDesk()
const total = computed(() => desk.scenarioView.value?.messages.length ?? 0)
const open = computed(() => !!desk.path.value?.pending)
const position = computed(() => desk.walked.value)
const atStart = computed(() => !desk.playback.value?.frameId)

function onSlide(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (v === 0) return desk.seek(null)
  const m = desk.scenarioView.value?.messages[v - 1]
  if (m) desk.seek(m.frameIds[0])
}
</script>

<template>
  <div class="player">
    <div class="controls">
      <button title="上一步（←）" :disabled="atStart" @click="desk.prev()">◀ 上一步</button>
      <button class="next" title="下一步（→）" :disabled="position >= total" @click="desk.next()">下一步 ▶</button>
    </div>
    <input class="progress" type="range" min="0" :max="total" :value="position" :disabled="total === 0" aria-label="进度" @input="onSlide" />
    <span class="count">第 {{ position }} / {{ open ? '≥ ' : '' }}{{ total }} 步</span>
    <BranchChooser />
  </div>
</template>

<style scoped>
.player {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 14px;
  background: var(--surface);
  border-top: 1px solid var(--border);
  flex-wrap: wrap;
}

.controls {
  display: flex;
  align-items: center;
  gap: 4px;
}

.next {
  font-weight: 600;
  color: var(--accent);
}

button:disabled {
  opacity: 0.4;
  cursor: default;
}

.progress {
  flex: 1 1 200px;
  min-width: 120px;
  padding: 0;
}

.count {
  font-size: 12.5px;
  color: var(--text-2);
  white-space: nowrap;
}
</style>
