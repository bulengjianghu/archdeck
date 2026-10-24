<script setup lang="ts">
/**
 * 视角切换（V1、V11、W-3）：「结构 ｜ 交互 ｜ 运行：<场景名>」——不开场景时结构 / 交互单击切换（setMode）；运行视角下单击结构或交互即退出场景并进入该模式（V11a）；
 * 「运行」弹出场景列表，运行视角下可换场景或退出（回到进入前的视角）。草图画布下不出现（DeskView）。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
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
      @click="desk.setMode('interaction')"
    >
      交互
    </button>
    <button
      class="seg run"
      :class="{ on: desk.perspective.value === 'run' }"
      :title="desk.run.scenario.value ? '换场景' : '运行视角：选一个场景，看它这一次怎么走'"
      :aria-expanded="open"
      @click="open = !open"
    >
      运行<template v-if="desk.run.scenario.value">：{{ desk.run.scenario.value.name }}</template> ▾
    </button>
    <button v-if="desk.run.scenario.value" class="exit" title="回到进入前的视角" @click="desk.closeScenario()">×</button>
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
  max-width: 260px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
