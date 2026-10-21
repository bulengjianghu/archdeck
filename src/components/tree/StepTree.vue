<script setup lang="ts">
/**
 * 步骤树（T6–T8）：步骤大纲 `outlineScenario` 的逐行呈现。
 * - 状态 → 树：帧标出已走过 / 进度所在 / 未走到 / 未选分支 / 未到达；选中步骤时它的帧为选中样式，本层合并为同一条可见消息的
 *   其他帧为「同一步」；选中的不是步骤时进度所在的帧只加小标记（T7、ADR-0012）；本层可见的帧显示可见消息序号
 *   （与时序图、控制条一致），不可见的标「本层不可见」；进度所在的帧滚到可见。
 * - 树 → 意图：单击帧指向该步即选中它（R13），单击 alt 分支标题选该分支（F6b），悬停帧在结构图上预览落点。
 * 分组的折叠状态只属于这块界面。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useDesk } from '@/state/inject'
import type { Frame } from '@/model'
import StepTreeNode from './StepTreeNode.vue'
import type { FrameMark, StepTreeContext } from './types'

const desk = useDesk()
const root = ref<HTMLElement>()
const collapsed = ref(new Set<string>())

function mark(f: Frame, status: 'path' | 'unchosen' | 'unreached'): FrameMark {
  const v = desk.run.scenarioView.value
  const m = v?.messageOf.get(f.id)
  const hidden = status === 'path' && m === undefined
  const seq = m === undefined ? undefined : m + 1
  if (status !== 'path' || !v) return { state: status === 'path' ? 'ahead' : status, seq, hidden }
  const head = desk.playback.value?.frameId ?? null
  const step = desk.selected.value?.kind === 'step'
  if (f.id === head) return { state: step ? 'selected' : 'progress', seq, hidden }
  const cur = desk.run.currentIndex.value
  if (step && cur !== null && m === cur) return { state: 'same', seq, hidden }
  const at = head === null ? -1 : (v.order.get(head) ?? -1)
  // 进度所在可见消息中的其他帧随这一步一起走过
  return { state: (v.order.get(f.id) ?? Infinity) < at || (cur !== null && m === cur) ? 'walked' : 'ahead', seq, hidden }
}

// mark 在行组件渲染时读取场景投影、进度与选中，依赖由行组件自己追踪
const ctx = computed<StepTreeContext>(() => ({ index: desk.index.value!, collapsed: collapsed.value, mark }))

function toggle(id: string) {
  const next = new Set(collapsed.value)
  if (!next.delete(id)) next.add(id)
  collapsed.value = next
}
function hover(id: string | null) {
  desk.setHover(id ? `step:${id}` : null)
}

// T7：进度所在的帧滚到可见
watch(
  () => [desk.playback.value?.frameId, desk.run.currentIndex.value] as const,
  async () => {
    await nextTick()
    root.value?.querySelector<HTMLElement>('.frame.selected, .frame.progress')?.scrollIntoView?.({ block: 'nearest' })
  },
  { immediate: true },
)
</script>

<template>
  <div ref="root" class="step-tree" @mouseleave="hover(null)">
    <div class="scenario">
      <strong>{{ desk.run.scenario.value?.name }}</strong>
      <button class="link start" :class="{ current: desk.selected.value?.kind === 'scenario' }" title="回到开头（选中场景）" @click="desk.seek(null)">开头</button>
    </div>
    <ul class="tree" role="tree">
      <StepTreeNode
        v-for="(n, k) in desk.run.outline.value"
        :key="k"
        :node="n"
        :depth="0"
        :ctx="ctx"
        @seek="id => desk.seek(id)"
        @choose="(p, o) => desk.chooseBranch(p, o)"
        @toggle="toggle"
        @hover="hover"
      />
    </ul>
  </div>
</template>

<style scoped>
.scenario {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 10px 6px;
}

.scenario strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.start {
  margin-left: auto;
  flex: none;
  white-space: nowrap;
  font-size: 11.5px;
}

.start.current {
  font-weight: 700;
}

.tree {
  list-style: none;
  margin: 0;
  padding: 0;
}
</style>
