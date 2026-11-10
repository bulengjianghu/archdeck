<script setup lang="ts">
/**
 * 视图标签的内容（LY-13）：（主语, 标签类型）的纯投影，自己没有状态。
 * 第二十二轮波 2 的过渡（波 3 按 LY-13 拆分内容：图解去事实、描述收事实、核对收核对卡）：沿用旧组件——
 * 图解 = 原理解页（事实卡 + 有图解时的故事；系统为根图解）；
 * 描述 = 回放中的步骤节（步骤详情、场景概览、运行信息），其余主语为原选中面板的全部内容（含核对卡，抽屉已删，LY-16；草图里是草图面板）；
 * 核对 = 同一份内容的核对卡（Panel / 步骤 / 场景面板的 part="check"）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import type { ViewKind } from '@/state/useDeskState'
import ExplainerView from './ExplainerView.vue'
import SequenceDoc from './SequenceDoc.vue'
import RunSection from '../panel/RunSection.vue'
import Panel from '../panel/Panel.vue'

defineProps<{ view: ViewKind }>()
const desk = useDesk()
const subject = computed(() => desk.subject.value)
const playing = computed(() => !!desk.playback.value)
const runKinds = ['module', 'relation', 'edge', 'actor', 'port']
/** 回放中的步骤、场景与参与对象：住描述标签的步骤节（V6 新家），核对标签取同一面板的核对卡 */
const runSide = computed(() => {
  const s = subject.value
  return playing.value && !!s && (s.kind === 'step' || s.kind === 'scenario' || runKinds.includes(s.kind))
})
/** 回放中主语是步骤或场景 */
const stepSide = computed(() => playing.value && (subject.value?.kind === 'step' || subject.value?.kind === 'scenario'))
const key = computed(() => `${subject.value?.kind}:${'id' in (subject.value ?? {}) ? (subject.value as { id: string }).id : ''}`)
</script>

<template>
  <div class="view-doc" :data-view="view" :data-subject="key">
    <ExplainerView v-if="view === 'explainer'" :key="key" />
    <template v-else-if="view === 'description'">
      <!-- 回放中（步骤、场景与参与对象）挂 dock-step-side：步骤 / 场景面板由同一个面板分派给出，参与对象的运行信息排在面板之后（V6） -->
      <div class="panel-wrap" :class="{ 'run-side': runSide }" :data-testid="runSide ? 'dock-step-side' : undefined">
        <Panel :key="key" part="description" />
        <RunSection v-if="runSide && subject && runKinds.includes(subject.kind)" :key="`r:${key}`" />
      </div>
    </template>
    <template v-else-if="view === 'check'">
      <div class="panel-wrap" :data-testid="stepSide ? 'check-step-side' : undefined"><Panel :key="key" part="check" /></div>
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

.empty {
  margin: 0;
  padding: 30px 16px;
  text-align: center;
  color: var(--text-3);
  font-size: 12.5px;
}
</style>
