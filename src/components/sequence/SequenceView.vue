<script setup lang="ts">
/**
 * 时序图（D-2、D-7、R3、R5、R11）：只画定位好坐标的时序模型。
 * 单击消息（含未选分支上的）→ 指向该步（R13）；当前消息高亮并滚动到可见；悬停消息时在结构图上预览对应的边。
 * 收起、页签与分屏方向切换在副栏（split/AsidePane.vue）；这里只画信息条（当前层次、当前帧不可见的提示）与时序图本身。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName, type SequenceMessage } from '@/model'
import SequenceLanes from './SequenceLanes.vue'
import SequenceFragments from './SequenceFragments.vue'

const desk = useDesk()
const scroller = ref<HTMLElement>()

const ps = computed(() => desk.positionedSequence.value)
const levelName = computed(() => (desk.index.value ? moduleName(desk.index.value, desk.levelId.value) : ''))
const homeName = computed(() => (desk.index.value && desk.home.value ? moduleName(desk.index.value, desk.home.value) : ''))
const empty = computed(() => (desk.scenarioView.value?.messages.length ?? 0) === 0)
const hiddenCurrent = computed(() => !!desk.frame.value && desk.currentIndex.value === null)

function pick(m: SequenceMessage) {
  desk.seek(m.frameIds[0])
}
function hover(m: SequenceMessage | null) {
  desk.setHover(m ? `step:${m.frameIds[0]}` : null)
}

// 当前消息滚动到可见
watch(
  () => [desk.currentIndex.value, ps.value] as const,
  async ([ci]) => {
    await nextTick()
    const el = scroller.value
    const p = ps.value
    if (!el || !p || ci === null) return
    const i = p.model.messages.findIndex(m => m.pathIndex === ci)
    if (i < 0) return
    const y = p.messages[i].y
    // 不用平滑滚动：连续单步时平滑滚动会被下一次渲染打断
    if (y < el.scrollTop + 40 || y > el.scrollTop + el.clientHeight - 40) el.scrollTop = Math.max(0, y - el.clientHeight / 2)
  },
  { immediate: true },
)
</script>

<template>
  <section class="sequence">
    <header class="bar">
      <strong>时序图</strong>
      <span class="muted">· {{ levelName }}</span>
      <span v-if="hiddenCurrent" class="hint warn">
        当前步骤在本层不可见：
        <button class="link" @click="desk.goTo(desk.frameLevel.value!)">到能看到它的层次</button>
      </span>
    </header>
    <div ref="scroller" class="body">
      <div v-if="empty" class="empty">
        <p>本层看不到这个场景的任何一步。</p>
        <button v-if="desk.home.value" @click="desk.goTo(desk.home.value)">跳到场景所在层次：{{ homeName }}</button>
      </div>
      <svg v-else-if="ps" :width="ps.size.w" :height="ps.size.h" class="svg">
        <defs>
          <marker id="seq-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
          </marker>
          <marker id="seq-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10" fill="none" stroke="context-stroke" stroke-width="1.5" />
          </marker>
        </defs>
        <SequenceFragments :ps="ps" />
        <SequenceLanes :ps="ps" :current="desk.currentIndex.value" :walked="desk.walked.value" :hover="desk.hoverId.value" @pick="pick" @hover="hover" />
      </svg>
    </div>
  </section>
</template>

<style scoped>
.sequence {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 0;
  flex: 1 1 auto;
  background: var(--surface);
}

.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  overflow: hidden;
  padding: 3px 10px;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
  flex: none;
}

.hint {
  margin-left: 12px;
  font-size: 12px;
}

.warn {
  color: var(--warning);
}

.body {
  flex: 1 1 auto;
  overflow: auto;
  min-height: 0;
}

.svg {
  display: block;
  min-width: 100%;
}

.empty {
  display: grid;
  place-content: center;
  gap: 8px;
  height: 100%;
  color: var(--text-2);
  text-align: center;
}

.empty p {
  margin: 0;
}
</style>
