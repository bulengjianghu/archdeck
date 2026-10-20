<script setup lang="ts">
/**
 * 回放控制条（D-3、D-12、R1、F6d）：上一步 / 下一步（按本层可见消息）、播放 / 暂停（只有这里能恢复播放，V4）、
 * 速度、进度条拖动到已走路径上的任意位置；「第 i / N 步」，分支点之后未定时为「≥ N」；停在分支点时展开全部选项。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import type { Speed } from '@/state/transition'
import BranchChooser from './BranchChooser.vue'

const desk = useDesk()
const total = computed(() => desk.scenarioView.value?.messages.length ?? 0)
const open = computed(() => !!desk.path.value?.pending)
const position = computed(() => desk.walked.value)
const playing = computed(() => !!desk.playback.value?.playing)
const SPEEDS: Speed[] = [0.5, 1, 2]

function onSlide(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  const m = desk.scenarioView.value?.messages[v - 1]
  if (m) desk.seek(m.frameIds[0])
}
</script>

<template>
  <div class="player">
    <div class="controls">
      <button title="上一步（←）" :disabled="position <= 1" @click="desk.prev()">◀</button>
      <button class="play" :title="playing ? '暂停（空格）' : '播放（空格）'" :disabled="!playing && !!desk.branchPoint.value" @click="playing ? desk.pause() : desk.play()">
        {{ playing ? '❚❚' : '▶' }}
      </button>
      <button title="下一步（→）" :disabled="position >= total" @click="desk.next()">▶▏</button>
      <select :value="desk.playback.value?.speed ?? 1" aria-label="速度" @change="desk.setSpeed(Number(($event.target as HTMLSelectElement).value) as Speed)">
        <option v-for="s in SPEEDS" :key="s" :value="s">{{ s }}×</option>
      </select>
    </div>
    <input class="progress" type="range" min="1" :max="Math.max(total, 1)" :value="Math.max(position, 1)" :disabled="total === 0" aria-label="进度" @input="onSlide" />
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

.controls button {
  min-width: 34px;
}

.play {
  font-weight: 700;
  color: var(--accent);
}

button:disabled {
  opacity: 0.4;
  cursor: default;
}

select {
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
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
