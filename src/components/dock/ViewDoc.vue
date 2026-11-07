<script setup lang="ts">
/**
 * 视图标签的内容（LY-13）：（主语, 标签类型）的纯投影，自己没有状态。
 * 第二十二轮波 2 的过渡（波 3 按 LY-13 拆分内容：图解去事实、描述收事实、核对收核对卡）：沿用旧组件——
 * 图解 = 原理解页（事实卡 + 有图解时的故事；系统为根图解）；
 * 描述 = 回放中的步骤节（步骤详情、场景概览、运行信息），其余主语为原选中面板的全部内容（含核对卡，抽屉已删，LY-16；草图里是草图面板）；
 * 核对 = 同一份内容的核对卡（Panel / 步骤 / 场景面板的 part="check"）。
 */
import { computed, provide } from 'vue'
import { useDesk } from '@/state/inject'
import type { ViewKind } from '@/state/useDeskState'
import ModuleDoc from './ModuleDoc.vue'
import ExplainerDoc from './ExplainerDoc.vue'
import SequenceDoc from './SequenceDoc.vue'
import RunSection from '../panel/RunSection.vue'
import StepPanel from '../panel/StepPanel.vue'
import ScenarioPanel from '../panel/ScenarioPanel.vue'
import Panel from '../panel/Panel.vue'
import { PANEL_PART } from '../panel/panelPart'

const props = defineProps<{ view: ViewKind }>()
// 步骤 / 场景面板与运行信息不经 Panel：这里给出它们所在的部分
provide(PANEL_PART, props.view === 'check' ? 'check' : 'description')
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
/** 回放中的步骤、场景与参与对象：住描述标签的步骤节（V6 新家），核对标签取同一面板的核对卡 */
const runSide = computed(() => {
  const s = subject.value
  return playing.value && !!s && (s.kind === 'step' || s.kind === 'scenario' || runKinds.includes(s.kind))
})
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
      <div v-if="runSide && subject" class="run-side" data-testid="dock-step-side">
        <StepPanel v-if="subject.kind === 'step'" :key="key" />
        <ScenarioPanel v-else-if="subject.kind === 'scenario'" :key="key" />
        <template v-else>
          <RunSection :key="key" />
          <Panel :key="`p:${key}`" part="description" />
        </template>
      </div>
      <div v-else class="panel-wrap"><Panel :key="key" part="description" /></div>
    </template>
    <template v-else-if="view === 'check'">
      <div v-if="runSide && subject && (subject.kind === 'step' || subject.kind === 'scenario')" class="run-side part-check" data-testid="check-step-side">
        <StepPanel v-if="subject.kind === 'step'" :key="key" />
        <ScenarioPanel v-else :key="key" />
      </div>
      <div v-else class="panel-wrap"><Panel :key="key" part="check" /></div>
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

.run-side {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 8px 10px;
  scrollbar-width: thin;
}

.panel-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  scrollbar-width: thin;
}

/* 核对标签里的步骤 / 场景面板只留核对卡（波 2 过渡；卡片自己按 PANEL_PART 不渲染其余卡，身份卡、出处等藏起） */
.run-side.part-check > :deep(div > :not([data-card='check']):not(:has([data-card='check']))) {
  display: none;
}

.empty {
  margin: 0;
  padding: 30px 16px;
  text-align: center;
  color: var(--text-3);
  font-size: 12.5px;
}
</style>
