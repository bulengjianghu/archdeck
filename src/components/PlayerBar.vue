<script setup lang="ts">
/**
 * 回放胶囊（CD-7，取代贯穿整行的回放控制条；D-3、D-12、R1、R12、F6d）：回放只由用户驱动——上一步 / 下一步（按本层可见消息）、
 * 进度条拖动到已走路径上的任意位置（拖到 0 即回到开头）；「第 i / N 步」，分支点之后未定时为「≥ N」。
 * 路线（CD-9）：胶囊上只显示编号「路线 a·b」，截止在未选的分支点时为警示色的「选路线 ▾」；单击展开上方的浮层——
 * 路线总览（F6f）与停在分支点时的分支选择（F6）；停在分支点时浮层自动展开。位置由项目视图给（CD-8）。
 */
import { computed, ref, watch } from 'vue'
import { useDesk } from '@/state/inject'
import BranchChooser from './BranchChooser.vue'
import RouteBar from './RouteBar.vue'

const desk = useDesk()
const total = computed(() => desk.run.scenarioView.value?.messages.length ?? 0)
const open = computed(() => !!desk.run.path.value?.pending)
const position = computed(() => desk.run.walked.value)
const atStart = computed(() => !desk.playback.value?.frameId)

function onSlide(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (v === 0) return desk.seek(null)
  const m = desk.run.scenarioView.value?.messages[v - 1]
  if (m) desk.seek(m.frameIds[0])
}

const route = computed(() => desk.run.route.value)
/** CD-9：停在未选的分支点（路径截止于此）即「选路线」 */
const need = computed(() => !!desk.run.branchPoint.value)
/** CD-9：编号 = 路径上各分支点所选选项的序号（从 1 起），按经过的次序以「·」相连 */
const code = computed(() =>
  route.value
    .filter(r => r.chosen !== null)
    .map(r => r.chosen! + 1)
    .join('·'),
)
const routeOpen = ref(false)
// 停在分支点时自动展开（保持 F6「停在分支点时展开全部选项」）；收起后到下一个分支点再展开
let autoOpened: string | null = null
watch(
  () => desk.run.branchPoint.value?.id ?? null,
  id => {
    if (id && id !== autoOpened) routeOpen.value = true
    if (id) autoOpened = id
  },
  { immediate: true },
)
watch(
  () => route.value.length,
  n => {
    if (!n) routeOpen.value = false
  },
)
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && routeOpen.value) {
    routeOpen.value = false
    e.stopPropagation()
  }
}
</script>

<template>
  <div class="player desk-pill" role="group" aria-label="回放" @keydown="onKey">
    <button class="step prev" title="上一步（←）" aria-label="上一步（←）" :disabled="atStart" @click="desk.prev()">◀</button>
    <span class="count"
      >第 <b>{{ position }}</b> / {{ open ? '≥ ' : '' }}{{ total }} 步</span
    >
    <button class="step next" title="下一步（→）" aria-label="下一步（→）" :disabled="position >= total" @click="desk.next()">▶</button>
    <input class="progress" type="range" min="0" :max="total" :value="position" :disabled="total === 0" aria-label="进度" @input="onSlide" />
    <button
      v-if="route.length"
      class="route-btn"
      :class="{ need }"
      :aria-expanded="routeOpen"
      :title="need ? '路线停在未选的分支：选一支后继续（数字键也可）' : '路线：路径上各分支点所选的一支，单击展开改选'"
      data-testid="route-btn"
      @click="routeOpen = !routeOpen"
    >
      {{ need ? '选路线' : code ? `路线 ${code}` : '路线' }} ▾
    </button>
    <div v-if="routeOpen && route.length" class="route-pop desk-card" data-testid="route-pop">
      <BranchChooser />
      <RouteBar />
    </div>
  </div>
</template>

<style scoped>
.player {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 8px 0 6px;
  white-space: nowrap;
}

.step {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: 11px;
  color: var(--text-2);
  background: none;
  border: 1px solid transparent;
  border-radius: 50%;
}

.step:hover:not(:disabled) {
  background: var(--surface-2);
}

.step.next {
  color: #fff;
  background: var(--accent);
}

.step.next:hover:not(:disabled) {
  background: var(--accent);
  filter: brightness(1.08);
}

button:disabled {
  opacity: 0.4;
  cursor: default;
}

.count {
  font-size: 12.5px;
  color: var(--text-2);
}

.count b {
  color: var(--text);
}

.progress {
  width: 160px;
  padding: 0;
  border: 0;
  accent-color: var(--accent);
}

.route-btn {
  padding: 2px 10px;
  font-size: 12px;
  color: var(--text-2);
  background: none;
  border: 1px solid var(--card-border);
  border-radius: var(--pill-radius);
}

.route-btn.need {
  font-weight: 600;
  color: var(--warning);
  background: var(--warning-soft);
  border-color: var(--warning);
}

/* CD-9：路线浮层在胶囊上方，右端对齐 */
.route-pop {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: min(560px, 90vw);
  padding: 10px 12px;
  white-space: normal;
}
</style>
