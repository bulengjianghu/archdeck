<script setup lang="ts">
/**
 * 视图标签的内容（LY-13）：（主语, 标签类型）的纯投影，自己没有状态。
 * 第二十二轮波 1 的过渡适配：沿用旧组件——图解 = 原理解页（事实卡 + 有图解时的故事；系统为根图解）；
 * 描述 = 回放中的步骤节（步骤详情、场景概览、运行信息），其余对象为原选中面板；核对 = 指向选中面板的核对卡。
 * 波 3 按 LY-13 拆分内容（图解去事实、描述收事实、核对收核对卡）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import type { ViewKind } from '@/state/useDeskState'
import ModuleDoc from './ModuleDoc.vue'
import ExplainerDoc from './ExplainerDoc.vue'
import SequenceDoc from './SequenceDoc.vue'
import RunSection from '../panel/RunSection.vue'
import StepPanel from '../panel/StepPanel.vue'
import ScenarioPanel from '../panel/ScenarioPanel.vue'
import Panel from '../panel/Panel.vue'

defineProps<{ view: ViewKind }>()
const desk = useDesk()
const subject = computed(() => desk.subject.value)
const rootId = computed(() => desk.index.value?.rootId ?? '')
/** 主语是系统或模块时的模块 ID（系统取根） */
const moduleId = computed(() => {
  const s = subject.value
  if (!s) return null
  if (s.kind === 'system') return rootId.value
  return s.kind === 'module' && desk.index.value?.modules.has(s.id) ? s.id : null
})
const playing = computed(() => !!desk.playback.value)
const runKinds = ['module', 'relation', 'edge', 'actor', 'port']
const key = computed(() => `${subject.value?.kind}:${'id' in (subject.value ?? {}) ? (subject.value as { id: string }).id : ''}`)
</script>

<template>
  <div class="view-doc" :data-view="view" :data-subject="key">
    <template v-if="view === 'explainer'">
      <ExplainerDoc v-if="moduleId === rootId && desk.explainers.has(rootId)" :key="key" :module="rootId" />
      <ModuleDoc v-else-if="moduleId && moduleId !== rootId" :key="key" :module="moduleId" :with-story="desk.explainers.has(moduleId)" />
      <p v-else class="empty">这个对象没有图解</p>
    </template>
    <template v-else-if="view === 'description'">
      <div
        v-if="playing && subject && (subject.kind === 'step' || subject.kind === 'scenario' || runKinds.includes(subject.kind))"
        class="run-side"
        data-testid="dock-step-side"
      >
        <StepPanel v-if="subject.kind === 'step'" :key="key" />
        <ScenarioPanel v-else-if="subject.kind === 'scenario'" :key="key" />
        <RunSection v-else :key="key" />
      </div>
      <div v-else class="panel-wrap"><Panel :key="key" /></div>
    </template>
    <template v-else-if="view === 'check'">
      <p class="empty">核对卡暂在选中面板（▤ 属性）；第二十二轮波 3 搬进这里</p>
    </template>
    <template v-else-if="view === 'sequence'">
      <SequenceDoc v-if="playing" />
      <p v-else class="empty">没有在回放的场景</p>
    </template>
  </div>
</template>

<style scoped>
.view-doc {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.run-side,
.panel-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 8px 10px;
  scrollbar-width: thin;
}

.empty {
  margin: 0;
  padding: 30px 16px;
  text-align: center;
  color: var(--text-3);
  font-size: 12.5px;
}
</style>
