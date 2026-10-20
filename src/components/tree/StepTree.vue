<script setup lang="ts">
/**
 * 步骤树（T6–T8）：步骤大纲 `outlineScenario` 的逐行呈现。
 * - 状态 → 树：帧标出已走过 / 当前 / 未走到 / 未选分支 / 未到达；本层可见的帧显示可见消息序号（与时序图、控制条一致），
 *   不可见的标「本层不可见」；当前帧滚到可见。
 * - 树 → 意图：单击帧指向该步（R13），单击 alt 分支标题选该分支（F6b），悬停帧在结构图上预览落点。
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
  const v = desk.scenarioView.value
  const m = v?.messageOf.get(f.id)
  const hidden = status === 'path' && m === undefined
  const seq = m === undefined ? undefined : m + 1
  if (status !== 'path' || !v) return { state: status === 'path' ? 'ahead' : status, seq, hidden }
  const head = desk.playback.value?.frameId ?? null
  const cur = desk.currentIndex.value
  if (head !== null && (cur !== null ? m === cur : f.id === head)) return { state: 'current', seq, hidden }
  const at = head === null ? -1 : (v.order.get(head) ?? -1)
  return { state: (v.order.get(f.id) ?? Infinity) < at ? 'walked' : 'ahead', seq, hidden }
}

// mark 在行组件渲染时读取场景投影与播放头，依赖由行组件自己追踪
const ctx = computed<StepTreeContext>(() => ({ index: desk.index.value!, collapsed: collapsed.value, mark }))

function toggle(id: string) {
  const next = new Set(collapsed.value)
  if (!next.delete(id)) next.add(id)
  collapsed.value = next
}
function hover(id: string | null) {
  desk.setHover(id ? `step:${id}` : null)
}

// T7：当前帧滚到可见
watch(
  () => [desk.playback.value?.frameId, desk.currentIndex.value] as const,
  async () => {
    await nextTick()
    root.value?.querySelector<HTMLElement>('.frame.current')?.scrollIntoView?.({ block: 'nearest' })
  },
  { immediate: true },
)
</script>

<template>
  <div ref="root" class="step-tree" @mouseleave="hover(null)">
    <div class="scenario">
      <strong>{{ desk.scenario.value?.name }}</strong>
      <button class="link start" :class="{ current: !desk.playback.value?.frameId }" title="回到开头" @click="desk.seek(null)">开头</button>
    </div>
    <ul class="tree" role="tree">
      <StepTreeNode
        v-for="(n, k) in desk.outline.value"
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
