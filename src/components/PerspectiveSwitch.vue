<script setup lang="ts">
/**
 * 视角段与场景胶囊（LY-5、LY-6，ADR-0064）：画布页头里「结构 ｜ 交互」两段（setMode），其右是场景胶囊——
 * 没有场景时为「场景 ▾」，单击下拉场景列表（与侧栏「场景」页同一组件），选定即进入回放；回放中为「场景名 ✕」，✕ 退出场景（留在交互视角，LY-6a），
 * 单击名字同样下拉列表换场景。回放 = 交互视角 + 一个场景：回放中「交互」为按下态，单击无动作；单击「结构」即退出场景并切到结构（LY-6a，状态层）。
 * 场景名最多 12 字、超出截断，悬停看全名。草图画布下不出现（DeskView）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useDesk } from '@/state/inject'
import ScenarioList from './ScenarioList.vue'

const desk = useDesk()
const open = ref(false)
const root = ref<HTMLElement>()
function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))
/** 场景名最多 12 字 */
const SCENE_MAX = 12
const scene = computed(() => desk.run.scenario.value?.name ?? '')
const sceneShort = computed(() => (scene.value.length > SCENE_MAX ? `${scene.value.slice(0, SCENE_MAX)}…` : scene.value))
const viewpoint = computed(() => desk.viewpoint.value)
</script>

<template>
  <div ref="root" class="viewpoint" role="group" aria-label="视角">
    <div class="seg">
      <button
        data-mode="structure"
        :class="{ on: viewpoint === 'structure' }"
        :aria-pressed="viewpoint === 'structure'"
        title="结构视角：谁依赖谁、改哪牵动哪里"
        @click="desk.setMode('structure')"
      >
        结构
      </button>
      <button
        data-mode="interaction"
        :class="{ on: viewpoint === 'interaction' }"
        :aria-pressed="viewpoint === 'interaction'"
        :title="scene ? `交互视角（正在回放「${scene}」）` : '交互视角：谁调谁、谁负责后果'"
        @click="desk.setMode('interaction')"
      >
        交互
      </button>
    </div>
    <span v-if="scene" class="chip on" data-scene-chip :title="`正在回放：${scene}（单击换场景）`">
      <button class="t" :aria-label="`场景 ${scene}`" :aria-expanded="open" @click="open = !open">{{ sceneShort }}</button>
      <button class="x" title="退出场景（留在交互视角）" aria-label="退出场景" @click="desk.closeScenario()">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
      </button>
    </span>
    <button v-else class="chip" data-scene-chip title="场景：选一个，看它这一次怎么走" aria-label="场景" :aria-expanded="open" @click="open = !open">
      <span class="t">场景</span><span class="caret" aria-hidden="true">▾</span>
    </button>
    <ScenarioList v-if="open" class="drop" @picked="open = false" />
  </div>
</template>

<style scoped>
.viewpoint {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.drop {
  left: auto;
  right: 0;
}

.seg {
  display: inline-flex;
  padding: 2px;
  border-radius: 7px;
  background: var(--surface-2);
}

.seg button {
  padding: 2px 12px;
  border: none;
  border-radius: 5px;
  background: none;
  color: var(--text-2);
  font-size: 12.5px;
  white-space: nowrap;
}

.seg button.on {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 0 0 1px var(--border);
  font-weight: 600;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 220px;
  height: 26px;
  padding: 0 8px 0 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: none;
  color: var(--text-2);
  font-size: 12.5px;
  white-space: nowrap;
}

.chip .t {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font-size: 12.5px;
}

.chip .caret {
  color: var(--text-3);
}

.chip.on {
  padding-right: 4px;
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.chip .x {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: none;
  color: inherit;
  opacity: 0.7;
}

.chip .x:hover {
  opacity: 1;
  background: var(--surface);
}

.chip .x svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
}
</style>
