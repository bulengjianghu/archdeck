<script setup lang="ts">
/**
 * 视角切换（V1、V11、W-3；第二十二轮波 1 过渡，波 4 换成「结构 ｜ 交互」+ 场景胶囊）：「结构 ｜ 交互 ｜ 运行 · <场景名>」——结构 / 交互单击切换（setMode）；
 * 回放中单击结构即退出场景并切到结构（LY-6a）；旧版式里「运行」是单独一段，单击交互仍退出场景（状态层 LY-6a 里这是无动作，适配在这里）；
 * 「运行」弹出场景列表，运行视角下可换场景或退出（回到进入前的视角）。草图画布下不出现（DeskView）。
 * 运行段写「运行 · 场景名 ▾」，场景名最多 12 字、超出截断，悬停看全名（TB-1）；整段不收缩。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useDesk } from '@/state/inject'
import ScenarioList from './ScenarioList.vue'

const desk = useDesk()
const open = ref(false)
const root = ref<HTMLElement>()
/** TB-1：场景名最多 12 字 */
const SCENE_MAX = 12
const scene = computed(() => desk.run.scenario.value?.name ?? '')
const sceneShort = computed(() => (scene.value.length > SCENE_MAX ? `${scene.value.slice(0, SCENE_MAX)}…` : scene.value))

function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))
</script>

<template>
  <div ref="root" class="perspective" role="group" aria-label="视角">
    <button
      class="seg"
      data-mode="structure"
      :class="{ on: desk.perspective.value === 'structure' }"
      :aria-pressed="desk.perspective.value === 'structure'"
      title="结构视角：谁依赖谁、改哪牵动哪里"
      @click="desk.setMode('structure')"
    >
      结构
    </button>
    <button
      class="seg mid"
      data-mode="interaction"
      :class="{ on: desk.perspective.value === 'interaction' }"
      :aria-pressed="desk.perspective.value === 'interaction'"
      title="交互视角：谁调谁、谁负责后果"
      @click="desk.playback.value ? desk.closeScenario() : desk.setMode('interaction')"
    >
      交互
    </button>
    <button
      class="seg run"
      :class="{ on: desk.perspective.value === 'run' }"
      :title="scene ? `运行：${scene}（单击换场景）` : '运行视角：选一个场景，看它这一次怎么走'"
      :aria-expanded="open"
      @click="open = !open"
    >
      运行<template v-if="scene"> · {{ sceneShort }}</template> ▾
    </button>
    <button v-if="desk.run.scenario.value" class="exit" title="退出场景（留在交互视角，LY-6a）" aria-label="退出场景" @click="desk.closeScenario()">×</button>
    <ScenarioList v-if="open" @picked="open = false" />
  </div>
</template>

<style scoped>
.perspective {
  position: relative;
  display: flex;
  align-items: center;
  flex: none;
}

.seg {
  font-size: 12.5px;
  border-radius: 0;
  background: var(--surface-2);
  white-space: nowrap;
}

.seg:first-child {
  border-radius: 6px 0 0 6px;
}

.seg.mid {
  margin-left: -1px;
}

.seg.run {
  margin-left: -1px;
  border-radius: 0 6px 6px 0;
}

.seg.on {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
  font-weight: 600;
  position: relative;
}

.exit {
  margin-left: 4px;
  padding: 1px 7px;
  font-size: 13px;
  line-height: 1.2;
}
</style>
